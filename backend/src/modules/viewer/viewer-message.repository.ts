import { prisma } from "../../db/prisma";
import { ParsedMessage, RawChatMessage, MessageParser } from "../../utils/message-parser";
import { logger } from "../../utils/logger";

// 可以接受 ParsedMessage 或 RawChatMessage
type MessageInput = ParsedMessage | RawChatMessage;

// 類型守衛：檢查是否為 RawChatMessage
function isRawChatMessage(msg: MessageInput): msg is RawChatMessage {
  return "viewerId" in msg && "bitsAmount" in msg;
}

// ========== 快取機制（減少 DB 查詢，優化 RAM）==========

// Viewer 快取：twitchUserId -> viewerId（或 null 表示非註冊用戶）
const viewerCache = new Map<string, { viewerId: string | null; expiry: number }>();
// Channel 快取：channelName -> channelId
const channelCache = new Map<string, { channelId: string | null; expiry: number }>();
// 快取過期時間：5 分鐘
const CACHE_TTL_MS = 5 * 60 * 1000;

export class ViewerMessageRepository {
  /**
   * 使用快取獲取 Viewer ID（減少 DB 查詢）
   */
  private async getCachedViewerId(twitchUserId: string): Promise<string | null> {
    const now = Date.now();
    const cached = viewerCache.get(twitchUserId);

    // 如果快取有效，直接返回
    if (cached && cached.expiry > now) {
      return cached.viewerId;
    }

    // 查詢資料庫
    const viewer = await prisma.viewer.findUnique({
      where: { twitchUserId },
      select: { id: true },
    });

    const viewerId = viewer?.id || null;

    // 儲存到快取
    viewerCache.set(twitchUserId, {
      viewerId,
      expiry: now + CACHE_TTL_MS,
    });

    return viewerId;
  }

  /**
   * 使用快取獲取 Channel ID（減少 DB 查詢）
   */
  private async getCachedChannelId(channelName: string): Promise<string | null> {
    const now = Date.now();
    const normalizedName = channelName.toLowerCase();
    const cached = channelCache.get(normalizedName);

    // 如果快取有效，直接返回
    if (cached && cached.expiry > now) {
      return cached.channelId;
    }

    // 查詢資料庫
    const channel = await prisma.channel.findFirst({
      where: { channelName: normalizedName },
      select: { id: true },
    });

    const channelId = channel?.id || null;

    // 儲存到快取
    channelCache.set(normalizedName, {
      channelId,
      expiry: now + CACHE_TTL_MS,
    });

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

      // 5. 觸發觀看時間重新計算（非同步，不阻塞訊息儲存）
      import("../../services/watch-time.service").then(({ updateViewerWatchTime }) => {
        updateViewerWatchTime(viewerId, channelId, message.timestamp).catch((err) =>
          logger.error("ViewerMessage", "Failed to update watch time", err)
        );
      });

      // 6. 觸發 WebSocket 廣播 (即時更新)
      const { webSocketGateway } = await import("../../services/websocket.gateway");
      webSocketGateway.broadcastChannelStats(channelId, {
        channelId,
        messageCount: 1, // 表示這是一條新消息，前端累加
      });
    } catch (error) {
      logger.error("ViewerMessage", "Error saving message", error);
    }
  }
}

export const viewerMessageRepository = new ViewerMessageRepository();
