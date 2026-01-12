/**
 * Twurple Chat Service
 *
 * 使用 @twurple/chat 提供 Twitch 聊天監聽功能：
 * - 連接到頻道聊天室
 * - 監聯訊息事件
 * - 處理訂閱、Cheer 等互動事件
 */

import {
  ChatClient,
  ChatMessage,
  ChatSubInfo,
  ChatSubGiftInfo,
  ChatRaidInfo,
  UserNotice,
} from "@twurple/chat";
import { RefreshingAuthProvider } from "@twurple/auth";
import { logger } from "../utils/logger";
import { viewerMessageRepository } from "../modules/viewer/viewer-message.repository";
import { prisma } from "../db/prisma";
import { decryptToken, encryptToken } from "../utils/crypto.utils";

// ========== 服務實作 ==========

import { webSocketGateway } from "./websocket.gateway";

// ========== 熱度追蹤設定 ==========
const HEAT_WINDOW_MS = 5000; // 5秒視窗
const HEAT_THRESHOLD_MSG = 50; // 5秒內超過50則訊息視為有熱度
const HEAT_COOLDOWN_MS = 30000; // 冷卻時間 30秒

export class TwurpleChatService {
  private chatClient: ChatClient | null = null;
  private channels: Set<string> = new Set();
  private isConnected = false;

  // 熱度追蹤：channelName -> timestamps[]
  private messageTimestamps: Map<string, number[]> = new Map();
  // 熱度冷卻：channelName -> lastAlertTime
  private lastHeatAlert: Map<string, number> = new Map();

  constructor() {}

  // ... (省略 initialize 等方法，保持不變)

  // ... (保留 initialize method)

  /**
   * 初始化並連接到 Twitch 聊天
   */
  public async initialize(): Promise<void> {
    try {
      // 從資料庫獲取第一個有 Token 的使用者（通常是您自己）
      const tokenRecord = await prisma.twitchToken.findFirst({
        where: {
          refreshToken: { not: null },
        },
        include: {
          streamer: {
            include: {
              channels: true, // 需要獲取頻道的英文 channelName
            },
          },
        },
      });

      if (!tokenRecord || !tokenRecord.refreshToken) {
        logger.warn(
          "Twurple Chat",
          "No user token found in database. Please login first. Chat listener disabled."
        );
        return;
      }

      const clientId = process.env.TWITCH_CLIENT_ID || "";
      const clientSecret = process.env.TWITCH_CLIENT_SECRET || "";

      if (!clientId || !clientSecret) {
        logger.warn(
          "Twurple Chat",
          "Missing TWITCH_CLIENT_ID or TWITCH_CLIENT_SECRET. Chat listener disabled."
        );
        return;
      }

      // 解密 Token
      const accessToken = decryptToken(tokenRecord.accessToken);
      const refreshToken = decryptToken(tokenRecord.refreshToken);

      // 建立 RefreshingAuthProvider（自動刷新 Token）
      const authProvider = new RefreshingAuthProvider({
        clientId,
        clientSecret,
      });

      // 設定 Token 刷新回調（刷新後更新資料庫）
      authProvider.onRefresh(async (userId, newTokenData) => {
        logger.info("Twurple Chat", `Token 已獲刷新: ${userId}`);

        // 更新資料庫中的 Token
        await prisma.twitchToken.update({
          where: { id: tokenRecord.id },
          data: {
            accessToken: encryptToken(newTokenData.accessToken),
            refreshToken: newTokenData.refreshToken
              ? encryptToken(newTokenData.refreshToken)
              : tokenRecord.refreshToken,
            expiresAt: newTokenData.expiresIn
              ? new Date(Date.now() + newTokenData.expiresIn * 1000)
              : null,
          },
        });
      });

      // 添加使用者的 Token
      await authProvider.addUserForToken(
        {
          accessToken,
          refreshToken,
          expiresIn: tokenRecord.expiresAt
            ? Math.floor((tokenRecord.expiresAt.getTime() - Date.now()) / 1000)
            : null,
          obtainmentTimestamp: tokenRecord.updatedAt.getTime(),
        },
        ["chat"]
      );

      // 建立 Chat Client
      this.chatClient = new ChatClient({
        authProvider,
        channels: [], // 初始為空，稍後動態加入
        logger: {
          minLevel: "error", // Suppress "Unrecognized usernotice ID" warnings
        },
      });

      this.setupEventHandlers();

      await this.chatClient.connect();
      this.isConnected = true;
      logger.info(
        "Twurple Chat",
        `已連接至 Twitch Chat: ${tokenRecord.streamer?.displayName} (自動刷新)`
      );

      // 自動加入自己的頻道（即使未開台也能監聽）
      // 注意：必須使用英文 channelName (login)，而非中文 displayName
      const channelName = tokenRecord.streamer?.channels?.[0]?.channelName;
      if (channelName) {
        await this.joinChannel(channelName);
      }
    } catch (error) {
      logger.error("Twurple Chat", "連接 Twitch Chat 失敗", error);
      this.isConnected = false;
    }
  }

  // ... (保留 setupEventHandlers, joinChannel, leaveChannel methods)

  /**
   * 設定事件處理器
   */
  private setupEventHandlers(): void {
    if (!this.chatClient) return;

    // 監聽一般訊息
    this.chatClient.onMessage(
      (channel: string, user: string, text: string, msg: ChatMessage) => {
        this.handleMessage(channel, user, text, msg);
      }
    );

    // 監聯訂閱事件
    this.chatClient.onSub((channel, user, subInfo, msg) => {
      this.handleSubscription(channel, user, subInfo, msg);
    });

    // 監聽續訂事件
    this.chatClient.onResub((channel, user, subInfo, msg) => {
      this.handleSubscription(channel, user, subInfo, msg);
    });

    // 監聽贈送訂閱
    this.chatClient.onSubGift((channel, user, subInfo, msg) => {
      this.handleGiftSub(channel, user, subInfo, msg);
    });

    // 監聽揪團 (Raid)
    this.chatClient.onRaid((channel, user, raidInfo, msg) => {
      this.handleRaid(channel, user, raidInfo, msg);
    });

    // 監聽斷線事件
    this.chatClient.onDisconnect((manually, reason) => {
      this.isConnected = false;
      if (!manually) {
        logger.warn("Twurple Chat", `已斷線: ${reason}`);
      }
    });

    // 監聽重連事件
    this.chatClient.onConnect(() => {
      this.isConnected = true;
      logger.info("Twurple Chat", "已連接/重連");
    });
  }

  /**
   * 加入頻道
   */
  public async joinChannel(channel: string): Promise<void> {
    if (!this.chatClient) {
      logger.warn("Twurple Chat", "Chat client not initialized");
      return;
    }

    const channelName = channel.toLowerCase().replace(/^#/, "");

    try {
      if (!this.channels.has(channelName)) {
        await this.chatClient.join(channelName);
        this.channels.add(channelName);
        // logger.info("Twurple Chat", `Joined channel: ${channelName}`);
      }
    } catch (error) {
      logger.error(
        "Twurple Chat",
        `Failed to join channel ${channelName}`,
        error
      );
    }
  }

  /**
   * 離開頻道
   */
  public async leaveChannel(channel: string): Promise<void> {
    if (!this.chatClient) return;

    const channelName = channel.toLowerCase().replace(/^#/, "");

    try {
      if (this.channels.has(channelName)) {
        await this.chatClient.part(channelName);
        this.channels.delete(channelName);
        // logger.info("Twurple Chat", `Left channel: ${channelName}`);
      }
    } catch (error) {
      logger.error(
        "Twurple Chat",
        `Failed to leave channel ${channelName}`,
        error
      );
    }
  }

  /**
   * 處理一般訊息
   */
  private handleMessage(
    channel: string,
    user: string,
    text: string,
    msg: ChatMessage
  ): void {
    const channelName = channel.replace(/^#/, "");

    try {
      // 1. 轉換訊息格式
      const parsedMessage = {
        viewerId: msg.userInfo.userId,
        username: user,
        displayName: msg.userInfo.displayName,
        messageText: text,
        messageType: msg.bits && msg.bits > 0 ? "CHEER" : "CHAT",
        timestamp: msg.date,
        badges: this.extractBadges(msg),
        bitsAmount: msg.bits || null,
        emotesUsed: this.extractEmotes(msg),
      };

      // 2. 儲存訊息
      viewerMessageRepository.saveMessage(channelName, parsedMessage);

      // 3. 檢測熱度 (Heat Check)
      this.checkChatHeat(channelName, text);
    } catch (err) {
      logger.error("Twurple Chat", "Error handling message", err);
    }
  }

  /**
   * 檢測聊天室熱度
   */
  private checkChatHeat(channelName: string, text: string) {
    const now = Date.now();

    // 獲取該頻道的訊息時間戳
    const timestamps = this.messageTimestamps.get(channelName) || [];
    if (!this.messageTimestamps.has(channelName)) {
      this.messageTimestamps.set(channelName, timestamps);
    }

    // 加入當前訊息時間
    timestamps.push(now);

    // 移除視窗外的時間戳（例如只保留最近 5 秒）
    const validStart = now - HEAT_WINDOW_MS;
    while (timestamps.length > 0 && timestamps[0] < validStart) {
      timestamps.shift();
    }

    // 檢查是否超過閾值
    if (timestamps.length >= HEAT_THRESHOLD_MSG) {
      const lastAlert = this.lastHeatAlert.get(channelName) || 0;

      // 檢查是否在冷卻時間內
      if (now - lastAlert > HEAT_COOLDOWN_MS) {
        // 觸發熱度警報！
        logger.info(
          "Chat Heat",
          `🔥 Channel ${channelName} is heating up! (${timestamps.length} msgs/5s)`
        );

        webSocketGateway.emit("chat.heat", {
          channelName,
          heatLevel: timestamps.length,
          message: text.substring(0, 20), // 附帶最後一則訊息作為範例
        });

        this.lastHeatAlert.set(channelName, now);
      }
    }
  }

  /**
   * 處理訂閱事件
   */
  private handleSubscription(
    channel: string,
    user: string,
    subInfo: ChatSubInfo,
    msg: UserNotice
  ): void {
    const channelName = channel.replace(/^#/, "");

    try {
      const parsedMessage = {
        viewerId: msg?.userInfo?.userId || user,
        username: user,
        displayName: subInfo.displayName || user,
        messageText: subInfo.message || "",
        messageType: "SUBSCRIPTION",
        timestamp: new Date(),
        badges: null,
        bitsAmount: null,
        emotesUsed: null,
      };

      viewerMessageRepository.saveMessage(channelName, parsedMessage);

      // 訂閱也算熱度
      this.checkChatHeat(channelName, "New Subscription!");
    } catch (err) {
      logger.error("Twurple Chat", "Error handling subscription", err);
    }
  }

  // ... (保留 handleGiftSub, extractBadges, extractEmotes, getStatus, disconnect)

  /**
   * 處理贈送訂閱
   */
  private handleGiftSub(
    channel: string,
    user: string,
    subInfo: ChatSubGiftInfo,
    msg: UserNotice
  ): void {
    const channelName = channel.replace(/^#/, "");

    try {
      const parsedMessage = {
        viewerId: msg?.userInfo?.userId || user,
        username: user,
        displayName: subInfo.gifterDisplayName || user,
        messageText: `Gifted sub to ${subInfo.displayName}`,
        messageType: "GIFT_SUBSCRIPTION",
        timestamp: new Date(),
        badges: null,
        bitsAmount: null,
        emotesUsed: null,
      };

      viewerMessageRepository.saveMessage(channelName, parsedMessage);

      this.checkChatHeat(channelName, "Gift Sub!");
    } catch (err) {
      logger.error("Twurple Chat", "Error handling gift sub", err);
    }
  }

  /**
   * 處理揪團 (Raid)
   */
  private handleRaid(
    channel: string,
    user: string,
    raidInfo: ChatRaidInfo,
    msg: UserNotice
  ): void {
    const channelName = channel.replace(/^#/, "");

    try {
      const viewerCount = raidInfo.viewerCount;
      const parsedMessage = {
        viewerId: msg?.userInfo?.userId || user,
        username: user,
        displayName: raidInfo.displayName || user,
        messageText: `Raid with ${viewerCount} viewers`,
        messageType: "RAID",
        timestamp: new Date(),
        badges: null,
        bitsAmount: null,
        emotesUsed: null,
      };

      viewerMessageRepository.saveMessage(channelName, parsedMessage);

      // 強制推播 Raid 事件
      webSocketGateway.emit("stream.raid", {
        channelName,
        raider: raidInfo.displayName || user,
        viewers: viewerCount,
      });

      this.checkChatHeat(channelName, `Raid from ${user}`);
    } catch (err) {
      logger.error("Twurple Chat", "Error handling raid", err);
    }
  }

  /**
   * 提取徽章資訊
   */
  private extractBadges(msg: ChatMessage): Record<string, string> | null {
    try {
      const badges: Record<string, string> = {};
      const badgeInfo = msg.userInfo.badges;

      if (badgeInfo) {
        badgeInfo.forEach((version, badge) => {
          badges[badge] = version;
        });
      }

      return Object.keys(badges).length > 0 ? badges : null;
    } catch {
      return null;
    }
  }

  /**
   * 提取表情符號資訊
   */
  private extractEmotes(msg: ChatMessage): string[] | null {
    try {
      const emotes = msg.emoteOffsets;
      if (!emotes || emotes.size === 0) return null;

      const emoteIds: string[] = [];
      emotes.forEach((_, emoteId) => {
        emoteIds.push(emoteId);
      });

      return emoteIds.length > 0 ? emoteIds : null;
    } catch {
      return null;
    }
  }

  /**
   * 獲取服務狀態
   */
  public getStatus() {
    return {
      connected: this.isConnected,
      channels: Array.from(this.channels),
      channelCount: this.channels.size,
    };
  }

  /**
   * 斷開連接
   */
  public async disconnect(): Promise<void> {
    if (this.chatClient) {
      this.chatClient.quit();
      this.isConnected = false;
      this.channels.clear();
      logger.info("Twurple Chat", "手動斷線");
    }
  }
}

// 單例模式
export const twurpleChatService = new TwurpleChatService();
