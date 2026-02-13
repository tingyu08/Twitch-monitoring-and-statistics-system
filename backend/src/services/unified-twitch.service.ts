/**
 * Unified Twitch Service
 *
 * 統一封裝所有 Twitch 相關服務（使用 Twurple）：
 * - @twurple/chat (聊天監聽)
 * - @twurple/api (Helix API)
 * - DecAPI (快速查詢)
 *
 * 提供高階 API 給業務層使用
 */

import { twurpleChatService } from "./twitch-chat.service";
import { twurpleHelixService } from "./twitch-helix.service";
import type { TwitchChannelSnapshot } from "./twitch-helix.service";
import { decApiService } from "./decapi.service";
import { twurpleAuthService } from "./twurple-auth.service";
import { autoJoinLiveChannelsJob } from "../jobs/auto-join-live-channels.job";
import { watchTimeIncrementJob } from "../jobs/watch-time-increment.job";
import { logger } from "../utils/logger";

// ========== 類型定義 ==========

export interface ChannelInfo {
  id: string;
  login: string;
  displayName: string;
  avatarUrl: string;
  isLive: boolean;
  currentGame?: string;
  streamTitle?: string;
  viewerCount?: number;
  followerCount: number;
}

export interface UserFollowInfo {
  isFollowing: boolean;
  followedAt?: string;
  followDuration?: string;
}

export interface ViewerChannelRelation {
  channel: ChannelInfo;
  followInfo: UserFollowInfo;
  viewerAccountAge?: string;
}

// ========== 服務實作 ==========

export class UnifiedTwitchService {
  private channelInfoByIdCache = new Map<string, { value: ChannelInfo | null; expiresAt: number }>();
  private channelInfoByIdPending = new Map<string, Promise<ChannelInfo | null>>();
  private readonly channelInfoByIdTtlMs = Number(process.env.CHANNEL_INFO_BY_ID_TTL_MS || 30000);

  // ========== 初始化 ==========

  /**
   * 初始化所有 Twitch 服務
   */
  async initialize(): Promise<void> {
    logger.info("Twitch Service", "初始化統一 Twitch 服務 (Twurple)...");

    // 初始化聊天服務
    await twurpleChatService.initialize();

    // 測試 Helix API
    const helixHealthy = await twurpleHelixService.healthCheck();
    if (helixHealthy) {
      logger.info("Twitch Service", "Helix API 連線正常 (Twurple)");
    } else {
      logger.warn("Twitch Service", "Helix API 連線失敗 - 部分功能可能無法使用");
    }

    // 啟動排程任務
    autoJoinLiveChannelsJob.start();
    watchTimeIncrementJob.start();

    logger.info("Twitch Service", "服務初始化完成 (Twurple)");
  }

  // ========== 頻道資訊 ==========

  /**
   * 獲取頻道完整資訊（整合多個 API）
   */
  async getChannelInfo(channelLogin: string): Promise<ChannelInfo | null> {
    try {
      // 使用 Twurple Helix API 獲取準確資訊
      const user = await twurpleHelixService.getUserByLogin(channelLogin);
      if (!user) {
        logger.warn("Twitch Service", `Helix 找不到用戶: ${channelLogin}`);
        return null;
      }

      // 並行獲取直播狀態和追蹤者數量
      const [stream, followerCount] = await Promise.all([
        twurpleHelixService.getStream(user.id),
        twurpleHelixService.getFollowerCount(user.id).catch(() => 0),
      ]);

      return {
        id: user.id,
        login: user.login,
        displayName: user.displayName,
        avatarUrl: user.profileImageUrl,
        isLive: stream?.type === "live",
        currentGame: stream?.gameName,
        streamTitle: stream?.title,
        viewerCount: stream?.viewerCount,
        followerCount,
      };
    } catch (error) {
      logger.error("Twitch Service", `獲取頻道資訊失敗: ${channelLogin}`, error);
      return null;
    }
  }

  /**
   * 透過 Twitch ID 獲取頻道完整資訊（推薦使用，ID 永不改變）
   */
  async getChannelInfoById(twitchId: string): Promise<ChannelInfo | null> {
    const now = Date.now();
    const cached = this.channelInfoByIdCache.get(twitchId);
    if (cached && cached.expiresAt > now) {
      return cached.value;
    }

    const pending = this.channelInfoByIdPending.get(twitchId);
    if (pending) {
      return pending;
    }

    const loadPromise = (async (): Promise<ChannelInfo | null> => {
      try {
        const user = await twurpleHelixService.getUserById(twitchId);
        if (!user) {
          // 降為 debug：帳號可能被封禁/刪除，這是正常情況
          logger.debug("Twitch Service", `Helix 找不到用戶 ID: ${twitchId}（可能已封禁或刪除）`);
          this.channelInfoByIdCache.set(twitchId, {
            value: null,
            expiresAt: now + Math.min(this.channelInfoByIdTtlMs, 10000),
          });
          return null;
        }

        // 並行獲取直播狀態和追蹤者數量
        const [stream, followerCount] = await Promise.all([
          twurpleHelixService.getStream(user.id),
          twurpleHelixService.getFollowerCount(user.id).catch(() => 0),
        ]);

        const payload: ChannelInfo = {
          id: user.id,
          login: user.login,
          displayName: user.displayName,
          avatarUrl: user.profileImageUrl,
          isLive: stream?.type === "live",
          currentGame: stream?.gameName,
          streamTitle: stream?.title,
          viewerCount: stream?.viewerCount,
          followerCount,
        };

        this.channelInfoByIdCache.set(twitchId, {
          value: payload,
          expiresAt: now + this.channelInfoByIdTtlMs,
        });

        return payload;
      } catch (error) {
        logger.error("Twitch Service", `透過 ID 獲取頻道資訊失敗: ${twitchId}`, error);
        return null;
      } finally {
        this.channelInfoByIdPending.delete(twitchId);
      }
    })();

    this.channelInfoByIdPending.set(twitchId, loadPromise);
    return loadPromise;
  }

  async getChannelInfoByIds(twitchIds: string[]): Promise<Map<string, ChannelInfo>> {
    if (twitchIds.length === 0) {
      return new Map();
    }

    const now = Date.now();
    const result = new Map<string, ChannelInfo>();
    const pendingPairs: Array<{ twitchId: string; promise: Promise<ChannelInfo | null> }> = [];
    const missing = new Set<string>();

    for (const twitchId of new Set(twitchIds)) {
      const cached = this.channelInfoByIdCache.get(twitchId);
      if (cached && cached.expiresAt > now && cached.value) {
        result.set(twitchId, cached.value);
        continue;
      }

      const pending = this.channelInfoByIdPending.get(twitchId);
      if (pending) {
        pendingPairs.push({ twitchId, promise: pending });
        continue;
      }

      missing.add(twitchId);
    }

    if (pendingPairs.length > 0) {
      const pendingResults = await Promise.all(pendingPairs.map((pair) => pair.promise));
      pendingResults.forEach((value, index) => {
        if (value) {
          result.set(pendingPairs[index].twitchId, value);
        }
      });
    }

    if (missing.size === 0) {
      return result;
    }

    const missingIds = Array.from(missing);
    const snapshots = await twurpleHelixService.getChannelSnapshotsByIds(missingIds);
    const snapshotById = new Map<string, TwitchChannelSnapshot>(
      snapshots.map((snapshot) => [snapshot.broadcasterId, snapshot])
    );

    for (const twitchId of missingIds) {
      const snapshot = snapshotById.get(twitchId);

      if (!snapshot) {
        this.channelInfoByIdCache.set(twitchId, {
          value: null,
          expiresAt: now + Math.min(this.channelInfoByIdTtlMs, 10000),
        });
        continue;
      }

      const payload: ChannelInfo = {
        id: snapshot.broadcasterId,
        login: snapshot.broadcasterLogin,
        displayName: snapshot.broadcasterName,
        avatarUrl: "",
        isLive: snapshot.isLive,
        currentGame: snapshot.gameName,
        streamTitle: snapshot.title,
        followerCount: 0,
      };

      this.channelInfoByIdCache.set(twitchId, {
        value: payload,
        expiresAt: now + this.channelInfoByIdTtlMs,
      });

      result.set(twitchId, payload);
    }

    return result;
  }

  /**
   * 批量獲取頻道資訊
   */
  async getChannelsInfo(channelLogins: string[]): Promise<ChannelInfo[]> {
    const results: ChannelInfo[] = [];

    // 分批處理，每批最多 20 個
    const batchSize = 20;
    for (let i = 0; i < channelLogins.length; i += batchSize) {
      const batch = channelLogins.slice(i, i + batchSize);
      const batchResults = await Promise.all(batch.map((login) => this.getChannelInfo(login)));
      results.push(...batchResults.filter((r): r is ChannelInfo => r !== null));
    }

    return results;
  }

  // ========== 追蹤資訊 ==========

  /**
   * 獲取用戶對頻道的追蹤資訊
   */
  async getUserFollowInfo(channelLogin: string, userLogin: string): Promise<UserFollowInfo> {
    try {
      const followage = await decApiService.getFollowage(channelLogin, userLogin);
      return {
        isFollowing: followage.isFollowing,
        followedAt: followage.followedAt,
        followDuration: followage.duration,
      };
    } catch (error) {
      logger.error("Twitch Service", `獲取追蹤資訊失敗: ${userLogin} -> ${channelLogin}`, error);
      return { isFollowing: false };
    }
  }

  /**
   * 獲取觀眾與頻道的完整關係資訊
   */
  async getViewerChannelRelation(
    channelLogin: string,
    viewerLogin: string
  ): Promise<ViewerChannelRelation | null> {
    try {
      const [channel, followInfo, accountAge] = await Promise.all([
        this.getChannelInfo(channelLogin),
        this.getUserFollowInfo(channelLogin, viewerLogin),
        decApiService.getAccountAge(viewerLogin),
      ]);

      if (!channel) return null;

      return {
        channel,
        followInfo,
        viewerAccountAge: accountAge?.age,
      };
    } catch (error) {
      logger.error("Twitch Service", `獲取觀眾頻道關係失敗`, error);
      return null;
    }
  }

  // ========== 聊天監聽管理 ==========

  /**
   * 開始監聽頻道聊天
   */
  async startListeningToChannel(channelLogin: string): Promise<boolean> {
    try {
      await twurpleChatService.joinChannel(channelLogin);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 停止監聽頻道聊天
   */
  async stopListeningToChannel(channelLogin: string): Promise<boolean> {
    try {
      await twurpleChatService.leaveChannel(channelLogin);
      return true;
    } catch {
      return false;
    }
  }

  // ========== 直播狀態 ==========

  /**
   * 檢查多個頻道的直播狀態
   */
  async checkLiveStatus(channelIds: string[]): Promise<Map<string, boolean>> {
    const result = new Map<string, boolean>();

    try {
      const streams = await twurpleHelixService.getStreamsByUserIds(channelIds);
      const liveIds = new Set(streams.map((s) => s.userId));

      channelIds.forEach((id) => {
        result.set(id, liveIds.has(id));
      });
    } catch (error) {
      logger.error("Twitch Service", "檢查直播狀態失敗", error);
      // 全部標記為未知（false）
      channelIds.forEach((id) => result.set(id, false));
    }

    return result;
  }

  /**
   * 批量獲取直播狀態詳細資訊
   */
  async getStreamsByUserIds(userIds: string[]) {
    return twurpleHelixService.getStreamsByUserIds(userIds);
  }

  // ========== 服務狀態 ==========

  /**
   * 獲取所有服務的狀態
   */
  getServicesStatus() {
    return {
      chat: twurpleChatService.getStatus(),
      helix: twurpleHelixService.getStatus(),
      auth: twurpleAuthService.getStatus(),
      decapi: decApiService.getCacheStats(),
    };
  }
}

// 單例模式
export const unifiedTwitchService = new UnifiedTwitchService();
