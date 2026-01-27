/**
 * Twurple Auth Service
 *
 * 使用 @twurple/auth 統一管理 Twitch OAuth Token：
 * - App Access Token (用於公開 API)
 * - User Access Token (用於用戶相關 API)
 * - Token 失效自動標記
 */

import type { AppTokenAuthProvider, RefreshingAuthProvider, AccessToken } from "@twurple/auth";

// Logger fallback for dynamic import scenarios
const logger = {
  info: (cat: string, msg: string, ...args: unknown[]) =>
    console.log(`[INFO] [${cat}] ${msg}`, ...args),
  error: (cat: string, msg: string, ...args: unknown[]) =>
    console.error(`[ERROR] [${cat}] ${msg}`, ...args),
  warn: (cat: string, msg: string, ...args: unknown[]) =>
    console.warn(`[WARN] [${cat}] ${msg}`, ...args),
  debug: (cat: string, msg: string, ...args: unknown[]) =>
    console.debug(`[DEBUG] [${cat}] ${msg}`, ...args),
};

// ========== 類型定義 ==========

interface TokenData {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number | null;
  obtainmentTimestamp: number;
}

type TokenFailureCallback = (
  userId: string,
  error: Error,
  reason: "refresh_failed" | "invalid_token" | "revoked"
) => Promise<void>;

// ========== 服務實作 ==========

class TwurpleAuthService {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private appAuthProvider: AppTokenAuthProvider | null = null;
  private userAuthProviders: Map<string, RefreshingAuthProvider> = new Map();
  private onTokenFailure: TokenFailureCallback | null = null;

  constructor() {
    this.clientId = process.env.TWITCH_CLIENT_ID || "";
    this.clientSecret = process.env.TWITCH_CLIENT_SECRET || "";
  }

  /**
   * 設定 Token 失敗回調（用於標記 Token 狀態）
   */
  setOnTokenFailure(callback: TokenFailureCallback): void {
    this.onTokenFailure = callback;
  }

  /**
   * 檢查是否有有效的憑證
   */
  hasCredentials(): boolean {
    return !!(this.clientId && this.clientSecret);
  }

  /**
   * 獲取 App Auth Provider (用於公開 API)
   */
  async getAppAuthProvider(): Promise<AppTokenAuthProvider> {
    if (!this.appAuthProvider) {
      if (!this.hasCredentials()) {
        throw new Error("Missing TWITCH_CLIENT_ID or TWITCH_CLIENT_SECRET");
      }
      const { AppTokenAuthProvider } = await new Function('return import("@twurple/auth")')();
      this.appAuthProvider = new AppTokenAuthProvider(this.clientId, this.clientSecret);
      logger.info("Twurple Auth", "App Auth Provider initialized");
    }
    return this.appAuthProvider;
  }

  /**
   * 為特定用戶建立 Refreshing Auth Provider
   * @param userId Twitch 用戶 ID
   * @param tokenData 用戶的 Token 資料
   * @param onRefresh 當 Token 刷新時的回調（用於保存新 Token）
   */
  async createUserAuthProvider(
    userId: string,
    tokenData: TokenData,
    onRefresh?: (userId: string, newTokenData: TokenData) => Promise<void>
  ): Promise<RefreshingAuthProvider> {
    const { RefreshingAuthProvider } = await new Function('return import("@twurple/auth")')();

    const authProvider = new RefreshingAuthProvider({
      clientId: this.clientId,
      clientSecret: this.clientSecret,
    });

    // 設定初始 Token
    authProvider.addUser(
      userId,
      {
        accessToken: tokenData.accessToken,
        refreshToken: tokenData.refreshToken,
        expiresIn: tokenData.expiresIn,
        obtainmentTimestamp: tokenData.obtainmentTimestamp,
      },
      ["chat"]
    );

    // 設定 Token 刷新成功回調
    if (onRefresh) {
      // 閮身 Token 憿舐內 (敺賊鞈摨)
      authProvider.onRefresh(async (userId: string, newTokenData: AccessToken) => {
        logger.info("Twurple Auth", `Token refreshed for user: ${userId}`);
        await onRefresh(userId, {
          accessToken: newTokenData.accessToken,
          refreshToken: newTokenData.refreshToken,
          expiresIn: newTokenData.expiresIn ?? null,
          obtainmentTimestamp: newTokenData.obtainmentTimestamp,
        });
      });
    }

    // 閮身 Token 憿舐內 (敺賊鞈摨)
    authProvider.onRefreshFailure(async (userId: string, error: Error) => {
      logger.error("Twurple Auth", `Token refresh failed for user: ${userId}`, error);

      // 判斷失敗原因
      const errorMessage = error.message.toLowerCase();
      let reason: "refresh_failed" | "invalid_token" | "revoked" = "refresh_failed";

      if (errorMessage.includes("invalid") || errorMessage.includes("unauthorized")) {
        reason = "invalid_token";
      } else if (errorMessage.includes("revoked") || errorMessage.includes("access denied")) {
        reason = "revoked";
      }

      // 觸發失敗回調
      if (this.onTokenFailure) {
        try {
          await this.onTokenFailure(userId, error, reason);
        } catch (callbackError) {
          logger.error("Twurple Auth", "Failed to execute token failure callback", callbackError);
        }
      }

      // 移除失效的 Provider
      this.userAuthProviders.delete(userId);
    });

    this.userAuthProviders.set(userId, authProvider);
    return authProvider;
  }

  /**
   * 獲取已存在的用戶 Auth Provider
   */
  getUserAuthProvider(userId: string): RefreshingAuthProvider | null {
    return this.userAuthProviders.get(userId) || null;
  }

  /**
   * 移除用戶的 Auth Provider
   */
  removeUserAuthProvider(userId: string): void {
    this.userAuthProviders.delete(userId);
  }

  /**
   * 獲取 Client ID
   */
  getClientId(): string {
    return this.clientId;
  }

  /**
   * 獲取 Client Secret
   */
  getClientSecret(): string {
    return this.clientSecret;
  }

  /**
   * 獲取服務狀態
   */
  getStatus() {
    return {
      hasCredentials: this.hasCredentials(),
      appProviderInitialized: !!this.appAuthProvider,
      userProviderCount: this.userAuthProviders.size,
    };
  }

  /**
   * 檢查用戶是否有活躍的 Auth Provider
   */
  hasActiveProvider(userId: string): boolean {
    return this.userAuthProviders.has(userId);
  }

  /**
   * 獲取所有活躍的用戶 ID
   */
  getActiveUserIds(): string[] {
    return Array.from(this.userAuthProviders.keys());
  }
}

// 單例模式
export const twurpleAuthService = new TwurpleAuthService();
