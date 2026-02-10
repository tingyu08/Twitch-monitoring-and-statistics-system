import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { ParsedMessage, RawChatMessage, MessageParser } from "../../utils/message-parser";
import { logger } from "../../utils/logger";
import { webSocketGateway } from "../../services/websocket.gateway";
import { cacheManager, CacheTTL } from "../../utils/cache-manager";

// 可以接受 ParsedMessage 或 RawChatMessage
type MessageInput = ParsedMessage | RawChatMessage;

// 批次寫入配置
const MESSAGE_BATCH_SIZE = 50;
const MESSAGE_BATCH_FLUSH_MS = 5000;
const DEFAULT_MESSAGE_BUFFER_MAX_SIZE = 3000;
const MESSAGE_BATCH_MAX_SIZE = (() => {
  const parsed = Number.parseInt(
    process.env.VIEWER_MESSAGE_BUFFER_MAX || String(DEFAULT_MESSAGE_BUFFER_MAX_SIZE),
    10
  );

  if (!Number.isFinite(parsed) || parsed < MESSAGE_BATCH_SIZE) {
    return DEFAULT_MESSAGE_BUFFER_MAX_SIZE;
  }

  return parsed;
})();
const MESSAGE_BATCH_SOFT_THRESHOLD = Math.max(
  MESSAGE_BATCH_SIZE,
  Math.floor(MESSAGE_BATCH_MAX_SIZE * 0.8)
);
const MESSAGE_BATCH_MAX_RETRIES = 3;
const BUFFER_OVERFLOW_WARN_INTERVAL_MS = 30 * 1000;

interface BufferedMessage {
  viewerId: string;
  channelId: string;
  messageText: string;
  messageType: string;
  timestamp: Date;
  badges: string | null;
  emotesUsed: string | null;
  bitsAmount: number | null;
  emoteCount: number;
  retryCount: number;
}

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
  private messageBuffer: BufferedMessage[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private flushInProgress = false;
  private flushRequested = false;
  private overflowDropCount = 0;
  private lastOverflowWarnAt = 0;

  private logOverflowDrop(): void {
    this.overflowDropCount += 1;
    const now = Date.now();

    if (now - this.lastOverflowWarnAt >= BUFFER_OVERFLOW_WARN_INTERVAL_MS) {
      logger.warn(
        "ViewerMessage",
        `Message buffer pressure: dropped ${this.overflowDropCount} messages in last ${
          BUFFER_OVERFLOW_WARN_INTERVAL_MS / 1000
        }s (buffer ${this.messageBuffer.length}/${MESSAGE_BATCH_MAX_SIZE})`
      );
      this.lastOverflowWarnAt = now;
      this.overflowDropCount = 0;
    }
  }

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

    // Store in cache (longer TTL for mostly static data)
    cacheManager.set(cacheKey, viewerId, CacheTTL.LONG);

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

    // Store in cache (longer TTL for mostly static data)
    cacheManager.set(cacheKey, channelId, CacheTTL.LONG);

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
        retryCount: 0,
      });

      // P1 Optimization: Removed real-time WebSocket stats-update broadcast
      // Message counts are now fetched via React Query refetchInterval instead
    } catch (error) {
      logger.error("ViewerMessage", "Error saving message", error);
    }
  }

  async flushPendingMessages(): Promise<void> {
    if (this.messageBuffer.length === 0) {
      return;
    }
    await this.flushBuffers();
  }

  private enqueueMessage(message: BufferedMessage): void {
    if (this.messageBuffer.length >= MESSAGE_BATCH_SOFT_THRESHOLD && !this.flushInProgress) {
      this.flushBuffers().catch((err) =>
        logger.error("ViewerMessage", "Failed to flush message buffer under pressure", err)
      );
    }

    if (this.messageBuffer.length >= MESSAGE_BATCH_MAX_SIZE) {
      if (!this.flushInProgress) {
        this.flushBuffers().catch((err) =>
          logger.error("ViewerMessage", "Failed to flush message buffer at capacity", err)
        );
      }

      if (this.messageBuffer.length >= MESSAGE_BATCH_MAX_SIZE) {
        this.messageBuffer.shift();
        this.logOverflowDrop();
      }
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
        const success = await this.flushBatch(batch);
        if (!success) {
          break;
        }
      }
    } finally {
      this.flushInProgress = false;
      if (this.messageBuffer.length > 0 || this.flushRequested) {
        this.flushRequested = false;
        this.scheduleFlush();
      }
    }
  }

  private async flushBatch(batch: BufferedMessage[]): Promise<boolean> {
    if (batch.length === 0) return true;

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
        giftSubs: number;
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

    const lifetimeIncrements = new Map<
      string,
      {
        viewerId: string;
        channelId: string;
        totalMessages: number;
        totalChatMessages: number;
        totalSubscriptions: number;
        totalCheers: number;
        totalBits: number;
        lastWatchedAt: Date;
      }
    >();

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
        giftSubs: 0,
        raids: 0,
        totalBits: 0,
      };

      agg.totalMessages += 1;
      if (msg.messageType === "CHAT") agg.chatMessages += 1;
      if (msg.messageType === "SUBSCRIPTION") agg.subscriptions += 1;
      if (msg.messageType === "CHEER") agg.cheers += 1;
      if (msg.messageType === "GIFT_SUBSCRIPTION") agg.giftSubs += 1;
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

      const lifetimeKey = `${msg.viewerId}:${msg.channelId}`;
      const lifetime = lifetimeIncrements.get(lifetimeKey) || {
        viewerId: msg.viewerId,
        channelId: msg.channelId,
        totalMessages: 0,
        totalChatMessages: 0,
        totalSubscriptions: 0,
        totalCheers: 0,
        totalBits: 0,
        lastWatchedAt: msg.timestamp,
      };

      lifetime.totalMessages += 1;
      if (msg.messageType === "CHAT") lifetime.totalChatMessages += 1;
      if (msg.messageType === "SUBSCRIPTION") lifetime.totalSubscriptions += 1;
      if (msg.messageType === "CHEER") lifetime.totalCheers += 1;
      if (msg.bitsAmount) lifetime.totalBits += msg.bitsAmount;
      if (msg.timestamp > lifetime.lastWatchedAt) {
        lifetime.lastWatchedAt = msg.timestamp;
      }
      lifetimeIncrements.set(lifetimeKey, lifetime);

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

        const messageAggRows = Array.from(messageAggIncrements.values());
        if (messageAggRows.length > 0) {
          const aggValues = messageAggRows.map((agg) =>
            Prisma.sql`(${agg.viewerId}, ${agg.channelId}, ${agg.date}, ${agg.totalMessages}, ${
              agg.chatMessages
            }, ${agg.subscriptions}, ${agg.cheers}, ${agg.giftSubs}, ${agg.raids}, ${agg.totalBits})`
          );

          await tx.$executeRaw(Prisma.sql`
            INSERT INTO viewer_channel_message_daily_aggs (
              id,
              viewerId,
              channelId,
              date,
              totalMessages,
              chatMessages,
              subscriptions,
              cheers,
              giftSubs,
              raids,
              totalBits,
              updatedAt
            )
            SELECT
              lower(hex(randomblob(16))) AS id,
              src.viewerId,
              src.channelId,
              src.date,
              src.totalMessages,
              src.chatMessages,
              src.subscriptions,
              src.cheers,
              src.giftSubs,
              src.raids,
              src.totalBits,
              CURRENT_TIMESTAMP
            FROM (VALUES ${Prisma.join(aggValues)}) AS src(
              viewerId,
              channelId,
              date,
              totalMessages,
              chatMessages,
              subscriptions,
              cheers,
              giftSubs,
              raids,
              totalBits
            )
            ON CONFLICT(viewerId, channelId, date) DO UPDATE SET
              totalMessages = viewer_channel_message_daily_aggs.totalMessages + excluded.totalMessages,
              chatMessages = viewer_channel_message_daily_aggs.chatMessages + excluded.chatMessages,
              subscriptions = viewer_channel_message_daily_aggs.subscriptions + excluded.subscriptions,
              cheers = viewer_channel_message_daily_aggs.cheers + excluded.cheers,
              giftSubs = viewer_channel_message_daily_aggs.giftSubs + excluded.giftSubs,
              raids = viewer_channel_message_daily_aggs.raids + excluded.raids,
              totalBits = COALESCE(viewer_channel_message_daily_aggs.totalBits, 0) + COALESCE(excluded.totalBits, 0),
              updatedAt = CURRENT_TIMESTAMP
          `);
        }

        const dailyRows = Array.from(dailyStatIncrements.values());
        if (dailyRows.length > 0) {
          const dailyValues = dailyRows.map((daily) =>
            Prisma.sql`(${daily.viewerId}, ${daily.channelId}, ${daily.date}, ${daily.messageCount}, ${daily.emoteCount})`
          );

          await tx.$executeRaw(Prisma.sql`
            INSERT INTO viewer_channel_daily_stats (
              id,
              viewerId,
              channelId,
              date,
              watchSeconds,
              messageCount,
              emoteCount,
              createdAt,
              updatedAt
            )
            SELECT
              lower(hex(randomblob(16))) AS id,
              src.viewerId,
              src.channelId,
              src.date,
              0,
              src.messageCount,
              src.emoteCount,
              CURRENT_TIMESTAMP,
              CURRENT_TIMESTAMP
            FROM (VALUES ${Prisma.join(dailyValues)}) AS src(
              viewerId,
              channelId,
              date,
              messageCount,
              emoteCount
            )
            ON CONFLICT(viewerId, channelId, date) DO UPDATE SET
              messageCount = viewer_channel_daily_stats.messageCount + excluded.messageCount,
              emoteCount = viewer_channel_daily_stats.emoteCount + excluded.emoteCount,
              updatedAt = CURRENT_TIMESTAMP
          `);
        }

        const lifetimeRows = Array.from(lifetimeIncrements.values());
        if (lifetimeRows.length > 0) {
          const lifetimeValues = lifetimeRows.map((lifetime) =>
            Prisma.sql`(${lifetime.viewerId}, ${lifetime.channelId}, ${lifetime.totalMessages}, ${
              lifetime.totalChatMessages
            }, ${lifetime.totalSubscriptions}, ${lifetime.totalCheers}, ${lifetime.totalBits}, ${
              lifetime.lastWatchedAt
            })`
          );

          await tx.$executeRaw(Prisma.sql`
            INSERT INTO viewer_channel_lifetime_stats (
              id,
              viewerId,
              channelId,
              totalWatchTimeMinutes,
              totalSessions,
              avgSessionMinutes,
              firstWatchedAt,
              lastWatchedAt,
              totalMessages,
              totalChatMessages,
              totalSubscriptions,
              totalCheers,
              totalBits,
              trackingStartedAt,
              trackingDays,
              longestStreakDays,
              currentStreakDays,
              activeDaysLast30,
              activeDaysLast90,
              mostActiveMonthCount,
              createdAt,
              updatedAt
            )
            SELECT
              lower(hex(randomblob(16))) AS id,
              src.viewerId,
              src.channelId,
              0,
              0,
              0,
              src.lastWatchedAt,
              src.lastWatchedAt,
              src.totalMessages,
              src.totalChatMessages,
              src.totalSubscriptions,
              src.totalCheers,
              src.totalBits,
              CURRENT_TIMESTAMP,
              0,
              0,
              0,
              0,
              0,
              0,
              CURRENT_TIMESTAMP,
              CURRENT_TIMESTAMP
            FROM (VALUES ${Prisma.join(lifetimeValues)}) AS src(
              viewerId,
              channelId,
              totalMessages,
              totalChatMessages,
              totalSubscriptions,
              totalCheers,
              totalBits,
              lastWatchedAt
            )
            ON CONFLICT(viewerId, channelId) DO UPDATE SET
              totalMessages = viewer_channel_lifetime_stats.totalMessages + excluded.totalMessages,
              totalChatMessages = viewer_channel_lifetime_stats.totalChatMessages + excluded.totalChatMessages,
              totalSubscriptions = viewer_channel_lifetime_stats.totalSubscriptions + excluded.totalSubscriptions,
              totalCheers = viewer_channel_lifetime_stats.totalCheers + excluded.totalCheers,
              totalBits = viewer_channel_lifetime_stats.totalBits + excluded.totalBits,
              lastWatchedAt = CASE
                WHEN viewer_channel_lifetime_stats.lastWatchedAt IS NULL THEN excluded.lastWatchedAt
                WHEN excluded.lastWatchedAt > viewer_channel_lifetime_stats.lastWatchedAt THEN excluded.lastWatchedAt
                ELSE viewer_channel_lifetime_stats.lastWatchedAt
              END,
              updatedAt = CURRENT_TIMESTAMP
          `);
        }
      });

      for (const daily of dailyStatIncrements.values()) {
        if (daily.messageCount > 0) {
          webSocketGateway.emitViewerStats(daily.viewerId, {
            channelId: daily.channelId,
            messageCountDelta: daily.messageCount,
          });
          cacheManager.delete(`viewer:${daily.viewerId}:channels_list`);
        }
      }
      return true;
    } catch (error) {
      logger.error("ViewerMessage", "Failed to flush message batch", error);

      const retryableMessages = batch
        .map((message) => ({
          ...message,
          retryCount: message.retryCount + 1,
        }))
        .filter((message) => message.retryCount <= MESSAGE_BATCH_MAX_RETRIES);

      const droppedMessages = batch.length - retryableMessages.length;

      if (retryableMessages.length > 0) {
        this.messageBuffer.unshift(...retryableMessages);
      }

      if (droppedMessages > 0) {
        logger.error(
          "ViewerMessage",
          `Dropped ${droppedMessages} messages after ${MESSAGE_BATCH_MAX_RETRIES} retries`
        );
      }

      this.scheduleFlush();
      return false;
    }
  }
}

export const viewerMessageRepository = new ViewerMessageRepository();
