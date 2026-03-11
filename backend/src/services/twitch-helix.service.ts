/**
 * Twurple Helix API Service
 *
 * 使用 @twurple/api 提供與 Twitch Helix API 的整合：
 * - 獲取用戶資訊
 * - 獲取頻道資訊
 * - 獲取直播狀態
 * - 獲取追蹤者數據
 */

import type { ApiClient } from "@twurple/api";
import { prisma } from "../db/prisma";
import { encryptToken } from "../utils/crypto.utils";
import { twurpleAuthService } from "./twurple-auth.service";
import { logger } from "../utils/logger";
import { importTwurpleApi, importTwurpleAuth } from "../utils/esm-import";

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

export interface TwitchChannelSnapshot {
  broadcasterId: string;
  broadcasterLogin: string;
  broadcasterName: string;
  gameName?: string;
  title?: string;
  isLive: boolean;
}

// Story 3.6: 用戶追蹤的頻道資訊
export interface FollowedChannel {
  broadcasterId: string;
  broadcasterLogin: string;
  broadcasterName: string;
  followedAt: Date;
}

// Token 資訊介面（用於支援自動刷新）
export interface UserTokenInfo {
  accessToken: string;
  refreshToken: string;
  expiresAt?: Date | null;
  tokenId: string; // 用於更新資料庫
}

const MAX_FOLLOWS = 2000;

// ========== 服務實作 ==========

class TwurpleHelixService {
  private apiClient: ApiClient | null = null;
  private readonly userApiClients = new Map<string, { apiClient: ApiClient; lastUsedAt: number }>();
  private readonly USER_API_CLIENT_CACHE_LIMIT = 50;

  private rememberUserApiClient(cacheKey: string, apiClient: ApiClient): ApiClient {
    this.userApiClients.delete(cacheKey);
    this.userApiClients.set(cacheKey, { apiClient, lastUsedAt: Date.now() });

    if (this.userApiClients.size > this.USER_API_CLIENT_CACHE_LIMIT) {
      const oldestKey = this.userApiClients.keys().next().value as string | undefined;
      if (oldestKey) {
        this.userApiClients.delete(oldestKey);
      }
    }

    return apiClient;
  }

  private getRememberedUserApiClient(cacheKey: string): ApiClient | null {
    const cached = this.userApiClients.get(cacheKey);
    if (!cached) {
      return null;
    }

    return this.rememberUserApiClient(cacheKey, cached.apiClient);
  }

  /**
   * 獲取或初始化 API Client
   * 使用 ESM 動態導入包裝器以支援 CommonJS 環境
   */
  private async getApiClient(): Promise<ApiClient> {
    if (!this.apiClient) {
      // 使用 ESM 包裝器導入（繞過 TypeScript 將 import() 編譯為 require() 的行為）
      const { ApiClient } = await importTwurpleApi();
      const authProvider = await twurpleAuthService.getAppAuthProvider();
      this.apiClient = new ApiClient({
        authProvider,
        logger: { minLevel: "error" }, // 隱藏 rate-limit 警告
      });
      logger.info("Twurple Helix", "Twurple Helix API 客戶端初始化完成");
    }
    return this.apiClient;
  }

  // ========== 用戶相關 API ==========

  /**
   * 透過用戶名獲取用戶資訊
   */
  async getUserByLogin(login: string): Promise<TwitchUser | null> {
    try {
      const api = await this.getApiClient();
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
      logger.error("Twurple Helix", `獲取用戶失敗: ${login}`, error);
      return null;
    }
  }

  /**
   * 透過用戶 ID 獲取用戶資訊
   */
  async getUserById(id: string): Promise<TwitchUser | null> {
    try {
      const api = await this.getApiClient();
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
      logger.error("Twurple Helix", `透過 ID 獲取用戶失敗: ${id}`, error);
      return null;
    }
  }

  /**
   * 批量獲取用戶資訊（最多 100 個）
   */
  async getUsersByIds(ids: string[]): Promise<TwitchUser[]> {
    if (ids.length === 0) return [];
    if (ids.length > 100) {
      logger.warn("Twurple Helix", "getUsersByIds: 請求超過 100 個用戶，已截斷");
      ids = ids.slice(0, 100);
    }

    try {
      const api = await this.getApiClient();
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
      logger.error("Twurple Helix", "批量獲取用戶失敗", error);
      return [];
    }
  }

  // ========== 頻道相關 API ==========

  /**
   * 獲取頻道資訊
   */
  async getChannelInfo(broadcasterId: string): Promise<TwitchChannel | null> {
    try {
      const api = await this.getApiClient();
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
      logger.error("Twurple Helix", `獲取頻道資訊失敗: ${broadcasterId}`, error);
      return null;
    }
  }

  // ========== 直播相關 API ==========

  /**
   * 獲取直播狀態
   */
  async getStream(userId: string): Promise<TwitchStream | null> {
    try {
      const api = await this.getApiClient();
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
      logger.error("Twurple Helix", `獲取直播狀態失敗: ${userId}`, error);
      return null;
    }
  }

  /**
   * 批量獲取直播狀態
   */
  async getStreamsByUserIds(userIds: string[]): Promise<TwitchStream[]> {
    if (userIds.length === 0) return [];

    try {
      const api = await this.getApiClient();
      const allStreams: TwitchStream[] = [];

      for (let i = 0; i < userIds.length; i += 100) {
        const chunk = userIds.slice(i, i + 100);
        const streams = await api.streams.getStreamsByUserIds(chunk);

        allStreams.push(
          ...streams.map((stream) => ({
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
          }))
        );
      }

      return allStreams;
    } catch (error) {
      logger.error("Twurple Helix", "批量獲取直播狀態失敗", error);
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
      const api = await this.getApiClient();
      const result = await api.channels.getChannelFollowerCount(broadcasterId);
      return result;
    } catch (error) {
      logger.error("Twurple Helix", `獲取追蹤者數量失敗: ${broadcasterId}`, error);
      return 0;
    }
  }

  // ========== Story 3.6: 用戶追蹤頻道 ==========

  /**
   * 獲取用戶追蹤的頻道列表 (使用分頁)
   * 需要 user:read:follows scope
   * @param userId Twitch User ID
   * @param userAccessToken 用戶的 Access Token (需有 user:read:follows scope) - 已棄用，請使用 tokenInfo
   * @param tokenInfo 完整的 Token 資訊（支援自動刷新）
   */
  private async getFollowedChannelsApiClient(
    userId: string,
    userAccessToken?: string,
    tokenInfo?: UserTokenInfo
  ): Promise<ApiClient> {
    let api: ApiClient;

    if (tokenInfo) {
      const cacheKey = `token:${tokenInfo.tokenId}`;
      const cachedClient = this.getRememberedUserApiClient(cacheKey);
      if (cachedClient) {
        return cachedClient;
      }

      const { ApiClient } = await importTwurpleApi();
      const { RefreshingAuthProvider } = await importTwurpleAuth();
      const clientId = twurpleAuthService.getClientId();
      const clientSecret = twurpleAuthService.getClientSecret();

      const authProvider = new RefreshingAuthProvider({
        clientId,
        clientSecret,
      });

      authProvider.onRefresh(
        async (
          _userId: string,
          newTokenData: import("../types/twitch.types").TwurpleRefreshCallbackData
        ) => {
          logger.info(
            "Twurple Helix",
            `Token 已自動刷新 (User: ${userId}, TokenID: ${tokenInfo.tokenId})`
          );

          try {
            await prisma.twitchToken.update({
              where: { id: tokenInfo.tokenId },
              data: {
                accessToken: encryptToken(newTokenData.accessToken),
                refreshToken: newTokenData.refreshToken
                  ? encryptToken(newTokenData.refreshToken)
                  : undefined,
                expiresAt: newTokenData.expiresIn
                  ? new Date(Date.now() + newTokenData.expiresIn * 1000)
                  : null,
                status: "active",
                failureCount: 0,
                lastValidatedAt: new Date(),
              },
            });
          } catch (dbError) {
            logger.error("Twurple Helix", `Token 刷新後更新資料庫失敗`, dbError);
          }
        }
      );

      await authProvider.addUserForToken(
        {
          accessToken: tokenInfo.accessToken,
          refreshToken: tokenInfo.refreshToken,
          expiresIn: tokenInfo.expiresAt
            ? Math.floor((tokenInfo.expiresAt.getTime() - Date.now()) / 1000)
            : null,
          obtainmentTimestamp: Date.now(),
        },
        ["user:read:follows"]
      );

      return this.rememberUserApiClient(
        cacheKey,
        new ApiClient({
          authProvider,
          logger: { minLevel: "error" },
        })
      );
    }

    if (userAccessToken) {
      const cacheKey = `legacy:${userId}:${userAccessToken.slice(0, 16)}`;
      const cachedClient = this.getRememberedUserApiClient(cacheKey);
      if (cachedClient) {
        return cachedClient;
      }

      const { ApiClient } = await importTwurpleApi();
      const { StaticAuthProvider } = await importTwurpleAuth();
      const clientId = twurpleAuthService.getClientId();
      const authProvider = new StaticAuthProvider(clientId, userAccessToken);
      api = this.rememberUserApiClient(
        cacheKey,
        new ApiClient({
          authProvider,
          logger: { minLevel: "error" },
        })
      );
      logger.debug("Twurple Helix", `使用 StaticAuthProvider（不支援自動刷新）`);
      return api;
    }

    return this.getApiClient();
  }

  async *iterateFollowedChannels(
    userId: string,
    userAccessToken?: string,
    tokenInfo?: UserTokenInfo
  ): AsyncGenerator<FollowedChannel, void, void> {
    try {
      const api = await this.getFollowedChannelsApiClient(userId, userAccessToken, tokenInfo);
      const paginator = api.channels.getFollowedChannelsPaginated(userId);

      let count = 0;
      for await (const follow of paginator) {
        yield {
          broadcasterId: follow.broadcasterId,
          broadcasterLogin: follow.broadcasterName.toLowerCase(),
          broadcasterName: follow.broadcasterDisplayName,
          followedAt: follow.followDate,
        };

        count += 1;
        if (count >= MAX_FOLLOWS) {
          logger.warn("Twurple Helix", `用戶 ${userId} 追蹤數量超過 ${MAX_FOLLOWS}，已截斷`);
          break;
        }
      }

      logger.info("Twurple Helix", `已獲取 ${count} 個追蹤頻道 (User ID: ${userId})`);
    } catch (error) {
      logger.error("Twurple Helix", `獲取用戶追蹤列表失敗: ${userId}`, error);
    }
  }

  async getFollowedChannels(
    userId: string,
    userAccessToken?: string,
    tokenInfo?: UserTokenInfo
  ): Promise<FollowedChannel[]> {
    const results: FollowedChannel[] = [];
    for await (const follow of this.iterateFollowedChannels(userId, userAccessToken, tokenInfo)) {
      results.push(follow);
    }
    return results;
  }

  async getChannelSnapshotsByIds(userIds: string[]): Promise<TwitchChannelSnapshot[]> {
    if (userIds.length === 0) return [];

    const normalizedIds = Array.from(new Set(userIds.filter((id) => id.length > 0)));
    const snapshotsByUserId = new Map<string, TwitchChannelSnapshot>();

    try {
      for (let i = 0; i < normalizedIds.length; i += 100) {
        const chunk = normalizedIds.slice(i, i + 100);
        const [users, streams] = await Promise.all([
          this.getUsersByIds(chunk),
          this.getStreamsByUserIds(chunk),
        ]);

        const streamByUserId = new Map(streams.map((stream) => [stream.userId, stream]));

        for (const user of users) {
          const stream = streamByUserId.get(user.id);
          snapshotsByUserId.set(user.id, {
            broadcasterId: user.id,
            broadcasterLogin: user.login,
            broadcasterName: user.displayName,
            gameName: stream?.gameName,
            title: stream?.title,
            isLive: stream?.type === "live",
          });
        }
      }

      return normalizedIds
        .map((id) => snapshotsByUserId.get(id))
        .filter((snapshot): snapshot is TwitchChannelSnapshot => Boolean(snapshot));
    } catch (error) {
      logger.error("Twurple Helix", "批量獲取頻道快照失敗", error);
      return [];
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
