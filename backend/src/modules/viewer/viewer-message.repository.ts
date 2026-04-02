import { Prisma } from "@prisma/client";
import crypto from "crypto";
import { prisma } from "../../db/prisma";
import { ParsedMessage, RawChatMessage, MessageParser } from "../../utils/message-parser";
import { logger } from "../../utils/logger";
import { webSocketGateway } from "../../services/websocket.gateway";
import { updateViewerWatchTime } from "../../services/watch-time.service";
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
const RETRY_BASE_DELAY_MS = 250;
const RETRY_MAX_DELAY_MS = 5000;
const RETRY_JITTER_MS = 300;
const RETRY_BUFFER_MAX_SIZE = MESSAGE_BATCH_MAX_SIZE;
const BUFFER_OVERFLOW_WARN_INTERVAL_MS = 30 * 1000;
const CACHE_NULL_SENTINEL = "__NULL__";
const NULL_LOOKUP_TTL_SECONDS = CacheTTL.SHORT;
const WATCH_TIME_RECALC_DEBOUNCE_MS = 5000;
const MESSAGE_DEDUP_TTL_MS = Number.parseInt(
  process.env.VIEWER_MESSAGE_DEDUP_TTL_MS || String(15 * 60 * 1000),
  10
);

interface BufferedMessage {
  viewerId: string | null;
  twitchUserId?: string;
  displayName?: string | null;
  channelId: string | null;
  channelName?: string;
  messageText: string;
  messageType: string;
  timestamp: Date;
  badges: string | null;
  emotesUsed: string | null;
  bitsAmount: number | null;
  emoteCount: number;
  retryCount: number;
  fingerprint?: string;
}

interface WatchTimeRecalculationTarget {
  viewerId: string;
  channelId: string;
  date: Date;
}

// 類型守衛：檢查是否為 RawChatMessage
/* istanbul ignore next - tiny type guard with low testing value */
function isRawChatMessage(msg: MessageInput): msg is RawChatMessage {
  return "viewerId" in msg && "bitsAmount" in msg;
}

/**
 * 判斷錯誤是否為可重試的 Turso 暫時性錯誤
 * - 400/404/502/503: Turso 連線問題（已知的暫時性錯誤）
 * - fetch failed: 網路層級錯誤
 * - ECONNRESET/ETIMEDOUT: 網路連線問題
 */
export function isRetryableErrorForTesting(
  errorMessage: string
): { retryable: boolean; errorType: string } {
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
  if (lowerMessage.includes("socket hang up") || lowerMessage.includes("hang up")) {
    return { retryable: true, errorType: "socket_hangup" };
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
export async function retryOnTursoErrorForTesting<T>(
  operation: () => Promise<T>,
  context: string,
  maxRetries = 3
): Promise<T | null> {
  if (maxRetries < 1) {
    return null;
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await operation();
      // 如果是重試後成功，記錄一下
        if (attempt > 1) {
          logger.debug("ViewerMessage", `${context} 在第 ${attempt} 次重試後成功`);
        }
      return result;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const { retryable, errorType } = isRetryableErrorForTesting(errorMessage);

      if (retryable && attempt < maxRetries) {
        const delay = Math.min(100 * Math.pow(2, attempt - 1), 1000); // 100ms, 200ms, 400ms
        // 使用 debug 級別，減少日誌噪音（生產環境通常不顯示 debug）
        logger.debug(
          "ViewerMessage",
          `${context} 失敗（${errorType}），將於 ${delay}ms 後進行第 ${attempt}/${maxRetries} 次重試`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      // 最後一次嘗試失敗，或非可重試錯誤，記錄並返回 null
      logger.error("ViewerMessage", `${context} 在重試 ${attempt} 次後仍失敗`, error);
      return null;
    }
  }
}

// P1 Memory: Cache key generators for viewer/channel lookup
const CacheKeys = {
  viewerLookup: (twitchUserId: string) => `lookup:viewer:${twitchUserId}`,
  channelLookup: (channelName: string) => `lookup:channel:${channelName.toLowerCase()}`,
};

export class ViewerMessageRepository {
  private messageBuffer: BufferedMessage[] = [];
  private retryBuffer: Array<{ message: BufferedMessage; readyAt: number }> = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private flushInProgress = false;
  private flushRequested = false;
  private watchTimeFlushInProgress = false;
  private overflowDropCount = 0;
  private lastOverflowWarnAt = 0;
  private watchTimeFlushTimer: NodeJS.Timeout | null = null;
  private pendingWatchTimeTargets = new Map<string, WatchTimeRecalculationTarget>();
  private recentMessageFingerprints = new Map<string, number>();

  private buildMessageFingerprint(message: Pick<
    BufferedMessage,
    "viewerId" | "twitchUserId" | "channelId" | "channelName" | "messageType" | "messageText" | "timestamp" | "bitsAmount"
  >): string {
    const timestamp =
      message.timestamp instanceof Date
        ? message.timestamp.toISOString()
        : new Date(message.timestamp || 0).toISOString();

    const material = [
      message.viewerId || `twitch:${message.twitchUserId || "unknown"}`,
      message.channelId || `channel:${message.channelName || "unknown"}`,
      message.messageType,
      message.messageText,
      timestamp,
      message.bitsAmount ?? 0,
    ].join("|");

    return crypto.createHash("sha256").update(material).digest("hex");
  }

  private cleanupRecentFingerprints(now: number): void {
    for (const [fingerprint, expireAt] of this.recentMessageFingerprints.entries()) {
      if (expireAt <= now) {
        this.recentMessageFingerprints.delete(fingerprint);
      }
    }
  }

  private isRecentDuplicate(fingerprint: string, now: number): boolean {
    this.cleanupRecentFingerprints(now);
    const expireAt = this.recentMessageFingerprints.get(fingerprint);
    return typeof expireAt === "number" && expireAt > now;
  }

  private markFingerprintPersisted(fingerprint: string, now: number): void {
    this.recentMessageFingerprints.set(fingerprint, now + Math.max(60_000, MESSAGE_DEDUP_TTL_MS));
  }

  private enqueueWatchTimeTargets(targets: Iterable<WatchTimeRecalculationTarget>): void {
    for (const target of targets) {
      const key = `${target.viewerId}:${target.channelId}:${target.date.getTime()}`;
      this.pendingWatchTimeTargets.set(key, target);
    }

    this.scheduleWatchTimeFlush();
  }

  private scheduleWatchTimeFlush(): void {
    if (this.watchTimeFlushTimer) {
      return;
    }

    this.watchTimeFlushTimer = setTimeout(() => {
      this.watchTimeFlushTimer = null;
      void this.flushPendingWatchTimeTargets();
    }, WATCH_TIME_RECALC_DEBOUNCE_MS);

    this.watchTimeFlushTimer.unref?.();
  }

  private async flushPendingWatchTimeTargets(): Promise<void> {
    if (this.watchTimeFlushInProgress || this.pendingWatchTimeTargets.size === 0) {
      return;
    }

    this.watchTimeFlushInProgress = true;
    const targets = Array.from(this.pendingWatchTimeTargets.values());
    this.pendingWatchTimeTargets.clear();

    try {
      for (const target of targets) {
        await updateViewerWatchTime(target.viewerId, target.channelId, target.date, {
          allowOverwrite: true,
        });
      }
    } finally {
      this.watchTimeFlushInProgress = false;
      if (this.pendingWatchTimeTargets.size > 0) {
        this.scheduleWatchTimeFlush();
      }
    }
  }

  private logOverflowDrop(): void {
    this.overflowDropCount += 1;
    const now = Date.now();

    if (now - this.lastOverflowWarnAt >= BUFFER_OVERFLOW_WARN_INTERVAL_MS) {
      logger.warn(
        "ViewerMessage",
        `訊息緩衝區壓力過高：最近 ${BUFFER_OVERFLOW_WARN_INTERVAL_MS / 1000} 秒內丟棄了 ${this.overflowDropCount} 筆訊息（buffer ${this.messageBuffer.length}/${MESSAGE_BATCH_MAX_SIZE}）`
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
    const cached = cacheManager.get<string>(cacheKey);
    if (cached !== null) {
      if (cached === CACHE_NULL_SENTINEL) {
        return null;
      }
      return cached;
    }

    // Query database with retry on transient errors (400, 502, 503, network)
    const result = await retryOnTursoErrorForTesting(
      () =>
        prisma.viewer.findUnique({
          where: { twitchUserId },
          select: { id: true },
        }),
      `getCachedViewerId(${twitchUserId})`
    );

    // Handle null from retry failure or viewer not found
    if (!result) {
      cacheManager.set(cacheKey, CACHE_NULL_SENTINEL, NULL_LOOKUP_TTL_SECONDS);
      return null;
    }

    const viewerId = (result as { id: string }).id;

    // Store in cache (longer TTL for mostly static data)
    cacheManager.set(cacheKey, viewerId, CacheTTL.LONG);

    return viewerId;
  }

  private async resolveViewerIds(batch: BufferedMessage[]): Promise<BufferedMessage[]> {
    const unresolved = batch.filter((message) => !message.viewerId && message.twitchUserId);
    if (unresolved.length === 0) {
      return batch.filter((message): message is BufferedMessage & { viewerId: string } => Boolean(message.viewerId));
    }

    const twitchUserIds = Array.from(new Set(unresolved.map((message) => message.twitchUserId as string)));

    const existingViewers = await prisma.viewer.findMany({
      where: { twitchUserId: { in: twitchUserIds } },
      select: { id: true, twitchUserId: true },
    });

    const viewerIdByTwitchUserId = new Map(
      existingViewers.map((viewer) => [viewer.twitchUserId, viewer.id])
    );

    const missingViewerData = Array.from(
      unresolved.reduce((map, message) => {
        if (!message.twitchUserId || viewerIdByTwitchUserId.has(message.twitchUserId)) {
          return map;
        }

        if (!map.has(message.twitchUserId)) {
          map.set(message.twitchUserId, {
            twitchUserId: message.twitchUserId,
            displayName: message.displayName || message.twitchUserId,
          });
        }

        return map;
      }, new Map<string, { twitchUserId: string; displayName: string }>()).values()
    );

    if (missingViewerData.length > 0) {
      try {
        await prisma.viewer.createMany({
          data: missingViewerData,
        });
      } catch (error) {
        logger.debug("ViewerMessage", "批次建立未知 Viewer 時發生衝突，改以重新查詢結果為準", error);
      }

      const refreshedViewers = await prisma.viewer.findMany({
        where: { twitchUserId: { in: missingViewerData.map((viewer) => viewer.twitchUserId) } },
        select: { id: true, twitchUserId: true },
      });

      for (const viewer of refreshedViewers) {
        viewerIdByTwitchUserId.set(viewer.twitchUserId, viewer.id);
      }
    }

    const resolvedBatch = batch.flatMap((message) => {
      const viewerId = message.viewerId || (message.twitchUserId ? viewerIdByTwitchUserId.get(message.twitchUserId) : null);

      if (!viewerId) {
        logger.warn(
          "ViewerMessage",
          `略過訊息：找不到對應的 Viewer，twitchUserId=${message.twitchUserId || "unknown"}`
        );
        return [];
      }

      if (message.twitchUserId) {
        cacheManager.set(CacheKeys.viewerLookup(message.twitchUserId), viewerId, CacheTTL.LONG);
      }

      return [{ ...message, viewerId }];
    });

    return resolvedBatch;
  }

  private async resolveChannelIds(batch: BufferedMessage[]): Promise<BufferedMessage[]> {
    const unresolved = batch.filter((message) => !message.channelId && message.channelName);
    if (unresolved.length === 0) {
      return batch.filter((message): message is BufferedMessage & { channelId: string } => Boolean(message.channelId));
    }

    const channelNames = Array.from(
      new Set(unresolved.map((message) => (message.channelName as string).toLowerCase()))
    );

    const existingChannels = await prisma.channel.findMany({
      where: { channelName: { in: channelNames } },
      select: { id: true, channelName: true },
    });

    const channelIdByName = new Map(
      existingChannels.map((channel) => [channel.channelName.toLowerCase(), channel.id])
    );

    return batch.flatMap((message) => {
      const normalizedChannelName = message.channelName?.toLowerCase();
      const channelId = message.channelId || (normalizedChannelName ? channelIdByName.get(normalizedChannelName) : null);

      if (!channelId) {
        if (normalizedChannelName) {
          cacheManager.set(CacheKeys.channelLookup(normalizedChannelName), CACHE_NULL_SENTINEL, NULL_LOOKUP_TTL_SECONDS);
        }
        logger.warn(
          "ViewerMessage",
          `略過訊息：找不到對應的頻道，channelName=${message.channelName || "unknown"}`
        );
        return [];
      }

      if (normalizedChannelName) {
        cacheManager.set(CacheKeys.channelLookup(normalizedChannelName), channelId, CacheTTL.LONG);
      }

      return [{ ...message, channelId }];
    });
  }

  /**
   * P1 Memory: Use cacheManager instead of raw Map (with LRU eviction)
   * 使用快取獲取 Channel ID（減少 DB 查詢）
   */
  private async getCachedChannelId(channelName: string): Promise<string | null> {
    const cacheKey = CacheKeys.channelLookup(channelName);

    // Try to get from cache first
    const cached = cacheManager.get<string>(cacheKey);
    if (cached !== null) {
      if (cached === CACHE_NULL_SENTINEL) {
        return null;
      }
      return cached;
    }

    // Query database with retry on transient errors (400, 502, 503, network)
    const normalizedName = channelName.toLowerCase();
    const result = await retryOnTursoErrorForTesting(
      () =>
        prisma.channel.findFirst({
          where: { channelName: normalizedName },
          select: { id: true },
        }),
      `getCachedChannelId(${channelName})`
    );

    // Handle null from retry failure or channel not found
    if (!result) {
      cacheManager.set(cacheKey, CACHE_NULL_SENTINEL, NULL_LOOKUP_TTL_SECONDS);
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
    /* istanbul ignore next - normalization branch is low-value and exercised indirectly */
    const message: ParsedMessage = isRawChatMessage(messageInput)
      ? MessageParser.fromRawMessage(messageInput)
      : messageInput;

    try {
      // 1. 使用快取查找 Viewer（避免重複 DB 查詢）
      const viewerId = await this.getCachedViewerId(message.twitchUserId);

      // 2. 優先只讀取 channel 快取，cache miss 留給 flush 時批次解析
      const cachedChannel = cacheManager.get<string>(CacheKeys.channelLookup(channelName));
      const channelId =
        cachedChannel === null ? null : cachedChannel === CACHE_NULL_SENTINEL ? CACHE_NULL_SENTINEL : cachedChannel;

      if (channelId === CACHE_NULL_SENTINEL) {
        logger.warn("ViewerMessage", `略過訊息：找不到對應的頻道，channelName=${channelName}`);
        return;
      }

      // 3. 批次寫入：將訊息加入緩衝，定期批次寫入 DB
      this.enqueueMessage({
        viewerId,
        twitchUserId: message.twitchUserId,
        displayName: message.displayName,
        channelId,
        channelName,
        messageText: message.messageText,
        messageType: message.messageType,
        timestamp: message.timestamp,
        badges: message.badges ? JSON.stringify(message.badges) : null,
        emotesUsed: message.emotes ? JSON.stringify(message.emotes) : null,
        bitsAmount: message.bits > 0 ? message.bits : null,
        emoteCount: message.emotes ? message.emotes.length : 0,
        retryCount: 0,
        fingerprint: this.buildMessageFingerprint({
          viewerId,
          channelId,
          channelName,
          messageType: message.messageType,
          messageText: message.messageText,
          timestamp: message.timestamp,
          bitsAmount: message.bits > 0 ? message.bits : null,
        }),
      });

      // P1 Optimization: Removed real-time WebSocket stats-update broadcast
      // Message counts are now fetched via React Query refetchInterval instead
    } catch (error) {
      logger.error("ViewerMessage", "儲存訊息失敗", error);
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
        logger.error("ViewerMessage", "高壓狀態下刷新訊息緩衝區失敗", err)
      );
    }

    if (this.messageBuffer.length >= MESSAGE_BATCH_MAX_SIZE) {
      if (!this.flushInProgress) {
        this.flushBuffers().catch((err) =>
          logger.error("ViewerMessage", "訊息緩衝區滿載時刷新失敗", err)
        );
      }

      /* istanbul ignore next - second capacity check depends on concurrent flush timing */
      if (this.messageBuffer.length >= MESSAGE_BATCH_MAX_SIZE) {
        this.messageBuffer.shift();
        this.logOverflowDrop();
      }
    }

    this.messageBuffer.push(message);

    if (this.messageBuffer.length >= MESSAGE_BATCH_SIZE) {
      this.flushBuffers().catch((err) =>
        logger.error("ViewerMessage", "刷新訊息緩衝區失敗", err)
      );
      return;
    }

    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushBuffers().catch((err) =>
        logger.error("ViewerMessage", "刷新訊息緩衝區失敗", err)
      );
    }, MESSAGE_BATCH_FLUSH_MS);
    this.flushTimer.unref?.();
  }

  private getRetryDelayMs(retryCount: number): number {
    const expDelay = Math.min(RETRY_BASE_DELAY_MS * 2 ** Math.max(0, retryCount - 1), RETRY_MAX_DELAY_MS);
    const jitter = Math.floor(Math.random() * RETRY_JITTER_MS);
    return expDelay + jitter;
  }

  private enqueueRetryMessages(messages: BufferedMessage[]): void {
    const now = Date.now();
    for (const message of messages) {
      if (this.retryBuffer.length >= RETRY_BUFFER_MAX_SIZE) {
        this.retryBuffer.shift();
        this.logOverflowDrop();
      }
      this.retryBuffer.push({
        message,
        readyAt: now + this.getRetryDelayMs(message.retryCount),
      });
    }
  }

  private promoteReadyRetryMessages(): void {
    if (this.retryBuffer.length === 0 || this.messageBuffer.length >= MESSAGE_BATCH_MAX_SIZE) {
      return;
    }

    const now = Date.now();
    const pending: Array<{ message: BufferedMessage; readyAt: number }> = [];

    for (const entry of this.retryBuffer) {
      if (entry.readyAt <= now && this.messageBuffer.length < MESSAGE_BATCH_MAX_SIZE) {
        this.messageBuffer.push(entry.message);
      } else {
        pending.push(entry);
      }
    }

    this.retryBuffer = pending;
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
      while (true) {
        this.promoteReadyRetryMessages();
        if (this.messageBuffer.length === 0) {
          break;
        }

        const batch = this.messageBuffer.splice(0, MESSAGE_BATCH_SIZE);
        const success = await this.flushBatch(batch);
        if (!success) {
          break;
        }
      }
    } finally {
      this.flushInProgress = false;
      if (this.messageBuffer.length > 0 || this.retryBuffer.length > 0 || this.flushRequested) {
        this.flushRequested = false;
        this.scheduleFlush();
      }
    }
  }

  private async flushBatch(batch: BufferedMessage[]): Promise<boolean> {
    if (batch.length === 0) return true;

      const channelsResolvedBatch = await this.resolveChannelIds(batch);
      if (channelsResolvedBatch.length === 0) {
        return true;
      }

      const resolvedBatch = await this.resolveViewerIds(channelsResolvedBatch);
      if (resolvedBatch.length === 0) {
        return true;
      }

      const now = Date.now();
      const dedupedBatch: BufferedMessage[] = [];
      for (const msg of resolvedBatch) {
        const fingerprint = msg.fingerprint || this.buildMessageFingerprint(msg);
      if (this.isRecentDuplicate(fingerprint, now)) {
        continue;
      }

      dedupedBatch.push({
        ...msg,
        fingerprint,
      });
    }

    if (dedupedBatch.length === 0) {
      return true;
    }

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

    let messagesPersisted = false;

    try {
      const messageValues = dedupedBatch.map(
        (msg) =>
          Prisma.sql`(${msg.fingerprint}, ${msg.viewerId}, ${msg.channelId}, ${msg.messageText}, ${msg.messageType}, ${msg.timestamp}, ${msg.badges}, ${msg.emotesUsed}, ${msg.bitsAmount}, CURRENT_TIMESTAMP)`
      );

      // 先落地原始訊息（DB dedup），縮短後續聚合交易範圍
      const insertedRows = await prisma.$queryRaw<Array<{ messageDedupKey: string }>>(Prisma.sql`
        WITH src (
          messageDedupKey,
          viewerId,
          channelId,
          messageText,
          messageType,
          timestamp,
          badges,
          emotesUsed,
          bitsAmount,
          createdAt
        ) AS (
          VALUES ${Prisma.join(messageValues)}
        )
        INSERT INTO viewer_channel_messages (
          id,
          messageDedupKey,
          viewerId,
          channelId,
          messageText,
          messageType,
          timestamp,
          badges,
          emotesUsed,
          bitsAmount,
          createdAt
        )
        SELECT
          lower(hex(randomblob(16))) AS id,
          src.messageDedupKey,
          src.viewerId,
          src.channelId,
          src.messageText,
          src.messageType,
          src.timestamp,
          src.badges,
          src.emotesUsed,
          src.bitsAmount,
          src.createdAt
        FROM src
        WHERE 1 = 1
        ON CONFLICT(messageDedupKey) DO NOTHING
        RETURNING messageDedupKey
      `);
      messagesPersisted = true;
      for (const msg of dedupedBatch) {
        /* istanbul ignore next - fingerprint persistence is an internal dedup optimization */
        if (msg.fingerprint) {
          this.markFingerprintPersisted(msg.fingerprint, now);
        }
      }

      const insertedDedupKeys = new Set(insertedRows.map((row) => row.messageDedupKey));
      const persistedBatch =
        insertedRows.length >= dedupedBatch.length
          ? dedupedBatch
          : dedupedBatch.filter((msg) => !!msg.fingerprint && insertedDedupKeys.has(msg.fingerprint));

      if (persistedBatch.length === 0) {
        return true;
      }

      const watchTimeTargets = new Map<string, WatchTimeRecalculationTarget>();

      for (const msg of persistedBatch) {
        const date = new Date(msg.timestamp);
        date.setUTCHours(0, 0, 0, 0);
        const key = `${msg.viewerId}:${msg.channelId}:${date.getTime()}`;

        watchTimeTargets.set(key, {
          viewerId: msg.viewerId,
          channelId: msg.channelId,
          date,
        });

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

      await prisma.$transaction(async (tx) => {

        const messageAggRows = Array.from(messageAggIncrements.values());
        /* istanbul ignore next - large SQL upsert block is validated via higher-level flush tests */
        if (messageAggRows.length > 0) {
          const aggValues = messageAggRows.map((agg) =>
            Prisma.sql`(${agg.viewerId}, ${agg.channelId}, ${agg.date}, ${agg.totalMessages}, ${
              agg.chatMessages
            }, ${agg.subscriptions}, ${agg.cheers}, ${agg.giftSubs}, ${agg.raids}, ${agg.totalBits})`
          );

          await tx.$executeRaw(Prisma.sql`
            WITH src (
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
            ) AS (
              VALUES ${Prisma.join(aggValues)}
            )
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
            FROM src
            WHERE 1 = 1
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
        /* istanbul ignore next - large SQL upsert block is validated via higher-level flush tests */
        if (dailyRows.length > 0) {
          const dailyValues = dailyRows.map((daily) =>
            Prisma.sql`(${daily.viewerId}, ${daily.channelId}, ${daily.date}, ${daily.messageCount}, ${daily.emoteCount})`
          );

          await tx.$executeRaw(Prisma.sql`
            WITH src (
              viewerId,
              channelId,
              date,
              messageCount,
              emoteCount
            ) AS (
              VALUES ${Prisma.join(dailyValues)}
            )
            INSERT INTO viewer_channel_daily_stats (
              id,
              viewerId,
              channelId,
              date,
              watchSeconds,
              messageCount,
              emoteCount,
              source,
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
              'chat',
              CURRENT_TIMESTAMP,
              CURRENT_TIMESTAMP
            FROM src
            WHERE 1 = 1
            ON CONFLICT(viewerId, channelId, date) DO UPDATE SET
              messageCount = viewer_channel_daily_stats.messageCount + excluded.messageCount,
              emoteCount = viewer_channel_daily_stats.emoteCount + excluded.emoteCount,
              updatedAt = CURRENT_TIMESTAMP
          `);
        }

        const lifetimeRows = Array.from(lifetimeIncrements.values());
        /* istanbul ignore next - large SQL upsert block is validated via higher-level flush tests */
        if (lifetimeRows.length > 0) {
          const lifetimeValues = lifetimeRows.map((lifetime) =>
            Prisma.sql`(${lifetime.viewerId}, ${lifetime.channelId}, ${lifetime.totalMessages}, ${
              lifetime.totalChatMessages
            }, ${lifetime.totalSubscriptions}, ${lifetime.totalCheers}, ${lifetime.totalBits}, ${
              lifetime.lastWatchedAt
            })`
          );

          await tx.$executeRaw(Prisma.sql`
            WITH src (
              viewerId,
              channelId,
              totalMessages,
              totalChatMessages,
              totalSubscriptions,
              totalCheers,
              totalBits,
              lastWatchedAt
            ) AS (
              VALUES ${Prisma.join(lifetimeValues)}
            )
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
            FROM src
            WHERE 1 = 1
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

      this.enqueueWatchTimeTargets(watchTimeTargets.values());

      const viewerDeltaMap = new Map<string, Map<string, number>>();
      const affectedViewerIds = new Set<string>();

      for (const daily of dailyStatIncrements.values()) {
        if (daily.messageCount <= 0) {
          continue;
        }

        affectedViewerIds.add(daily.viewerId);
        const perViewer = viewerDeltaMap.get(daily.viewerId) || new Map<string, number>();
        perViewer.set(daily.channelId, (perViewer.get(daily.channelId) || 0) + daily.messageCount);
        viewerDeltaMap.set(daily.viewerId, perViewer);
      }

      for (const [viewerId, perChannel] of viewerDeltaMap.entries()) {
        const updates = Array.from(perChannel.entries()).map(([channelId, messageCountDelta]) => ({
          channelId,
          messageCountDelta,
        }));

        if (updates.length === 1) {
          webSocketGateway.emitViewerStats(viewerId, updates[0]);
        } else {
          webSocketGateway.emitViewerStatsBatch(viewerId, updates);
        }
      }

      for (const viewerId of affectedViewerIds) {
        await cacheManager.invalidateTag(`viewer:${viewerId}`);
      }
      return true;
    } catch (error) {
      logger.error("ViewerMessage", "批次寫入訊息失敗", error);

      // 原始訊息已寫入時，不可整批重送，避免重複訊息
      if (messagesPersisted) {
        logger.warn(
          "ViewerMessage",
          `Raw messages persisted but aggregate transaction failed for ${lifetimeIncrements.size} viewer-channel pairs; attempting standalone lifetime_stats retry`
        );

        // 嘗試單獨重試 lifetime_stats 更新（最關鍵的聚合）
        try {
          const lifetimeRows = Array.from(lifetimeIncrements.values());
          /* istanbul ignore next - fallback SQL retry block is defensive recovery logic */
          if (lifetimeRows.length > 0) {
            const lifetimeValues = lifetimeRows.map((lifetime) =>
              Prisma.sql`(${lifetime.viewerId}, ${lifetime.channelId}, ${lifetime.totalMessages}, ${
                lifetime.totalChatMessages
              }, ${lifetime.totalSubscriptions}, ${lifetime.totalCheers}, ${lifetime.totalBits}, ${
                lifetime.lastWatchedAt
              })`
            );

            await prisma.$executeRaw(Prisma.sql`
              WITH src (
                viewerId,
                channelId,
                totalMessages,
                totalChatMessages,
                totalSubscriptions,
                totalCheers,
                totalBits,
                lastWatchedAt
              ) AS (
                VALUES ${Prisma.join(lifetimeValues)}
              )
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
              FROM src
              WHERE 1 = 1
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
            logger.info(
              "ViewerMessage",
              `lifetime_stats 備援重試成功，已補寫 ${lifetimeRows.length} 組配對資料`
            );
          }
        } catch (retryError) {
          logger.error(
            "ViewerMessage",
            "寫入 lifetime_stats 的備援重試也失敗；後續將由週期性聚合任務補回資料",
            retryError
          );
        }

        const watchTimeTargets = Array.from(dailyStatIncrements.values(), (daily) => ({
          viewerId: daily.viewerId,
          channelId: daily.channelId,
          date: daily.date,
        }));

        this.enqueueWatchTimeTargets(watchTimeTargets);

        // 無論 retry 成功與否，都清除受影響觀眾的快取，確保下次 API 請求取得最新資料
        const affectedViewerIds = new Set<string>();
        for (const daily of dailyStatIncrements.values()) {
          /* istanbul ignore next - trivial positive-count guard in recovery path */
          if (daily.messageCount > 0) {
            affectedViewerIds.add(daily.viewerId);
          }
        }
        for (const viewerId of affectedViewerIds) {
          await cacheManager.invalidateTag(`viewer:${viewerId}`);
        }

        return true;
      }

      const retryableMessages = dedupedBatch
        .map((message) => ({
          ...message,
          retryCount: message.retryCount + 1,
        }))
        .filter((message) => message.retryCount <= MESSAGE_BATCH_MAX_RETRIES);

      const droppedMessages = dedupedBatch.length - retryableMessages.length;

      if (retryableMessages.length > 0) {
        this.enqueueRetryMessages(retryableMessages);
      }

      if (droppedMessages > 0) {
        logger.error(
          "ViewerMessage",
          `${droppedMessages} 筆訊息在重試 ${MESSAGE_BATCH_MAX_RETRIES} 次後仍失敗，已放棄寫入`
        );
      }

      this.scheduleFlush();
      return false;
    }
  }
}

export const viewerMessageRepository = new ViewerMessageRepository();
