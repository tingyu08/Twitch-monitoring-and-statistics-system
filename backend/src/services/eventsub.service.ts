/**
 * EventSub Service
 * Twitch EventSub 訂閱管理服務
 *
 * Story 3.3: 定時資料抓取與 EventSub 整合
 */

import { prisma } from "../db/prisma";

// EventSub 事件類型
export const EVENTSUB_TYPES = {
  // 直播狀態
  STREAM_ONLINE: "stream.online",
  STREAM_OFFLINE: "stream.offline",

  // 頻道事件
  CHANNEL_UPDATE: "channel.update",
  CHANNEL_FOLLOW: "channel.follow",
  CHANNEL_SUBSCRIBE: "channel.subscribe",
  CHANNEL_SUBSCRIPTION_END: "channel.subscription.end",
  CHANNEL_SUBSCRIPTION_GIFT: "channel.subscription.gift",
  CHANNEL_SUBSCRIPTION_MESSAGE: "channel.subscription.message",
  CHANNEL_CHEER: "channel.cheer",
  CHANNEL_RAID: "channel.raid",

  // Channel Points
  CHANNEL_POINTS_REWARD_REDEMPTION: "channel.channel_points_custom_reward_redemption.add",
} as const;

export type EventSubType = (typeof EVENTSUB_TYPES)[keyof typeof EVENTSUB_TYPES];

// EventSub 訂閱狀態
export const SUBSCRIPTION_STATUS = {
  ENABLED: "enabled",
  PENDING: "webhook_callback_verification_pending",
  FAILED: "webhook_callback_verification_failed",
  REVOKED: "authorization_revoked",
  USER_REMOVED: "user_removed",
} as const;

// EventSub 通知 Payload 類型
export interface EventSubNotification<T = unknown> {
  subscription: {
    id: string;
    type: string;
    version: string;
    status: string;
    cost: number;
    condition: Record<string, string>;
    transport: {
      method: string;
      callback: string;
    };
    created_at: string;
  };
  event: T;
}

// 開播事件
export interface StreamOnlineEvent {
  id: string;
  broadcaster_user_id: string;
  broadcaster_user_login: string;
  broadcaster_user_name: string;
  type: "live" | "playlist" | "watch_party" | "premiere" | "rerun";
  started_at: string;
}

// 下播事件
export interface StreamOfflineEvent {
  broadcaster_user_id: string;
  broadcaster_user_login: string;
  broadcaster_user_name: string;
}

// 頻道更新事件
export interface ChannelUpdateEvent {
  broadcaster_user_id: string;
  broadcaster_user_login: string;
  broadcaster_user_name: string;
  title: string;
  language: string;
  category_id: string;
  category_name: string;
  content_classification_labels: string[];
}

// 訂閱事件
export interface ChannelSubscribeEvent {
  user_id: string;
  user_login: string;
  user_name: string;
  broadcaster_user_id: string;
  broadcaster_user_login: string;
  broadcaster_user_name: string;
  tier: "1000" | "2000" | "3000";
  is_gift: boolean;
}

// Cheer 事件
export interface ChannelCheerEvent {
  is_anonymous: boolean;
  user_id?: string;
  user_login?: string;
  user_name?: string;
  broadcaster_user_id: string;
  broadcaster_user_login: string;
  broadcaster_user_name: string;
  message: string;
  bits: number;
}

/**
 * EventSub 服務類
 */
export class EventSubService {
  private readonly callbackUrl: string;
  private readonly secret: string;

  constructor() {
    this.callbackUrl = process.env.EVENTSUB_CALLBACK_URL || "";
    this.secret = process.env.EVENTSUB_SECRET || "";

    if (!this.callbackUrl) {
      console.warn("⚠️ EVENTSUB_CALLBACK_URL 未設定，EventSub 功能將無法使用");
    }
  }

  /**
   * 處理開播事件
   */
  async handleStreamOnline(event: StreamOnlineEvent): Promise<void> {
    console.log(`🔴 開播事件: ${event.broadcaster_user_name} (${event.type})`);

    try {
      // 找到對應的 Channel
      const channel = await prisma.channel.findUnique({
        where: { twitchChannelId: event.broadcaster_user_id },
      });

      if (!channel) {
        console.warn(`⚠️ 找不到頻道: ${event.broadcaster_user_id}`);
        return;
      }

      // 建立 StreamSession
      await prisma.streamSession.create({
        data: {
          channelId: channel.id,
          startedAt: new Date(event.started_at),
          title: "", // 會由後續的 channel.update 事件更新
          category: "", // 遊戲/分類名稱
        },
      });

      console.log(`✅ StreamSession 已建立: ${channel.channelName}`);
    } catch (error) {
      console.error("❌ 處理開播事件失敗:", error);
    }
  }

  /**
   * 處理下播事件
   */
  async handleStreamOffline(event: StreamOfflineEvent): Promise<void> {
    console.log(`⚫ 下播事件: ${event.broadcaster_user_name}`);

    try {
      // 找到對應的 Channel
      const channel = await prisma.channel.findUnique({
        where: { twitchChannelId: event.broadcaster_user_id },
      });

      if (!channel) {
        console.warn(`⚠️ 找不到頻道: ${event.broadcaster_user_id}`);
        return;
      }

      // 找到最近的未結束 StreamSession
      const session = await prisma.streamSession.findFirst({
        where: {
          channelId: channel.id,
          endedAt: null,
        },
        orderBy: { startedAt: "desc" },
      });

      if (!session) {
        console.warn(`⚠️ 找不到進行中的 StreamSession: ${channel.channelName}`);
        return;
      }

      // 結束 StreamSession
      const endedAt = new Date();
      const durationSeconds = Math.floor((endedAt.getTime() - session.startedAt.getTime()) / 1000);

      await prisma.streamSession.update({
        where: { id: session.id },
        data: {
          endedAt,
          durationSeconds,
        },
      });

      console.log(
        `✅ StreamSession 已結束: ${channel.channelName} (${Math.floor(durationSeconds / 60)} 分鐘)`
      );
    } catch (error) {
      console.error("❌ 處理下播事件失敗:", error);
    }
  }

  /**
   * 處理頻道更新事件
   */
  async handleChannelUpdate(event: ChannelUpdateEvent): Promise<void> {
    console.log(`📝 頻道更新: ${event.broadcaster_user_name} - ${event.title}`);

    try {
      // 找到對應的 Channel
      const channel = await prisma.channel.findUnique({
        where: { twitchChannelId: event.broadcaster_user_id },
      });

      if (!channel) {
        console.warn(`⚠️ 找不到頻道: ${event.broadcaster_user_id}`);
        return;
      }

      // 更新進行中的 StreamSession
      const session = await prisma.streamSession.findFirst({
        where: {
          channelId: channel.id,
          endedAt: null,
        },
        orderBy: { startedAt: "desc" },
      });

      if (session) {
        await prisma.streamSession.update({
          where: { id: session.id },
          data: {
            title: event.title,
            category: event.category_name, // 使用分類名稱
          },
        });
        console.log(`✅ StreamSession 標題已更新`);
      }
    } catch (error) {
      console.error("❌ 處理頻道更新事件失敗:", error);
    }
  }

  /**
   * 處理訂閱事件
   */
  async handleSubscription(event: ChannelSubscribeEvent): Promise<void> {
    console.log(
      `💎 訂閱事件: ${event.user_name} → ${event.broadcaster_user_name} (Tier ${event.tier})`
    );

    // TODO: 記錄訂閱事件到統計表
  }

  /**
   * 處理 Cheer 事件
   */
  async handleCheer(event: ChannelCheerEvent): Promise<void> {
    const username = event.is_anonymous ? "匿名" : event.user_name;
    console.log(`💰 Cheer 事件: ${username} → ${event.broadcaster_user_name} (${event.bits} bits)`);

    // TODO: 記錄 Cheer 事件到統計表
  }
}

// 匯出單例
export const eventSubService = new EventSubService();
