/**
 * Twurple Chat 相關型別定義
 *
 * 用於替代 any 類型，提供更好的型別安全性
 */

/**
 * Twitch 徽章資訊 (Map-like structure)
 */
export interface TwitchBadgeInfo {
  forEach(callback: (version: string, badge: string) => void): void;
}

/**
 * Twitch 表情符號資訊 (Map-like structure)
 */
export interface TwitchEmoteOffsets {
  size: number;
  forEach(callback: (offsets: unknown, emoteId: string) => void): void;
}

/**
 * Twitch 使用者資訊
 */
export interface TwitchUserInfo {
  userId: string;
  userName: string;
  displayName: string;
  badges: TwitchBadgeInfo | null;
  color?: string;
  isMod: boolean;
  isSubscriber: boolean;
  isBroadcaster: boolean;
}

/**
 * Twitch 聊天訊息
 */
export interface TwitchChatMessage {
  id: string;
  date: Date;
  userInfo: TwitchUserInfo;
  text: string;
  bits?: number;
  emoteOffsets: TwitchEmoteOffsets | null;
  isCheer: boolean;
}

/**
 * 訂閱資訊
 */
export interface TwitchSubInfo {
  displayName: string;
  message?: string;
  months?: number;
  tier?: string;
  isPrime?: boolean;
}

/**
 * 贈送訂閱資訊
 */
export interface TwitchGiftSubInfo {
  displayName: string;
  gifterDisplayName?: string;
  months?: number;
  tier?: string;
  count?: number;
}

/**
 * Raid 資訊
 */
export interface TwitchRaidInfo {
  displayName: string;
  viewerCount: number;
}

/**
 * ChatClient 介面定義
 */
export interface ChatClientInterface {
  connect(): Promise<void>;
  join(channel: string): Promise<void>;
  part(channel: string): Promise<void>;
  quit(): Promise<void>;
  onMessage(
    callback: (channel: string, user: string, text: string, msg: TwitchChatMessage) => void
  ): void;
  onSub(
    callback: (
      channel: string,
      user: string,
      subInfo: TwitchSubInfo,
      msg: TwitchChatMessage | null
    ) => void
  ): void;
  onResub(
    callback: (
      channel: string,
      user: string,
      subInfo: TwitchSubInfo,
      msg: TwitchChatMessage | null
    ) => void
  ): void;
  onSubGift(
    callback: (
      channel: string,
      user: string,
      subInfo: TwitchGiftSubInfo,
      msg: TwitchChatMessage | null
    ) => void
  ): void;
  onRaid(
    callback: (
      channel: string,
      user: string,
      raidInfo: TwitchRaidInfo,
      msg: TwitchChatMessage | null
    ) => void
  ): void;
  onDisconnect(callback: (manually: boolean, reason: Error | undefined) => void): void;
  onConnect(callback: () => void): void;
}
