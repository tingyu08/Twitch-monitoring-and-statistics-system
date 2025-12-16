/**
 * Twurple Helix API Service
 *
 * 使用 @twurple/api 提供與 Twitch Helix API 的整合：
 * - 獲取用戶資訊
 * - 獲取頻道資訊
 * - 獲取直播狀態
 * - 獲取追蹤者數據
 */

import { ApiClient } from "@twurple/api";
import { twurpleAuthService } from "./twurple-auth.service";
import { logger } from "../utils/logger";

// ========== 類型定義 ==========

export interface TwitchUser {
  id: string;
  login: string;
  displayName: string;
  type: string;
  broadcasterType: string;
  description: string;
  profileImageUrl: string;
  offlineImageUrl: string;
  createdAt: Date;
}

export interface TwitchStream {
  id: string;
  userId: string;
  userLogin: string;
  userName: string;
  gameId: string;
  gameName: string;
  type: string;
  title: string;
  viewerCount: number;
  startedAt: Date;
  language: string;
  thumbnailUrl: string;
  isMature: boolean;
}

export interface TwitchChannel {
  broadcasterId: string;
  broadcasterLogin: string;
  broadcasterName: string;
  broadcasterLanguage: string;
  gameId: string;
  gameName: string;
  title: string;
}

// ========== 服務實作 ==========

class TwurpleHelixService {
  private apiClient: ApiClient | null = null;

  /**
   * 獲取或初始化 API Client
   */
  private getApiClient(): ApiClient {
    if (!this.apiClient) {
      const authProvider = twurpleAuthService.getAppAuthProvider();
      this.apiClient = new ApiClient({ authProvider });
      logger.info("Twurple Helix", "API Client initialized");
    }
    return this.apiClient;
  }

  // ========== 用戶相關 API ==========

  /**
   * 透過用戶名獲取用戶資訊
   */
  async getUserByLogin(login: string): Promise<TwitchUser | null> {
    try {
      const api = this.getApiClient();
      const user = await api.users.getUserByName(login);
      if (!user) return null;

      return {
        id: user.id,
        login: user.name,
        displayName: user.displayName,
        type: user.type,
        broadcasterType: user.broadcasterType,
        description: user.description,
        profileImageUrl: user.profilePictureUrl,
        offlineImageUrl: user.offlinePlaceholderUrl,
        createdAt: user.creationDate,
      };
    } catch (error) {
      logger.error("Twurple Helix", `Failed to get user: ${login}`, error);
      return null;
    }
  }

  /**
   * 透過用戶 ID 獲取用戶資訊
   */
  async getUserById(id: string): Promise<TwitchUser | null> {
    try {
      const api = this.getApiClient();
      const user = await api.users.getUserById(id);
      if (!user) return null;

      return {
        id: user.id,
        login: user.name,
        displayName: user.displayName,
        type: user.type,
        broadcasterType: user.broadcasterType,
        description: user.description,
        profileImageUrl: user.profilePictureUrl,
        offlineImageUrl: user.offlinePlaceholderUrl,
        createdAt: user.creationDate,
      };
    } catch (error) {
      logger.error("Twurple Helix", `Failed to get user by ID: ${id}`, error);
      return null;
    }
  }

  /**
   * 批量獲取用戶資訊（最多 100 個）
   */
  async getUsersByIds(ids: string[]): Promise<TwitchUser[]> {
    if (ids.length === 0) return [];
    if (ids.length > 100) {
      logger.warn("Twurple Helix", "getUsersByIds: Truncating to 100 users");
      ids = ids.slice(0, 100);
    }

    try {
      const api = this.getApiClient();
      const users = await api.users.getUsersByIds(ids);

      return users.map((user) => ({
        id: user.id,
        login: user.name,
        displayName: user.displayName,
        type: user.type,
        broadcasterType: user.broadcasterType,
        description: user.description,
        profileImageUrl: user.profilePictureUrl,
        offlineImageUrl: user.offlinePlaceholderUrl,
        createdAt: user.creationDate,
      }));
    } catch (error) {
      logger.error("Twurple Helix", "Failed to get users by IDs", error);
      return [];
    }
  }

  // ========== 頻道相關 API ==========

  /**
   * 獲取頻道資訊
   */
  async getChannelInfo(broadcasterId: string): Promise<TwitchChannel | null> {
    try {
      const api = this.getApiClient();
      const channel = await api.channels.getChannelInfoById(broadcasterId);
      if (!channel) return null;

      return {
        broadcasterId: channel.id,
        broadcasterLogin: channel.name,
        broadcasterName: channel.displayName,
        broadcasterLanguage: channel.language,
        gameId: channel.gameId,
        gameName: channel.gameName,
        title: channel.title,
      };
    } catch (error) {
      logger.error(
        "Twurple Helix",
        `Failed to get channel: ${broadcasterId}`,
        error
      );
      return null;
    }
  }

  // ========== 直播相關 API ==========

  /**
   * 獲取直播狀態
   */
  async getStream(userId: string): Promise<TwitchStream | null> {
    try {
      const api = this.getApiClient();
      const stream = await api.streams.getStreamByUserId(userId);
      if (!stream) return null;

      return {
        id: stream.id,
        userId: stream.userId,
        userLogin: stream.userName,
        userName: stream.userDisplayName,
        gameId: stream.gameId,
        gameName: stream.gameName,
        type: stream.type,
        title: stream.title,
        viewerCount: stream.viewers,
        startedAt: stream.startDate,
        language: stream.language,
        thumbnailUrl: stream.thumbnailUrl,
        isMature: stream.isMature,
      };
    } catch (error) {
      logger.error("Twurple Helix", `Failed to get stream: ${userId}`, error);
      return null;
    }
  }

  /**
   * 批量獲取直播狀態
   */
  async getStreamsByUserIds(userIds: string[]): Promise<TwitchStream[]> {
    if (userIds.length === 0) return [];
    if (userIds.length > 100) {
      userIds = userIds.slice(0, 100);
    }

    try {
      const api = this.getApiClient();
      const streams = await api.streams.getStreamsByUserIds(userIds);

      return streams.map((stream) => ({
        id: stream.id,
        userId: stream.userId,
        userLogin: stream.userName,
        userName: stream.userDisplayName,
        gameId: stream.gameId,
        gameName: stream.gameName,
        type: stream.type,
        title: stream.title,
        viewerCount: stream.viewers,
        startedAt: stream.startDate,
        language: stream.language,
        thumbnailUrl: stream.thumbnailUrl,
        isMature: stream.isMature,
      }));
    } catch (error) {
      logger.error("Twurple Helix", "Failed to get streams by user IDs", error);
      return [];
    }
  }

  /**
   * 檢查頻道是否在線
   */
  async isChannelLive(userId: string): Promise<boolean> {
    const stream = await this.getStream(userId);
    return stream !== null && stream.type === "live";
  }

  // ========== 追蹤者相關 API ==========

  /**
   * 獲取頻道追蹤者數量
   * 注意：使用 App Access Token 只能獲取公開的追蹤者數據
   */
  async getFollowerCount(broadcasterId: string): Promise<number> {
    try {
      const api = this.getApiClient();
      const result = await api.channels.getChannelFollowerCount(broadcasterId);
      return result;
    } catch (error) {
      logger.error(
        "Twurple Helix",
        `Failed to get follower count: ${broadcasterId}`,
        error
      );
      return 0;
    }
  }

  // ========== 健康檢查 ==========

  /**
   * 測試 API 連接
   */
  async healthCheck(): Promise<boolean> {
    try {
      // 嘗試獲取 Twitch 官方帳號來驗證連接
      const user = await this.getUserByLogin("twitch");
      return user !== null;
    } catch {
      return false;
    }
  }

  /**
   * 獲取服務狀態
   */
  getStatus() {
    return {
      initialized: !!this.apiClient,
      authStatus: twurpleAuthService.getStatus(),
    };
  }
}

// 單例模式
export const twurpleHelixService = new TwurpleHelixService();
