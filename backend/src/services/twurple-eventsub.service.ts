/**
 * Twurple EventSub Service
 * 使用 @twurple/eventsub-http 處理 Twitch EventSub Webhook 事件
 *
 * 功能：
 * - stream.online: 頻道開台即時通知
 * - stream.offline: 頻道關台即時通知
 * - channel.update: 頻道資訊變更通知
 *
 * 需要配置：
 * - EVENTSUB_SECRET: Webhook 驗證密鑰
 * - EVENTSUB_CALLBACK_URL: 公開的 HTTPS URL (可用 ngrok)
 */

// import type {
//   EventSubMiddleware,
//   EventSubStreamOnlineEvent,
//   EventSubStreamOfflineEvent,
//   EventSubChannelUpdateEvent,
// } from "@twurple/eventsub-http";
// import type { ApiClient } from "@twurple/api";
import type { Application } from "express";

// Types for database query results
interface ChannelResult {
  id: string;
  channelName: string;
  twitchChannelId: string;
  isLive: boolean;
  currentViewerCount: number | null;
  currentStreamStartedAt: Date | null;
  currentGameName: string | null;
}

interface StreamSessionResult {
  id: string;
  channelId: string;
  startedAt: Date;
  endedAt: Date | null;
  durationSeconds: number | null;
  title: string;
  category: string;
}
import { twurpleAuthService } from "./twurple-auth.service";
import { webSocketGateway } from "./websocket.gateway";
import { prisma } from "../db/prisma";
import { logger } from "../utils/logger";
import { retryDatabaseOperation } from "../utils/db-retry";

// EventSub 配置介面
interface EventSubConfig {
  /**
   * Webhook 驗證密鑰
   * 用於驗證來自 Twitch 的請求簽名
   */
  secret: string;
  /**
   * 公開的 HTTPS URL (不含路徑)
   * 例如: https://abc123.ngrok.io
   */
  hostName: string;
  /**
   * Webhook 路徑前綴
   * 預設: /api/eventsub
   */
  pathPrefix?: string;
}

// EventSub 訂閱物件介面
interface EventSubSubscription {
  id: string;
  type: string;
  status: string;
  condition: Record<string, unknown>;
  created_at: string;
  cost: number;
  transport: {
    method: string;
    callback: string;
  };
}

// ApiClient 類型（用於類型斷言）
type ApiClientWithEventSub = {
  eventSub: {
    getSubscriptions(): Promise<{ data: EventSubSubscription[] }>;
    deleteSubscription(id: string): Promise<void>;
    deleteAllSubscriptions(): Promise<void>;
  };
};

class TwurpleEventSubService {
  // EventSubMiddleware 透過動態導入，使用 unknown 類型
  private middleware: unknown = null;
  // ApiClient 透過動態導入，使用 unknown 類型
  private apiClient: unknown = null;
  private isInitialized = false;
  private subscribedChannels: Set<string> = new Set();
  private cheerDailyAggReady = false;
  private cheerDailyAggInitPromise: Promise<void> | null = null;
  private static readonly CHEER_DAILY_AGG_INIT_MAX_RETRIES = 3;
  private static readonly CHEER_DAILY_AGG_INIT_RETRY_BASE_MS = 200;

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async runCheerDailyAggInitWithRetry(operation: () => Promise<void>): Promise<void> {
    for (let attempt = 1; attempt <= TwurpleEventSubService.CHEER_DAILY_AGG_INIT_MAX_RETRIES; attempt += 1) {
      try {
        await operation();
        return;
      } catch (error) {
        if (attempt >= TwurpleEventSubService.CHEER_DAILY_AGG_INIT_MAX_RETRIES) {
          throw error;
        }

        const backoffMs = TwurpleEventSubService.CHEER_DAILY_AGG_INIT_RETRY_BASE_MS * 2 ** (attempt - 1);
        logger.warn(
          "TwurpleEventSub",
          `cheer_daily_agg init failed (attempt ${attempt}/${TwurpleEventSubService.CHEER_DAILY_AGG_INIT_MAX_RETRIES}), retrying in ${backoffMs}ms`,
          error
        );
        await this.sleep(backoffMs);
      }
    }
  }

  private async ensureCheerDailyAggTable(): Promise<void> {
    if (this.cheerDailyAggReady) {
      return;
    }

    if (!this.cheerDailyAggInitPromise) {
      this.cheerDailyAggInitPromise = (async () => {
        await this.runCheerDailyAggInitWithRetry(async () => {
          await prisma.$executeRaw`
            CREATE TABLE IF NOT EXISTS cheer_daily_agg (
              streamerId TEXT NOT NULL,
              date TEXT NOT NULL,
              totalBits INTEGER NOT NULL DEFAULT 0,
              eventCount INTEGER NOT NULL DEFAULT 0,
              updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
              PRIMARY KEY (streamerId, date)
            )
          `;

          await prisma.$executeRaw`
            CREATE INDEX IF NOT EXISTS idx_cheer_daily_agg_streamer_date
            ON cheer_daily_agg(streamerId, date)
          `;
        });

        this.cheerDailyAggReady = true;
      })().catch((error) => {
        this.cheerDailyAggInitPromise = null;
        throw error;
      });
    }

    await this.cheerDailyAggInitPromise;
  }

  private async incrementCheerDailyAgg(
    streamerId: string,
    cheeredAtIso: string,
    bits: number
  ): Promise<void> {
    await this.ensureCheerDailyAggTable();

    await prisma.$executeRaw`
      INSERT INTO cheer_daily_agg (streamerId, date, totalBits, eventCount, updatedAt)
      VALUES (${streamerId}, DATE(${cheeredAtIso}), ${bits}, 1, CURRENT_TIMESTAMP)
      ON CONFLICT(streamerId, date) DO UPDATE SET
        totalBits = totalBits + excluded.totalBits,
        eventCount = eventCount + excluded.eventCount,
        updatedAt = CURRENT_TIMESTAMP
    `;
  }

  /**
   * 初始化 EventSub 服務
   * @param app Express 應用實例
   * @param config EventSub 配置
   */
  public async initialize(app: Application, config: EventSubConfig): Promise<void> {
    if (this.isInitialized) {
      logger.warn("TwurpleEventSub", "Service already initialized");
      return;
    }

    try {
      // 1. 驗證配置
      if (!config.secret || config.secret.length < 10) {
        throw new Error("EVENTSUB_SECRET must be at least 10 characters");
      }
      if (!config.hostName) {
        throw new Error("hostName (EVENTSUB_CALLBACK_URL) is required");
      }

      // 2. 獲取 App Auth Provider
      const authProvider = await twurpleAuthService.getAppAuthProvider();
      const { ApiClient } = await new Function('return import("@twurple/api")')();
      this.apiClient = new ApiClient({
        authProvider,
        logger: { minLevel: "error" }, // 隱藏 rate-limit 警告
      });

      // 3. 解析 hostname (移除 protocol 和路徑)
      const url = new URL(config.hostName);
      const hostName = url.hostname;

      logger.info("TwurpleEventSub", `使用 Hostname 初始化中: ${hostName}`);

      // 4. 創建 EventSub Middleware
      const { EventSubMiddleware } = await new Function(
        'return import("@twurple/eventsub-http")'
      )();
      this.middleware = new EventSubMiddleware({
        apiClient: this.apiClient,
        hostName,
        pathPrefix: config.pathPrefix || "/api/eventsub",
        secret: config.secret,
        logger: {
          minLevel: "critical", // Reduce log noise from fake channels (400 Bad Request)
        },
      });

      // 5. 將 middleware 應用到 Express (必須在其他 body-parser 之前)
      await (this.middleware as { apply: (app: Application) => Promise<void> }).apply(app);

      this.isInitialized = true;
      logger.info("TwurpleEventSub", "EventSub Middleware 已應用至 Express");

      // 6. 標記為就緒 (開始接收事件)
      await (this.middleware as { markAsReady: () => Promise<void> }).markAsReady();
      logger.info("TwurpleEventSub", "EventSub 服務已就緒，開始監聽事件");

      // 7. 訂閱所有被監控的頻道
      await this.subscribeToMonitoredChannels();
    } catch (error) {
      logger.error("TwurpleEventSub", "服務初始化失敗", error);
      throw error;
    }
  }

  /**
   * 為所有被監控的頻道訂閱事件
   */
  private async subscribeToMonitoredChannels(): Promise<void> {
    if (!this.middleware) {
      logger.error("TwurpleEventSub", "Middleware 尚未初始化");
      return;
    }

    try {
      // 獲取所有需要監控的頻道
      const channels = await prisma.channel.findMany({
        where: { isMonitored: true },
        select: { twitchChannelId: true, channelName: true },
      });

      logger.info("TwurpleEventSub", `發現 ${channels.length} 個需要監控的頻道`);

      for (const channel of channels) {
        await this.subscribeToChannel(channel.twitchChannelId, channel.channelName);
      }

      logger.info("TwurpleEventSub", "所有監控頻道訂閱完成");
    } catch (error) {
      logger.error("TwurpleEventSub", "頻道訂閱發生錯誤", error);
    }
  }

  /**
   * 訂閱單一頻道的事件
   */
  public async subscribeToChannel(twitchChannelId: string, channelName?: string): Promise<void> {
    if (!this.middleware) {
      logger.error("TwurpleEventSub", "Cannot subscribe: middleware not initialized");
      return;
    }

    // 避免重複訂閱
    if (this.subscribedChannels.has(twitchChannelId)) {
      logger.info("TwurpleEventSub", `Already subscribed to ${channelName || twitchChannelId}`);
      return;
    }

    const displayName = channelName || twitchChannelId;

    try {
      // EventSub 事件類型定義
      interface StreamOnlineEvent {
        broadcasterDisplayName: string;
        broadcasterId: string;
        startDate: Date;
      }
      interface StreamOfflineEvent {
        broadcasterDisplayName: string;
        broadcasterId: string;
      }
      interface ChannelUpdateEvent {
        broadcasterDisplayName: string;
        broadcasterId: string;
        streamTitle: string;
        categoryName: string;
      }
      interface ChannelCheerEvent {
        broadcasterId: string;
        broadcasterDisplayName: string;
        userId?: string;
        userDisplayName?: string;
        bits: number;
        message?: string;
        isAnonymous: boolean;
      }

      type Middleware = {
        onStreamOnline: (
          channelId: string,
          callback: (event: StreamOnlineEvent) => Promise<void>
        ) => Promise<void>;
        onStreamOffline: (
          channelId: string,
          callback: (event: StreamOfflineEvent) => Promise<void>
        ) => Promise<void>;
        onChannelUpdate: (
          channelId: string,
          callback: (event: ChannelUpdateEvent) => Promise<void>
        ) => Promise<void>;
        onChannelCheer: (
          channelId: string,
          callback: (event: ChannelCheerEvent) => Promise<void>
        ) => Promise<void>;
      };

      const middleware = this.middleware as Middleware;

      // 訂閱 stream.online 事件
      await middleware.onStreamOnline(twitchChannelId, async (event: StreamOnlineEvent) => {
        logger.info("TwurpleEventSub", `🟢 STREAM ONLINE: ${event.broadcasterDisplayName}`);
        await this.handleStreamOnline(event.broadcasterId, {
          displayName: event.broadcasterDisplayName,
          startedAt: event.startDate,
        });
      });

      // 訂閱 stream.offline 事件
      await middleware.onStreamOffline(twitchChannelId, async (event: StreamOfflineEvent) => {
        logger.info("TwurpleEventSub", `🔴 STREAM OFFLINE: ${event.broadcasterDisplayName}`);
        await this.handleStreamOffline(event.broadcasterId);
      });

      // 訂閱 channel.update 事件
      await middleware.onChannelUpdate(twitchChannelId, async (event: ChannelUpdateEvent) => {
        logger.info(
          "TwurpleEventSub",
          `📝 CHANNEL UPDATE: ${event.broadcasterDisplayName} - "${event.streamTitle}" [${event.categoryName}]`
        );
        await this.handleChannelUpdate(event.broadcasterId, {
          title: event.streamTitle,
          category: event.categoryName,
        });
      });

      // 訂閱 channel.cheer 事件 (Bits 贊助)
      // 注意：需要 bits:read 權限，僅對有授權的實況主頻道有效
      try {
        await middleware.onChannelCheer(twitchChannelId, async (event: ChannelCheerEvent) => {
          logger.info(
            "TwurpleEventSub",
            `💎 CHEER: ${event.userDisplayName || "Anonymous"} cheered ${
              event.bits
            } bits to ${event.broadcasterDisplayName}`
          );
          await this.handleChannelCheer(event);
        });
      } catch {
        // bits:read 權限可能不足，忽略此錯誤
        logger.debug(
          "TwurpleEventSub",
          `Skipped cheer subscription for ${displayName} (likely no bits:read permission)`
        );
      }

      this.subscribedChannels.add(twitchChannelId);
      // logger.info("TwurpleEventSub", `✅ Subscribed to: ${displayName}`);
    } catch (error) {
      logger.error("TwurpleEventSub", `Failed to subscribe to ${displayName}`, error);
    }
  }

  /**
   * 處理開台事件
   */
  private async handleStreamOnline(
    twitchChannelId: string,
    data: { displayName: string; startedAt: Date }
  ): Promise<void> {
    try {
      // 使用重試機制查詢頻道
      const channel = await retryDatabaseOperation<ChannelResult | null>(() =>
        prisma.channel.findUnique({
          where: { twitchChannelId },
        })
      );

      if (!channel) {
        logger.warn("TwurpleEventSub", `Channel not found: ${twitchChannelId}`);
        return;
      }

      // 使用重試機制檢查是否已有進行中的 session
      const existingSession = await retryDatabaseOperation<StreamSessionResult | null>(() =>
        prisma.streamSession.findFirst({
          where: {
            channelId: channel.id,
            endedAt: null,
          },
        })
      );

      if (existingSession) {
        logger.debug("TwurpleEventSub", `Session already exists for ${data.displayName}`);
        return;
      }

      // 使用重試機制創建新的 StreamSession 並更新頻道狀態（使用 transaction）
      await retryDatabaseOperation(() =>
        prisma.$transaction([
          prisma.streamSession.create({
            data: {
              channelId: channel.id,
              twitchStreamId: `eventsub_${Date.now()}`,
              startedAt: data.startedAt,
              title: "",
              category: "",
            },
          }),
          prisma.channel.update({
            where: { id: channel.id },
            data: { isLive: true, currentStreamStartedAt: data.startedAt },
          }),
        ])
      );

      // 推送 WebSocket 事件
      webSocketGateway.broadcastStreamStatus("stream.online", {
        channelId: channel.id,
        channelName: channel.channelName,
        twitchChannelId,
        displayName: data.displayName,
        startedAt: data.startedAt,
      });

      logger.info("TwurpleEventSub", `Stream online: ${data.displayName} (WebSocket event sent)`);
    } catch (error) {
      logger.warn(
        "TwurpleEventSub",
        `Failed to handle stream.online for ${data.displayName}`,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  /**
   * 處理關台事件
   */
  private async handleStreamOffline(twitchChannelId: string): Promise<void> {
    try {
      // 使用重試機制查詢頻道
      const channel = await retryDatabaseOperation<ChannelResult | null>(() =>
        prisma.channel.findUnique({
          where: { twitchChannelId },
        })
      );

      if (!channel) {
        logger.warn("TwurpleEventSub", `Channel not found: ${twitchChannelId}`);
        return;
      }

      // 使用重試機制找到進行中的 session
      const openSession = await retryDatabaseOperation<StreamSessionResult | null>(() =>
        prisma.streamSession.findFirst({
          where: {
            channelId: channel.id,
            endedAt: null,
          },
          orderBy: { startedAt: "desc" },
        })
      );

      if (!openSession) {
        logger.debug("TwurpleEventSub", `No open session found for ${channel.channelName}`);
        return;
      }

      // 計算時長
      const endedAt = new Date();
      const durationSeconds = Math.floor(
        (endedAt.getTime() - openSession.startedAt.getTime()) / 1000
      );

      // 使用重試機制更新 session 和頻道狀態（使用 transaction）
      await retryDatabaseOperation(() =>
        prisma.$transaction([
          prisma.streamSession.update({
            where: { id: openSession.id },
            data: { endedAt, durationSeconds },
          }),
          prisma.channel.update({
            where: { id: channel.id },
            data: {
              isLive: false,
              currentViewerCount: 0,
              currentStreamStartedAt: null,
            },
          }),
        ])
      );

      // 推送 WebSocket 事件
      webSocketGateway.broadcastStreamStatus("stream.offline", {
        channelId: channel.id,
        channelName: channel.channelName,
        twitchChannelId,
        durationSeconds,
      });

      const durationMinutes = Math.floor(durationSeconds / 60);
      logger.info(
        "TwurpleEventSub",
        `Stream offline: ${channel.channelName}, duration: ${durationMinutes} min (WebSocket event sent)`
      );
    } catch (error) {
      logger.warn(
        "TwurpleEventSub",
        `Failed to handle stream.offline for ${twitchChannelId}`,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  /**
   * 處理頻道更新事件
   */
  private async handleChannelUpdate(
    twitchChannelId: string,
    data: { title: string; category: string }
  ): Promise<void> {
    try {
      // 使用重試機制查詢頻道
      const channel = await retryDatabaseOperation<ChannelResult | null>(() =>
        prisma.channel.findUnique({
          where: { twitchChannelId },
        })
      );

      if (!channel) return;

      // 使用重試機制查詢進行中的 session
      const openSession = await retryDatabaseOperation<StreamSessionResult | null>(() =>
        prisma.streamSession.findFirst({
          where: {
            channelId: channel.id,
            endedAt: null,
          },
          orderBy: { startedAt: "desc" },
        })
      );

      if (openSession) {
        // 使用重試機制更新 session
        await retryDatabaseOperation(() =>
          prisma.streamSession.update({
            where: { id: openSession.id },
            data: {
              title: data.title,
              category: data.category,
            },
          })
        );
        logger.debug("TwurpleEventSub", `Updated session info for ${channel.channelName}`);
      }
    } catch (error) {
      // 降級為 warning，因為 channel.update 事件失敗不影響核心功能
      logger.warn(
        "TwurpleEventSub",
        `Failed to handle channel.update for ${twitchChannelId}`,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  /**
   * 處理 Bits 贊助事件
   * eslint-disable-next-line @typescript-eslint/no-explicit-any
   */
  private async handleChannelCheer(event: {
    broadcasterId: string;
    broadcasterDisplayName: string;
    userId?: string;
    userDisplayName?: string;
    bits: number;
    message?: string;
    isAnonymous: boolean;
  }): Promise<void> {
    try {
      // 找到對應的實況主
      const streamer = await prisma.streamer.findFirst({
        where: { twitchUserId: event.broadcasterId },
      });

      if (!streamer) {
        logger.debug(
          "TwurpleEventSub",
          `Ignoring cheer event: Streamer ${event.broadcasterDisplayName} not found in database`
        );
        return;
      }

      const cheeredAt = new Date();

      // 儲存 CheerEvent
      const createdCheerEvent = await prisma.cheerEvent.create({
        data: {
          streamerId: streamer.id,
          twitchUserId: event.isAnonymous ? null : event.userId,
          userName: event.isAnonymous ? null : event.userDisplayName,
          bits: event.bits,
          message: event.message,
          isAnonymous: event.isAnonymous,
          cheeredAt,
        },
      });

      await prisma.$executeRaw`
        UPDATE cheer_events
        SET cheeredDate = DATE(${cheeredAt.toISOString()})
        WHERE id = ${createdCheerEvent.id}
          AND cheeredDate IS NULL
      `;

      await this.incrementCheerDailyAgg(streamer.id, cheeredAt.toISOString(), event.bits);

      logger.info(
        "TwurpleEventSub",
        `Saved cheer event: ${event.bits} bits from ${
          event.isAnonymous ? "Anonymous" : event.userDisplayName
        } to ${event.broadcasterDisplayName}`
      );
    } catch (error) {
      logger.error("TwurpleEventSub", "Error handling channel.cheer", error);
    }
  }

  /**
   * 取消訂閱頻道
   */
  public async unsubscribeFromChannel(twitchChannelId: string): Promise<void> {
    if (!this.apiClient) {
      logger.error("TwurpleEventSub", "API client not initialized");
      return;
    }

    try {
      const apiClient = this.apiClient as ApiClientWithEventSub;
      const subscriptions = await apiClient.eventSub.getSubscriptions();

      for (const sub of subscriptions.data) {
        const condition = sub.condition as { broadcaster_user_id?: string };
        if (condition.broadcaster_user_id === twitchChannelId) {
          await apiClient.eventSub.deleteSubscription(sub.id);
          logger.info("TwurpleEventSub", `Unsubscribed: ${sub.type} for ${twitchChannelId}`);
        }
      }

      this.subscribedChannels.delete(twitchChannelId);
    } catch (error) {
      logger.error("TwurpleEventSub", `Failed to unsubscribe from ${twitchChannelId}`, error);
    }
  }

  /**
   * 列出所有訂閱
   */
  public async listSubscriptions(): Promise<{ type: string; status: string; id: string }[]> {
    if (!this.apiClient) {
      logger.error("TwurpleEventSub", "API client not initialized");
      return [];
    }

    try {
      const apiClient = this.apiClient as ApiClientWithEventSub;
      const subscriptions = await apiClient.eventSub.getSubscriptions();

      logger.info("EventSub", `Currently active subscriptions: ${subscriptions.data.length}`);

      const result = subscriptions.data.map((sub: EventSubSubscription) => ({
        id: sub.id,
        type: sub.type,
        status: sub.status,
      }));

      logger.info("TwurpleEventSub", `Total subscriptions: ${result.length}`);
      return result;
    } catch (error) {
      logger.error("TwurpleEventSub", "Failed to list subscriptions", error);
      return [];
    }
  }

  /**
   * 清除所有訂閱
   */
  public async clearAllSubscriptions(): Promise<number> {
    if (!this.apiClient) {
      logger.error("TwurpleEventSub", "API client not initialized");
      return 0;
    }

    try {
      const apiClient = this.apiClient as ApiClientWithEventSub;
      const subscriptions = await apiClient.eventSub.getSubscriptions();
      const count = subscriptions.data.length;

      logger.info("TwurpleEventSub", `Clearing ${count} subscriptions...`);

      for (const sub of subscriptions.data) {
        await apiClient.eventSub.deleteSubscription(sub.id);
      }

      this.subscribedChannels.clear();
      logger.info("TwurpleEventSub", "All subscriptions cleared");
      return count;
    } catch (error) {
      logger.error("TwurpleEventSub", "Failed to clear subscriptions", error);
      return 0;
    }
  }

  /**
   * 獲取服務狀態
   */
  public getStatus(): {
    initialized: boolean;
    subscribedChannels: number;
  } {
    return {
      initialized: this.isInitialized,
      subscribedChannels: this.subscribedChannels.size,
    };
  }
}

// 導出單例
export const twurpleEventSubService = new TwurpleEventSubService();
