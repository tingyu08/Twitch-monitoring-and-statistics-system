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

import { EventSubMiddleware } from "@twurple/eventsub-http";
import { ApiClient } from "@twurple/api";
import type { Application } from "express";
import { twurpleAuthService } from "./twurple-auth.service";
import { prisma } from "../db/prisma";
import { logger } from "../utils/logger";

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

class TwurpleEventSubService {
  private middleware: EventSubMiddleware | null = null;
  private apiClient: ApiClient | null = null;
  private isInitialized = false;
  private subscribedChannels: Set<string> = new Set();

  /**
   * 初始化 EventSub 服務
   * @param app Express 應用實例
   * @param config EventSub 配置
   */
  public async initialize(
    app: Application,
    config: EventSubConfig
  ): Promise<void> {
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
      const authProvider = twurpleAuthService.getAppAuthProvider();
      this.apiClient = new ApiClient({
        authProvider,
        logger: { minLevel: "error" }, // 隱藏 rate-limit 警告
      });

      // 3. 解析 hostname (移除 protocol 和路徑)
      const url = new URL(config.hostName);
      const hostName = url.hostname;

      logger.info("TwurpleEventSub", `使用 Hostname 初始化中: ${hostName}`);

      // 4. 創建 EventSub Middleware
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await this.middleware.apply(app as any);

      this.isInitialized = true;
      logger.info("TwurpleEventSub", "EventSub Middleware 已應用至 Express");

      // 6. 標記為就緒 (開始接收事件)
      await this.middleware.markAsReady();
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

      logger.info(
        "TwurpleEventSub",
        `發現 ${channels.length} 個需要監控的頻道`
      );

      for (const channel of channels) {
        await this.subscribeToChannel(
          channel.twitchChannelId,
          channel.channelName
        );
      }

      logger.info("TwurpleEventSub", "所有監控頻道訂閱完成");
    } catch (error) {
      logger.error("TwurpleEventSub", "頻道訂閱發生錯誤", error);
    }
  }

  /**
   * 訂閱單一頻道的事件
   */
  public async subscribeToChannel(
    twitchChannelId: string,
    channelName?: string
  ): Promise<void> {
    if (!this.middleware) {
      logger.error(
        "TwurpleEventSub",
        "Cannot subscribe: middleware not initialized"
      );
      return;
    }

    // 避免重複訂閱
    if (this.subscribedChannels.has(twitchChannelId)) {
      logger.info(
        "TwurpleEventSub",
        `Already subscribed to ${channelName || twitchChannelId}`
      );
      return;
    }

    const displayName = channelName || twitchChannelId;

    try {
      // 訂閱 stream.online 事件
      await this.middleware.onStreamOnline(twitchChannelId, async (event) => {
        logger.info(
          "TwurpleEventSub",
          `🟢 STREAM ONLINE: ${event.broadcasterDisplayName}`
        );
        await this.handleStreamOnline(event.broadcasterId, {
          displayName: event.broadcasterDisplayName,
          startedAt: event.startDate,
        });
      });

      // 訂閱 stream.offline 事件
      await this.middleware.onStreamOffline(twitchChannelId, async (event) => {
        logger.info(
          "TwurpleEventSub",
          `🔴 STREAM OFFLINE: ${event.broadcasterDisplayName}`
        );
        await this.handleStreamOffline(event.broadcasterId);
      });

      // 訂閱 channel.update 事件
      await this.middleware.onChannelUpdate(twitchChannelId, async (event) => {
        logger.info(
          "TwurpleEventSub",
          `📝 CHANNEL UPDATE: ${event.broadcasterDisplayName} - "${event.streamTitle}" [${event.categoryName}]`
        );
        await this.handleChannelUpdate(event.broadcasterId, {
          title: event.streamTitle,
          category: event.categoryName,
        });
      });

      this.subscribedChannels.add(twitchChannelId);
      // logger.info("TwurpleEventSub", `✅ Subscribed to: ${displayName}`);
    } catch (error) {
      logger.error(
        "TwurpleEventSub",
        `Failed to subscribe to ${displayName}`,
        error
      );
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
      const channel = await prisma.channel.findUnique({
        where: { twitchChannelId },
      });

      if (!channel) {
        logger.warn("TwurpleEventSub", `Channel not found: ${twitchChannelId}`);
        return;
      }

      // 檢查是否已有進行中的 session (避免重複)
      const existingSession = await prisma.streamSession.findFirst({
        where: {
          channelId: channel.id,
          endedAt: null,
        },
      });

      if (existingSession) {
        logger.info(
          "TwurpleEventSub",
          `Session already exists for ${data.displayName}`
        );
        return;
      }

      // 創建新的 StreamSession
      await prisma.streamSession.create({
        data: {
          channelId: channel.id,
          twitchStreamId: `eventsub_${Date.now()}`,
          startedAt: data.startedAt,
          title: "",
          category: "",
        },
      });

      logger.info(
        "TwurpleEventSub",
        `Created stream session for ${data.displayName}`
      );
    } catch (error) {
      logger.error("TwurpleEventSub", "Error handling stream.online", error);
    }
  }

  /**
   * 處理關台事件
   */
  private async handleStreamOffline(twitchChannelId: string): Promise<void> {
    try {
      const channel = await prisma.channel.findUnique({
        where: { twitchChannelId },
      });

      if (!channel) {
        logger.warn("TwurpleEventSub", `Channel not found: ${twitchChannelId}`);
        return;
      }

      // 找到進行中的 session
      const openSession = await prisma.streamSession.findFirst({
        where: {
          channelId: channel.id,
          endedAt: null,
        },
        orderBy: { startedAt: "desc" },
      });

      if (!openSession) {
        logger.warn(
          "TwurpleEventSub",
          `No open session found for ${channel.channelName}`
        );
        return;
      }

      // 結束 session
      const endedAt = new Date();
      const durationSeconds = Math.floor(
        (endedAt.getTime() - openSession.startedAt.getTime()) / 1000
      );

      await prisma.streamSession.update({
        where: { id: openSession.id },
        data: { endedAt, durationSeconds },
      });

      const durationMinutes = Math.floor(durationSeconds / 60);
      logger.info(
        "TwurpleEventSub",
        `Closed session for ${channel.channelName}, duration: ${durationMinutes} minutes`
      );
    } catch (error) {
      logger.error("TwurpleEventSub", "Error handling stream.offline", error);
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
      const channel = await prisma.channel.findUnique({
        where: { twitchChannelId },
      });

      if (!channel) return;

      // 更新進行中的 session
      const openSession = await prisma.streamSession.findFirst({
        where: {
          channelId: channel.id,
          endedAt: null,
        },
        orderBy: { startedAt: "desc" },
      });

      if (openSession) {
        await prisma.streamSession.update({
          where: { id: openSession.id },
          data: {
            title: data.title,
            category: data.category,
          },
        });
        logger.info(
          "TwurpleEventSub",
          `Updated session info for ${channel.channelName}`
        );
      }
    } catch (error) {
      logger.error("TwurpleEventSub", "Error handling channel.update", error);
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
      const subscriptions = await this.apiClient.eventSub.getSubscriptions();

      for (const sub of subscriptions.data) {
        const condition = sub.condition as { broadcaster_user_id?: string };
        if (condition.broadcaster_user_id === twitchChannelId) {
          await this.apiClient.eventSub.deleteSubscription(sub.id);
          logger.info(
            "TwurpleEventSub",
            `Unsubscribed: ${sub.type} for ${twitchChannelId}`
          );
        }
      }

      this.subscribedChannels.delete(twitchChannelId);
    } catch (error) {
      logger.error(
        "TwurpleEventSub",
        `Failed to unsubscribe from ${twitchChannelId}`,
        error
      );
    }
  }

  /**
   * 列出所有訂閱
   */
  public async listSubscriptions(): Promise<
    { type: string; status: string; id: string }[]
  > {
    if (!this.apiClient) {
      logger.error("TwurpleEventSub", "API client not initialized");
      return [];
    }

    try {
      const subscriptions = await this.apiClient.eventSub.getSubscriptions();

      const result = subscriptions.data.map((sub) => ({
        type: sub.type,
        status: sub.status,
        id: sub.id,
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
      const subscriptions = await this.apiClient.eventSub.getSubscriptions();
      const count = subscriptions.data.length;

      logger.info("TwurpleEventSub", `Clearing ${count} subscriptions...`);

      for (const sub of subscriptions.data) {
        await this.apiClient.eventSub.deleteSubscription(sub.id);
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
