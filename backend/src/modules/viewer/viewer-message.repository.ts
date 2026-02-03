import { prisma } from "../../db/prisma";
import { ParsedMessage, RawChatMessage, MessageParser } from "../../utils/message-parser";
import { logger } from "../../utils/logger";
import { cacheManager, CacheTTL } from "../../utils/cache-manager";
import { updateViewerWatchTime } from "../../services/watch-time.service";

// 可以接受 ParsedMessage 或 RawChatMessage
type MessageInput = ParsedMessage | RawChatMessage;

// 批次寫入配置
const MESSAGE_BATCH_SIZE = 50;
const MESSAGE_BATCH_FLUSH_MS = 5000;
const MESSAGE_BATCH_MAX_SIZE = 1000;

// 類型守衛：檢查是否為 RawChatMessage
function isRawChatMessage(msg: MessageInput): msg is RawChatMessage {
  return "viewerId" in msg && "bitsAmount" in msg;
}

/**
 * 判斷錯誤是否為可重試的 Turso 暫時性錯誤
 * - 400/404/502/503: Turso 連線問題（已知的暫時性錯誤）
 * - fetch failed: 網路層級錯誤
 * - ECONNRESET/ETIMEDOUT: 網路連線問題
 */
function isRetryableError(errorMessage: string): { retryable: boolean; errorType: string } {
  const lowerMessage = errorMessage.toLowerCase();

  if (lowerMessage.includes("502") || lowerMessage.includes("bad gateway")) {
    return { retryable: true, errorType: "502" };
  }
  if (lowerMessage.includes("503") || lowerMessage.includes("service unavailable")) {
    return { retryable: true, errorType: "503" };
  }
  if (lowerMessage.includes("http status 400") || lowerMessage.includes("server_error")) {
    return { retryable: true, errorType: "400" };
  }
  if (lowerMessage.includes("http status 404") || lowerMessage.includes("404")) {
    return { retryable: true, errorType: "404" };
  }
  if (lowerMessage.includes("fetch failed") || lowerMessage.includes("network")) {
    return { retryable: true, errorType: "network" };
  }
  if (lowerMessage.includes("econnreset") || lowerMessage.includes("etimedout")) {
    return { retryable: true, errorType: "connection" };
  }
  if (lowerMessage.includes("batch request")) {
    return { retryable: true, errorType: "batch" };
  }

  return { retryable: false, errorType: "unknown" };
}

/**
 * 重試包裝器：針對 Turso 暫時性錯誤進行重試
 * 優化日誌：重試過程用 debug，只在最終失敗時才輸出 error
 */
async function retryOnTursoError<T>(
  operation: () => Promise<T>,
  context: string,
  maxRetries = 3
): Promise<T | null> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await operation();
      // 如果是重試後成功，記錄一下
      if (attempt > 1) {
        logger.debug("ViewerMessage", `${context} succeeded on retry ${attempt}`);
      }
      return result;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const { retryable, errorType } = isRetryableError(errorMessage);

      if (retryable && attempt < maxRetries) {
        const delay = Math.min(100 * Math.pow(2, attempt - 1), 1000); // 100ms, 200ms, 400ms
        // 使用 debug 級別，減少日誌噪音（生產環境通常不顯示 debug）
        logger.debug(
          "ViewerMessage",
          `${context} failed (${errorType}), retry ${attempt}/${maxRetries} after ${delay}ms`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      // 最後一次嘗試失敗，或非可重試錯誤，記錄並返回 null
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
  private messageBuffer: Array<{
    viewerId: string;
    channelId: string;
    messageText: string;
    messageType: string;
    timestamp: Date;
    badges: string | null;
    emotesUsed: string | null;
    bitsAmount: number | null;
    emoteCount: number;
  }> = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private flushInProgress = false;
  private flushRequested = false;

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

    // Query database with retry on transient errors (400, 502, 503, network)
    const result = await retryOnTursoError(
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

    // Query database with retry on transient errors (400, 502, 503, network)
    const normalizedName = channelName.toLowerCase();
    const result = await retryOnTursoError(
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

      // 3. 批次寫入：將訊息加入緩衝，定期批次寫入 DB
      this.enqueueMessage({
        viewerId,
        channelId,
        messageText: message.messageText,
        messageType: message.messageType,
        timestamp: message.timestamp,
        badges: message.badges ? JSON.stringify(message.badges) : null,
        emotesUsed: message.emotes ? JSON.stringify(message.emotes) : null,
        bitsAmount: message.bits > 0 ? message.bits : null,
        emoteCount: message.emotes ? message.emotes.length : 0,
      });

      // P1 Optimization: Removed real-time WebSocket stats-update broadcast
      // Message counts are now fetched via React Query refetchInterval instead
    } catch (error) {
      logger.error("ViewerMessage", "Error saving message", error);
    }
  }

  private enqueueMessage(message: {
    viewerId: string;
    channelId: string;
    messageText: string;
    messageType: string;
    timestamp: Date;
    badges: string | null;
    emotesUsed: string | null;
    bitsAmount: number | null;
    emoteCount: number;
  }): void {
    if (this.messageBuffer.length >= MESSAGE_BATCH_MAX_SIZE) {
      this.messageBuffer.shift();
      logger.warn("ViewerMessage", "Message buffer full, dropping oldest message");
    }

    this.messageBuffer.push(message);

    if (this.messageBuffer.length >= MESSAGE_BATCH_SIZE) {
      this.flushBuffers().catch((err) =>
        logger.error("ViewerMessage", "Failed to flush message buffer", err)
      );
      return;
    }

    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushBuffers().catch((err) =>
        logger.error("ViewerMessage", "Failed to flush message buffer", err)
      );
    }, MESSAGE_BATCH_FLUSH_MS);
  }

  private async flushBuffers(): Promise<void> {
    if (this.flushInProgress) {
      this.flushRequested = true;
      return;
    }

    this.flushInProgress = true;
    this.flushRequested = false;

    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    try {
      while (this.messageBuffer.length > 0) {
        const batch = this.messageBuffer.splice(0, MESSAGE_BATCH_SIZE);
        await this.flushBatch(batch);
      }
    } finally {
      this.flushInProgress = false;
      if (this.messageBuffer.length > 0 || this.flushRequested) {
        this.flushRequested = false;
        this.scheduleFlush();
      }
    }
  }

  private async flushBatch(
    batch: Array<{
      viewerId: string;
      channelId: string;
      messageText: string;
      messageType: string;
      timestamp: Date;
      badges: string | null;
      emotesUsed: string | null;
      bitsAmount: number | null;
      emoteCount: number;
    }>
  ): Promise<void> {
    if (batch.length === 0) return;

    const messageAggIncrements = new Map<
      string,
      {
        viewerId: string;
        channelId: string;
        date: Date;
        totalMessages: number;
        chatMessages: number;
        subscriptions: number;
        cheers: number;
        raids: number;
        totalBits: number;
      }
    >();

    const dailyStatIncrements = new Map<
      string,
      {
        viewerId: string;
        channelId: string;
        date: Date;
        messageCount: number;
        emoteCount: number;
      }
    >();

    const watchTimeTargets = new Map<string, { viewerId: string; channelId: string; date: Date }>();

    for (const msg of batch) {
      const date = new Date(msg.timestamp);
      date.setHours(0, 0, 0, 0);
      const key = `${msg.viewerId}:${msg.channelId}:${date.getTime()}`;

      const agg = messageAggIncrements.get(key) || {
        viewerId: msg.viewerId,
        channelId: msg.channelId,
        date,
        totalMessages: 0,
        chatMessages: 0,
        subscriptions: 0,
        cheers: 0,
        raids: 0,
        totalBits: 0,
      };

      agg.totalMessages += 1;
      if (msg.messageType === "CHAT") agg.chatMessages += 1;
      if (msg.messageType === "SUBSCRIPTION") agg.subscriptions += 1;
      if (msg.messageType === "CHEER") agg.cheers += 1;
      if (msg.messageType === "RAID") agg.raids += 1;
      if (msg.bitsAmount) agg.totalBits += msg.bitsAmount;

      messageAggIncrements.set(key, agg);

      const daily = dailyStatIncrements.get(key) || {
        viewerId: msg.viewerId,
        channelId: msg.channelId,
        date,
        messageCount: 0,
        emoteCount: 0,
      };

      daily.messageCount += 1;
      daily.emoteCount += msg.emoteCount;
      dailyStatIncrements.set(key, daily);

      if (!watchTimeTargets.has(key)) {
        watchTimeTargets.set(key, { viewerId: msg.viewerId, channelId: msg.channelId, date });
      }
    }

    try {
      await prisma.$transaction(async (tx) => {
        const messageRows = batch.map((msg) => ({
          viewerId: msg.viewerId,
          channelId: msg.channelId,
          messageText: msg.messageText,
          messageType: msg.messageType,
          timestamp: msg.timestamp,
          badges: msg.badges,
          emotesUsed: msg.emotesUsed,
          bitsAmount: msg.bitsAmount,
        }));
        await tx.viewerChannelMessage.createMany({ data: messageRows });

        for (const agg of messageAggIncrements.values()) {
          await tx.viewerChannelMessageDailyAgg.upsert({
            where: {
              viewerId_channelId_date: {
                viewerId: agg.viewerId,
                channelId: agg.channelId,
                date: agg.date,
              },
            },
            create: {
              viewerId: agg.viewerId,
              channelId: agg.channelId,
              date: agg.date,
              totalMessages: agg.totalMessages,
              chatMessages: agg.chatMessages,
              subscriptions: agg.subscriptions,
              cheers: agg.cheers,
              raids: agg.raids,
              totalBits: agg.totalBits,
            },
            update: {
              totalMessages: { increment: agg.totalMessages },
              chatMessages: agg.chatMessages > 0 ? { increment: agg.chatMessages } : undefined,
              subscriptions: agg.subscriptions > 0 ? { increment: agg.subscriptions } : undefined,
              cheers: agg.cheers > 0 ? { increment: agg.cheers } : undefined,
              raids: agg.raids > 0 ? { increment: agg.raids } : undefined,
              totalBits: agg.totalBits > 0 ? { increment: agg.totalBits } : undefined,
            },
          });
        }

        for (const daily of dailyStatIncrements.values()) {
          await tx.viewerChannelDailyStat.upsert({
            where: {
              viewerId_channelId_date: {
                viewerId: daily.viewerId,
                channelId: daily.channelId,
                date: daily.date,
              },
            },
            create: {
              viewerId: daily.viewerId,
              channelId: daily.channelId,
              date: daily.date,
              messageCount: daily.messageCount,
              emoteCount: daily.emoteCount,
              watchSeconds: 0,
            },
            update: {
              messageCount: { increment: daily.messageCount },
              emoteCount: daily.emoteCount > 0 ? { increment: daily.emoteCount } : undefined,
            },
          });
        }
      });

      for (const target of watchTimeTargets.values()) {
        updateViewerWatchTime(target.viewerId, target.channelId, target.date).catch((err) =>
          logger.error("ViewerMessage", "Failed to update watch time", err)
        );
      }
    } catch (error) {
      logger.error("ViewerMessage", "Failed to flush message batch", error);
      this.messageBuffer.unshift(...batch);
      this.scheduleFlush();
    }
  }
}

export const viewerMessageRepository = new ViewerMessageRepository();
