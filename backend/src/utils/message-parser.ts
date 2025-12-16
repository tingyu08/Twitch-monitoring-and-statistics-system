/**
 * Message Parser
 *
 * 解析 Twitch 聊天訊息為統一格式
 * 使用 Twurple (@twurple/chat)
 */

// ========== 類型定義 ==========

export interface ParsedMessage {
  twitchUserId: string;
  displayName: string;
  messageText: string;
  messageType: "CHAT" | "SUBSCRIPTION" | "CHEER" | "RAID" | "GIFT_SUBSCRIPTION";
  timestamp: Date;
  badges: Record<string, string> | null;
  emotes: string[] | null;
  bits: number;
}

// 從 Chat Service 傳入的原始訊息格式
export interface RawChatMessage {
  viewerId: string;
  username: string;
  displayName: string;
  messageText: string;
  messageType: string;
  timestamp: Date;
  badges: Record<string, string> | null;
  bitsAmount: number | null;
  emotesUsed: string[] | null;
}

// ========== 工具函數 ==========

export class MessageParser {
  /**
   * 將 RawChatMessage 轉換為 ParsedMessage
   */
  static fromRawMessage(raw: RawChatMessage): ParsedMessage {
    return {
      twitchUserId: raw.viewerId,
      displayName: raw.displayName,
      messageText: raw.messageText,
      messageType: this.normalizeMessageType(raw.messageType),
      timestamp: raw.timestamp,
      badges: raw.badges,
      emotes: raw.emotesUsed,
      bits: raw.bitsAmount || 0,
    };
  }

  /**
   * 標準化訊息類型
   */
  private static normalizeMessageType(
    type: string
  ): ParsedMessage["messageType"] {
    switch (type.toUpperCase()) {
      case "CHAT":
        return "CHAT";
      case "SUBSCRIPTION":
        return "SUBSCRIPTION";
      case "CHEER":
        return "CHEER";
      case "RAID":
        return "RAID";
      case "GIFT_SUBSCRIPTION":
        return "GIFT_SUBSCRIPTION";
      default:
        return "CHAT";
    }
  }

  /**
   * 解析一般聊天訊息（舊版相容，用於直接構建）
   */
  static parseChatMessage(
    userId: string,
    displayName: string,
    message: string,
    bits?: number,
    badges?: Record<string, string> | null,
    emotes?: string[] | null
  ): ParsedMessage {
    return {
      twitchUserId: userId,
      displayName: displayName,
      messageText: message,
      messageType: bits && bits > 0 ? "CHEER" : "CHAT",
      timestamp: new Date(),
      badges: badges || null,
      emotes: emotes || null,
      bits: bits || 0,
    };
  }

  /**
   * 解析訂閱訊息
   */
  static parseSubscription(
    userId: string,
    displayName: string,
    message: string
  ): ParsedMessage {
    return {
      twitchUserId: userId,
      displayName: displayName,
      messageText: message,
      messageType: "SUBSCRIPTION",
      timestamp: new Date(),
      badges: null,
      emotes: null,
      bits: 0,
    };
  }

  /**
   * 解析贈送訂閱
   */
  static parseGiftSubscription(
    userId: string,
    displayName: string,
    recipientName: string
  ): ParsedMessage {
    return {
      twitchUserId: userId,
      displayName: displayName,
      messageText: `Gifted sub to ${recipientName}`,
      messageType: "GIFT_SUBSCRIPTION",
      timestamp: new Date(),
      badges: null,
      emotes: null,
      bits: 0,
    };
  }
}
