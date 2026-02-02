import { prisma } from "../../db/prisma";
import { ParsedMessage, RawChatMessage, MessageParser } from "../../utils/message-parser";
import { logger } from "../../utils/logger";
import { cacheManager, CacheTTL } from "../../utils/cache-manager";
import { updateViewerWatchTime } from "../../services/watch-time.service";

// 可以接受 ParsedMessage 或 RawChatMessage
type MessageInput = ParsedMessage | RawChatMessage;

// 類型守衛：檢查是否為 RawChatMessage
function isRawChatMessage(msg: MessageInput): msg is RawChatMessage {
  return "viewerId" in msg && "bitsAmount" in msg;
}

/**
 * 重試包裝器：針對 Turso 502 錯誤進行重試
 */
async function retryOnTurso502<T>(
  operation: () => Promise<T>,
  context: string,
  maxRetries = 3
): Promise<T | null> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const is502 = errorMessage.includes("502") || errorMessage.includes("bad gateway");

      if (is502 && attempt < maxRetries) {
        const delay = Math.min(100 * Math.pow(2, attempt - 1), 1000); // 100ms, 200ms, 400ms
        logger.warn(
          "ViewerMessage",
          `${context} failed (502), retry ${attempt}/${maxRetries} after ${delay}ms`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      // 最後一次嘗試失敗，或非 502 錯誤，記錄並返回 null
      logger.error("ViewerMessage", `${context} failed after ${attempt} attempts`, error);
      return null;
    }
  }
  return null;
}

// P1 Memory: Cache key generators for viewer/channel lookup
const CacheKeys = {
  viewerLookup: (twitchUserId: string) => `lookup:viewer:${twitchUserId}`,
  channelLookup: (channelName: string) => `lookup:channel:${channelName.toLowerCase()}`,
};

export class ViewerMessageRepository {
  /**
   * P1 Memory: Use cacheManager instead of raw Map (with LRU eviction)
   * 使用快取獲取 Viewer ID（減少 DB 查詢）
   */
  private async getCachedViewerId(twitchUserId: string): Promise<string | null> {
    const cacheKey = CacheKeys.viewerLookup(twitchUserId);

    // Try to get from cache first
    const cached = cacheManager.get<string | null>(cacheKey);
    if (cached !== null) {
      return cached;
    }

    // Query database with retry on 502 errors
    const result = await retryOnTurso502(
      () =>
        prisma.viewer.findUnique({
          where: { twitchUserId },
          select: { id: true },
        }),
      `getCachedViewerId(${twitchUserId})`
    );

    // Handle null from retry failure or viewer not found
    if (!result) {
      return null;
    }

    const viewerId = (result as { id: string }).id;

    // Store in cache (5 min TTL)
    cacheManager.set(cacheKey, viewerId, CacheTTL.MEDIUM);

    return viewerId;
  }

  /**
   * P1 Memory: Use cacheManager instead of raw Map (with LRU eviction)
   * 使用快取獲取 Channel ID（減少 DB 查詢）
   */
  private async getCachedChannelId(channelName: string): Promise<string | null> {
    const cacheKey = CacheKeys.channelLookup(channelName);

    // Try to get from cache first
    const cached = cacheManager.get<string | null>(cacheKey);
    if (cached !== null) {
      return cached;
    }

    // Query database with retry on 502 errors
    const normalizedName = channelName.toLowerCase();
    const result = await retryOnTurso502(
      () =>
        prisma.channel.findFirst({
          where: { channelName: normalizedName },
          select: { id: true },
        }),
      `getCachedChannelId(${channelName})`
    );

    // Handle null from retry failure or channel not found
    if (!result) {
      return null;
    }

    const channelId = (result as { id: string }).id;

    // Store in cache (5 min TTL)
    cacheManager.set(cacheKey, channelId, CacheTTL.MEDIUM);

    return channelId;
  }

  /**
   * 保存訊息至資料庫（帶快取優化）
   * @param channelName Twitch 頻道名稱 (小寫)
   * @param message 解析後的訊息（可以是 ParsedMessage 或 RawChatMessage）
   */
  async saveMessage(channelName: string, messageInput: MessageInput): Promise<void> {
    // 統一轉換為 ParsedMessage
    const message: ParsedMessage = isRawChatMessage(messageInput)
      ? MessageParser.fromRawMessage(messageInput)
      : messageInput;

    try {
      // 1. 使用快取查找 Viewer（避免重複 DB 查詢）
      const viewerId = await this.getCachedViewerId(message.twitchUserId);

      if (!viewerId) {
        // 非註冊 Viewer，快速跳過（不需查 DB）
        return;
      }

      // 2. 使用快取查找 Channel
      const channelId = await this.getCachedChannelId(channelName);

      if (!channelId) {
        return;
      }

      // 3. 寫入詳細記錄（只有註冊用戶的訊息才會到這裡）
      await prisma.viewerChannelMessage.create({
        data: {
          viewerId,
          channelId,
          messageText: message.messageText,
          messageType: message.messageType,
          timestamp: message.timestamp,
          badges: message.badges ? JSON.stringify(message.badges) : null,
          emotesUsed: message.emotes ? JSON.stringify(message.emotes) : null,
          bitsAmount: message.bits > 0 ? message.bits : null,
        },
      });

      // 4. 即時更新每日聚合 (Upsert)
      const date = new Date(message.timestamp);
      date.setHours(0, 0, 0, 0);

      await prisma.viewerChannelMessageDailyAgg.upsert({
        where: {
          viewerId_channelId_date: {
            viewerId,
            channelId,
            date,
          },
        },
        create: {
          viewerId,
          channelId,
          date,
          totalMessages: 1,
          chatMessages: message.messageType === "CHAT" ? 1 : 0,
          subscriptions: message.messageType === "SUBSCRIPTION" ? 1 : 0,
          cheers: message.messageType === "CHEER" ? 1 : 0,
          raids: message.messageType === "RAID" ? 1 : 0,
          totalBits: message.bits,
        },
        update: {
          totalMessages: { increment: 1 },
          chatMessages: message.messageType === "CHAT" ? { increment: 1 } : undefined,
          subscriptions: message.messageType === "SUBSCRIPTION" ? { increment: 1 } : undefined,
          cheers: message.messageType === "CHEER" ? { increment: 1 } : undefined,
          raids: message.messageType === "RAID" ? { increment: 1 } : undefined,
          totalBits: message.bits > 0 ? { increment: message.bits } : undefined,
        },
      });

      // 同步更新 ViewerChannelDailyStat (Format that Dashboard uses)
      await prisma.viewerChannelDailyStat.upsert({
        where: {
          viewerId_channelId_date: {
            viewerId,
            channelId,
            date,
          },
        },
        create: {
          viewerId,
          channelId,
          date,
          messageCount: 1,
          emoteCount: message.emotes ? message.emotes.length : 0,
          watchSeconds: 0, // Will be calculated by watch-time.service
        },
        update: {
          messageCount: { increment: 1 },
          emoteCount: message.emotes ? { increment: message.emotes.length } : undefined,
        },
      });

      // 5. P2 Perf: Use static imports instead of dynamic imports on every message
      updateViewerWatchTime(viewerId, channelId, message.timestamp).catch((err) =>
        logger.error("ViewerMessage", "Failed to update watch time", err)
      );

      // P1 Optimization: Removed real-time WebSocket stats-update broadcast
      // Message counts are now fetched via React Query refetchInterval instead
    } catch (error) {
      logger.error("ViewerMessage", "Error saving message", error);
    }
  }
}

export const viewerMessageRepository = new ViewerMessageRepository();
