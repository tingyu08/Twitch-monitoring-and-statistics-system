/**
 * Twurple Chat Service
 *
 * 使用 @twurple/chat 提供 Twitch 聊天監聽功能：
 * - 連接到頻道聊天室
 * - 監聯訊息事件
 * - 處理訂閱、Cheer 等互動事件
 */

import { logger } from "../utils/logger";
import { viewerMessageRepository } from "../modules/viewer/viewer-message.repository";
import { prisma } from "../db/prisma";
import { decryptToken, encryptToken } from "../utils/crypto.utils";
import type {
  ChatClientInterface,
  TwitchChatMessage,
  TwitchSubInfo,
  TwitchGiftSubInfo,
  TwitchRaidInfo,
} from "../types/twurple-chat.types";
import { importTwurpleAuth, importTwurpleChat } from "../utils/dynamic-import";

// ========== 服務實作 ==========

import { webSocketGateway } from "./websocket.gateway";

// ========== 熱度追蹤設定 ==========
const HEAT_WINDOW_MS = 5000; // 5秒視窗
const HEAT_THRESHOLD_MSG = 50; // 5秒內超過50則訊息視為有熱度
const HEAT_COOLDOWN_MS = 30000; // 冷卻時間 30秒
const HEAT_CLEANUP_INTERVAL_MS = 30000; // Zeabur 免費層: 每 30 秒清理一次
const HEAT_STALE_THRESHOLD_MS = 30000; // Zeabur 免費層: 超過 30 秒沒活動即清理

// P1 Fix: channelIdCache 大小限制（避免無限增長）
const MAX_CHANNEL_ID_CACHE_SIZE = 500;

// P0 Memory Safety: 時間戳數組最大長度限制（避免高流量頻道記憶體洩漏）
const MAX_TIMESTAMPS_PER_CHANNEL = 1000;

export class TwurpleChatService {
  private chatClient: ChatClientInterface | null = null;
  private channels: Set<string> = new Set();
  private isConnected = false;
  private notInitializedWarned = false; // 避免重複警告
  private reconnectInFlight = false;

  // 熱度追蹤：channelName -> timestamps[]
  private messageTimestamps: Map<string, number[]> = new Map();
  // 熱度視窗起點索引：channelName -> startIndex（避免每則訊息都 splice/findIndex）
  private heatWindowStartIndex: Map<string, number> = new Map();
  // 熱度冷卻：channelName -> lastAlertTime
  private lastHeatAlert: Map<string, number> = new Map();
  // P1 Memory: Cleanup interval reference
  private cleanupInterval: NodeJS.Timeout | null = null;
  // P1 Optimization: channelName -> channelId cache for room-based broadcasting
  private channelIdCache: Map<string, string> = new Map();

  constructor() {
    // P1 Memory: Start periodic cleanup to prevent unbounded Map growth
    this.startCleanupInterval();
  }

  /**
   * P1 Memory: Periodic cleanup of stale heat tracking data
   * Prevents messageTimestamps and lastHeatAlert Maps from growing unbounded
   */
  private startCleanupInterval(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupStaleHeatData();
    }, HEAT_CLEANUP_INTERVAL_MS);

    // Don't prevent Node.js from exiting
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  /**
   * P1 Memory: Clean up heat tracking data for inactive channels
   */
  private cleanupStaleHeatData(): void {
    const now = Date.now();
    const staleThreshold = now - HEAT_STALE_THRESHOLD_MS;
    let cleanedChannels = 0;

    // Clean messageTimestamps - remove channels with no recent activity
    for (const [channelName, timestamps] of this.messageTimestamps.entries()) {
      // If no timestamps or all timestamps are old, remove the entry
      if (timestamps.length === 0 || timestamps[timestamps.length - 1] < staleThreshold) {
        this.messageTimestamps.delete(channelName);
        this.heatWindowStartIndex.delete(channelName);
        this.lastHeatAlert.delete(channelName); // Also clean alert tracking
        this.channelIdCache.delete(channelName); // Also clean channelId cache
        cleanedChannels++;
      }
    }

    // Clean orphaned lastHeatAlert entries (channels not in messageTimestamps)
    for (const channelName of this.lastHeatAlert.keys()) {
      if (!this.messageTimestamps.has(channelName)) {
        this.lastHeatAlert.delete(channelName);
      }
    }

    if (cleanedChannels > 0) {
      logger.debug(
        "Twurple Chat",
        `已清理 ${cleanedChannels} 個非活躍頻道的聊天室熱度資料，` +
          `目前仍追蹤 ${this.messageTimestamps.size} 個頻道`
      );
    }
  }

  /**
   * P1 Optimization: Get channelId from cache or database
   * P1 Fix: Implements LRU-like eviction when cache exceeds MAX_CHANNEL_ID_CACHE_SIZE
   */
  private async getChannelId(channelName: string): Promise<string | null> {
    const normalizedName = channelName.toLowerCase();

    // Check cache first - if found, refresh by re-setting (LRU behavior)
    const cached = this.channelIdCache.get(normalizedName);
    if (cached) {
      // Move to end (most recently used) by deleting and re-adding
      this.channelIdCache.delete(normalizedName);
      this.channelIdCache.set(normalizedName, cached);
      return cached;
    }

    // Query database
    try {
      const channel = await prisma.channel.findFirst({
        where: { channelName: normalizedName },
        select: { id: true },
      });

      if (channel) {
        // P1 Fix: Evict oldest entries if cache is full (LRU eviction)
        if (this.channelIdCache.size >= MAX_CHANNEL_ID_CACHE_SIZE) {
          // Map.keys().next() returns the oldest entry (first inserted)
          const oldestKey = this.channelIdCache.keys().next().value;
          if (oldestKey) {
            this.channelIdCache.delete(oldestKey);
          }
        }
        this.channelIdCache.set(normalizedName, channel.id);
        return channel.id;
      }
    } catch (error) {
      logger.error("Twurple Chat", `查詢 channelId 失敗：${channelName}`, error);
    }

    return null;
  }

  // ... (省略 initialize 等方法，保持不變)

  // ... (保留 initialize method)

  /**
   * 初始化並連接到 Twitch 聊天（帶重試機制）
   * @param maxRetries 最大重試次數
   * @param retryDelayMs 重試延遲（毫秒）
   */
  public async initialize(maxRetries = 3, retryDelayMs = 5000): Promise<void> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.initializeInternal();
        return; // 成功則直接返回
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const isRetryable =
          errorMessage.includes("timeout") ||
          errorMessage.includes("ETIMEDOUT") ||
          errorMessage.includes("ECONNRESET") ||
          errorMessage.includes("Connect Timeout") ||
          errorMessage.includes("UND_ERR");

        if (isRetryable && attempt < maxRetries) {
          const delay = retryDelayMs * attempt; // 指數退避：5s, 10s, 15s
          logger.warn(
            "Twurple Chat",
            `初始化失敗 (${errorMessage.substring(0, 50)}...)，重試 ${attempt}/${maxRetries}，等待 ${delay / 1000}s`
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        // 最後一次嘗試失敗或非可重試錯誤
        logger.error("Twurple Chat", `連接 Twitch Chat 失敗（第 ${attempt} 次嘗試）`, error);
        this.isConnected = false;
        return;
      }
    }
  }

  /**
   * 內部初始化邏輯（不帶重試）
   */
  private async initializeInternal(): Promise<void> {
    const { ChatClient } = await importTwurpleChat();

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
        "資料庫中找不到可用的使用者 Token，請先登入 Twitch。聊天室監聽已停用。"
      );
      return;
    }

    const clientId = process.env.TWITCH_CLIENT_ID || "";
    const clientSecret = process.env.TWITCH_CLIENT_SECRET || "";

    if (!clientId || !clientSecret) {
      logger.warn(
        "Twurple Chat",
        "缺少 TWITCH_CLIENT_ID 或 TWITCH_CLIENT_SECRET，聊天室監聽已停用。"
      );
      return;
    }

    // 解密 Token
    const accessToken = decryptToken(tokenRecord.accessToken);
    const refreshToken = decryptToken(tokenRecord.refreshToken);

    const { RefreshingAuthProvider } = await importTwurpleAuth();

    const authProvider = new RefreshingAuthProvider({
      clientId,
      clientSecret,
    });

    // 設定 Token 刷新回調（刷新後更新資料庫）
    authProvider.onRefresh(
      async (
        userId: string,
        newTokenData: import("../types/twitch.types").TwurpleRefreshCallbackData
      ) => {
        logger.info("Twurple Chat", `Token 已刷新：${userId}`);

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
      }
    );

    // 添加使用者的 Token（這是可能超時的步驟）
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
    }) as unknown as ChatClientInterface;

    this.setupEventHandlers();

    await this.chatClient.connect();
    this.isConnected = true;
    this.notInitializedWarned = false; // 重設警告 flag
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
  }

  // ... (保留 setupEventHandlers, joinChannel, leaveChannel methods)

  /**
   * 設定事件處理器
   */
  private setupEventHandlers(): void {
    if (!this.chatClient) return;

    // 監聽一般訊息
    this.chatClient.onMessage(
      (channel: string, user: string, text: string, msg: TwitchChatMessage) => {
        this.handleMessage(channel, user, text, msg);
      }
    );

    // 監聯訂閱事件
    this.chatClient.onSub(
      (channel: string, user: string, subInfo: TwitchSubInfo, msg: TwitchChatMessage | null) => {
        this.handleSubscription(channel, user, subInfo, msg);
      }
    );

    // 監聽續訂事件
    this.chatClient.onResub(
      (channel: string, user: string, subInfo: TwitchSubInfo, msg: TwitchChatMessage | null) => {
        this.handleSubscription(channel, user, subInfo, msg);
      }
    );

    // 監聽贈送訂閱
    this.chatClient.onSubGift(
      (
        channel: string,
        user: string,
        subInfo: TwitchGiftSubInfo,
        msg: TwitchChatMessage | null
      ) => {
        this.handleGiftSub(channel, user, subInfo, msg);
      }
    );

    // 監聽揪團 (Raid)
    this.chatClient.onRaid(
      (channel: string, user: string, raidInfo: TwitchRaidInfo, msg: TwitchChatMessage | null) => {
        this.handleRaid(channel, user, raidInfo, msg);
      }
    );

    // 監聽斷線事件
    this.chatClient.onDisconnect((manually: boolean, reason: Error | undefined) => {
      this.isConnected = false;
      if (!manually) {
        logger.warn("Twurple Chat", `已斷線：${reason}`);
      }
    });

    // 監聽重連事件
    this.chatClient.onConnect(() => {
      this.isConnected = true;
      logger.info("Twurple Chat", "已連接/重連");
      void this.rejoinTrackedChannels();
    });
  }

  private async rejoinTrackedChannels(): Promise<void> {
    if (!this.chatClient || this.reconnectInFlight || this.channels.size === 0) {
      return;
    }

    this.reconnectInFlight = true;

    try {
      const trackedChannels = Array.from(this.channels);

      for (const channelName of trackedChannels) {
        try {
          await this.chatClient.join(channelName);
        } catch (error) {
          logger.warn("Twurple Chat", `重連後重新加入頻道失敗：${channelName}`, error);
        }
      }
    } finally {
      this.reconnectInFlight = false;
    }
  }

  /**
   * 加入頻道
   */
  public async joinChannel(channel: string, retryCount = 0): Promise<boolean> {
    if (!this.chatClient) {
      if (!this.notInitializedWarned) {
        logger.warn("Twurple Chat", "聊天客戶端尚未初始化，請先登入 Twitch。");
        this.notInitializedWarned = true;
      }
      return false;
    }

    const channelName = channel.toLowerCase().replace(/^#/, "");
    const MAX_RETRIES = 2; // 最多重試 2 次
    const RETRY_DELAY = 2000; // 重試延遲 2 秒

    try {
      if (!this.channels.has(channelName)) {
        await this.chatClient.join(channelName);
        this.channels.add(channelName);
        if (retryCount > 0) {
          logger.info(
            "Twurple Chat",
            `重試 ${retryCount} 次後成功加入頻道：${channelName}`
          );
        }
        return true;
      }
      return true;
    } catch (error) {
      // IRC 連線超時：嘗試重試
      if (error instanceof Error && error.message.includes("Did not receive a reply")) {
        if (retryCount < MAX_RETRIES) {
          logger.debug(
            "Twurple Chat",
            `加入頻道逾時：${channelName}，將於 ${RETRY_DELAY}ms 後重試（第 ${retryCount + 1}/${MAX_RETRIES} 次）`
          );
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
          return this.joinChannel(channel, retryCount + 1);
        } else {
          logger.warn(
            "Twurple Chat",
            `加入頻道失敗：${channelName}，重試 ${MAX_RETRIES} 次後仍發生 IRC 逾時`
          );
        }
      } else {
        logger.error("Twurple Chat", `加入頻道失敗：${channelName}`, error);
      }

      return false;
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
        logger.error("Twurple Chat", `離開頻道失敗：${channelName}`, error);
    }
  }

  /**
   * 處理一般訊息
   */
  private handleMessage(channel: string, user: string, text: string, msg: TwitchChatMessage): void {
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

      // 3. 檢測熱度 (Heat Check) - now async, fire and forget
      this.checkChatHeat(channelName, text).catch((err) =>
        logger.error("Twurple Chat", "檢查聊天室熱度時發生錯誤", err)
      );
    } catch (err) {
      logger.error("Twurple Chat", "處理聊天室訊息失敗", err);
    }
  }

  /**
   * 檢測聊天室熱度
   * P1 Optimization: Now uses room-based broadcasting with channelId
   */
  private async checkChatHeat(channelName: string, text: string): Promise<void> {
    const now = Date.now();

    // 獲取該頻道的訊息時間戳
    const timestamps = this.messageTimestamps.get(channelName) || [];
    if (!this.messageTimestamps.has(channelName)) {
      this.messageTimestamps.set(channelName, timestamps);
      this.heatWindowStartIndex.set(channelName, 0);
    }

    // 加入當前訊息時間
    timestamps.push(now);

    // P0 Memory Safety: 限制數組大小，避免高流量頻道記憶體洩漏
    if (timestamps.length > MAX_TIMESTAMPS_PER_CHANNEL) {
      const overflowCount = timestamps.length - MAX_TIMESTAMPS_PER_CHANNEL;
      if (overflowCount > 0) {
        const currentStartIndex = this.heatWindowStartIndex.get(channelName) || 0;
        const nextStartIndex = Math.max(0, currentStartIndex - overflowCount);
        timestamps.splice(0, overflowCount);
        this.heatWindowStartIndex.set(channelName, nextStartIndex);
      }
    }

    // 移動視窗起點（避免每則訊息都 findIndex + splice）
    const validStart = now - HEAT_WINDOW_MS;
    let startIndex = this.heatWindowStartIndex.get(channelName) || 0;

    while (startIndex < timestamps.length && timestamps[startIndex] < validStart) {
      startIndex += 1;
    }

    // 定期壓縮陣列，避免頭部已過期資料長期佔用記憶體
    if (startIndex > 0 && (startIndex >= 128 || startIndex > timestamps.length / 2)) {
      timestamps.splice(0, startIndex);
      startIndex = 0;
    }

    this.heatWindowStartIndex.set(channelName, startIndex);
    const windowCount = timestamps.length - startIndex;

    // 檢查是否超過閾值
    if (windowCount >= HEAT_THRESHOLD_MSG) {
      const lastAlert = this.lastHeatAlert.get(channelName) || 0;

      // 檢查是否在冷卻時間內
      if (now - lastAlert > HEAT_COOLDOWN_MS) {
        // Get channelId for room-based broadcasting
        const channelId = await this.getChannelId(channelName);
        if (!channelId) {
          logger.debug("Chat Heat", `略過聊天室熱度提醒：找不到頻道 ${channelName}`);
          return;
        }

        // 觸發熱度警報！
        logger.debug(
          "Chat Heat",
          `🔥 頻道 ${channelName} 聊天熱度正在升高！（5 秒內 ${windowCount} 則訊息）`
        );

        webSocketGateway.broadcastChatHeat({
          channelId,
          channelName,
          heatLevel: windowCount,
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
    subInfo: TwitchSubInfo,
    msg: TwitchChatMessage | null
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
        badges: null as Record<string, string> | null,
        bitsAmount: null as number | null,
        emotesUsed: null as string[] | null,
      };

      viewerMessageRepository.saveMessage(channelName, parsedMessage);

      // 訂閱也算熱度 - now async, fire and forget
      this.checkChatHeat(channelName, "New Subscription!").catch((err) =>
        logger.error("Twurple Chat", "檢查聊天室熱度時發生錯誤", err)
      );
    } catch (err) {
      logger.error("Twurple Chat", "處理訂閱事件失敗", err);
    }
  }

  // ... (保留 handleGiftSub, extractBadges, extractEmotes, getStatus, disconnect)

  /**
   * 處理贈送訂閱
   */
  private handleGiftSub(
    channel: string,
    user: string,
    subInfo: TwitchGiftSubInfo,
    msg: TwitchChatMessage | null
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
        badges: null as Record<string, string> | null,
        bitsAmount: null as number | null,
        emotesUsed: null as string[] | null,
      };

      viewerMessageRepository.saveMessage(channelName, parsedMessage);

      // Gift sub 也算熱度 - now async, fire and forget
      this.checkChatHeat(channelName, "Gift Sub!").catch((err) =>
        logger.error("Twurple Chat", "檢查聊天室熱度時發生錯誤", err)
      );
    } catch (err) {
      logger.error("Twurple Chat", "處理贈送訂閱事件失敗", err);
    }
  }

  /**
   * 處理揪團 (Raid)
   * P1 Optimization: Now uses room-based broadcasting with channelId
   */
  private async handleRaid(
    channel: string,
    user: string,
    raidInfo: TwitchRaidInfo,
    msg: TwitchChatMessage | null
  ): Promise<void> {
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
        badges: null as Record<string, string> | null,
        bitsAmount: null as number | null,
        emotesUsed: null as string[] | null,
      };

      viewerMessageRepository.saveMessage(channelName, parsedMessage);

      // Get channelId for room-based broadcasting
      const channelId = await this.getChannelId(channelName);
      if (channelId) {
        // 強制推播 Raid 事件 (room-based)
        webSocketGateway.broadcastRaid({
          channelId,
          channelName,
          raider: raidInfo.displayName || user,
          viewers: viewerCount,
        });
      }

      await this.checkChatHeat(channelName, `Raid from ${user}`);
    } catch (err) {
      logger.error("Twurple Chat", "處理 Raid 事件失敗", err);
    }
  }

  /**
   * 提取徽章資訊
   */
  private extractBadges(msg: TwitchChatMessage): Record<string, string> | null {
    try {
      const badges: Record<string, string> = {};
      const badgeInfo = msg.userInfo.badges;

      if (badgeInfo) {
        badgeInfo.forEach((version: string, badge: string) => {
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
  private extractEmotes(msg: TwitchChatMessage): string[] | null {
    try {
      const emotes = msg.emoteOffsets;
      if (!emotes || emotes.size === 0) return null;

      const emoteIds: string[] = [];
      emotes.forEach((_offsets: unknown, emoteId: string) => {
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
    // P1 Memory: Clear cleanup interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    if (this.chatClient) {
      this.chatClient.quit();
      this.isConnected = false;
      this.channels.clear();
      // P1 Memory: Clear heat tracking Maps on disconnect
      this.messageTimestamps.clear();
      this.lastHeatAlert.clear();
      this.channelIdCache.clear();
      logger.info("Twurple Chat", "手動斷線");
    }
  }
}

// 單例模式
export const twurpleChatService = new TwurpleChatService();
