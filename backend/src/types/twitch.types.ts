/**
 * Twitch 相關類型定義
 * 用於改善類型安全，減少 any 使用
 */

/**
 * Twitch Token 資料結構（來自資料庫）
 */
export interface TwitchTokenData {
  id: string;
  ownerType: string;
  streamerId: string | null;
  viewerId: string | null;
  accessToken: string; // 已加密
  refreshToken: string | null; // 已加密
  expiresAt: Date | null;
  scopes: string;
  status: string;
  lastValidatedAt: Date | null;
  failureCount: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Twitch OAuth Token（未加密）
 */
export interface TwitchOAuthToken {
  accessToken: string;
  refreshToken?: string | null;
  expiresIn?: number | null;
  obtainmentTimestamp: number;
}

/**
 * Twurple RefreshingAuthProvider 刷新回調參數
 */
export interface TwurpleRefreshCallbackData {
  accessToken: string;
  refreshToken?: string | null;
  expiresIn?: number | null;
  scope?: string[];
}

/**
 * Twitch API 錯誤（帶狀態碼）
 */
export interface TwitchApiError extends Error {
  statusCode?: number;
  status?: number;
  body?: unknown;
}

/**
 * Twitch Chat 事件訊息結構
 */
export interface TwitchChatMessage {
  userInfo: {
    userId: string;
    displayName: string;
    userName: string;
  };
  messageInfo: {
    messageId: string;
    text: string;
    isAction: boolean;
  };
  badges?: Map<string, string> | null;
  emotes?: Map<string, string[]> | null;
}

/**
 * Twitch 訂閱資訊
 */
export interface TwitchSubscriptionInfo {
  tier: string;
  isPrime?: boolean;
  isGift?: boolean;
  gifterUserId?: string;
  gifterDisplayName?: string;
  cumulativeMonths?: number;
  durationMonths?: number;
  streakMonths?: number;
  message?: {
    text: string;
    emotes?: unknown;
  };
}

/**
 * Twitch Raid 資訊
 */
export interface TwitchRaidInfo {
  displayName: string;
  viewerCount: number;
}
