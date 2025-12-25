/**
 * Chat Listener Manager
 *
 * 管理 Twurple Chat 監聽器的資源控制：
 * - 自動停止離線頻道的監聯
 * - 限制單實例最大監聽數量
 * - 按活躍度優先級監聽
 * - 健康檢查與監控
 * - 多實例分佈式協調
 */

import { twurpleChatService } from "./twitch-chat.service";
import { distributedCoordinator } from "./distributed-coordinator";
import { logger } from "../utils/logger";

// ========== 類型定義 ==========

interface ChannelInfo {
  channelName: string;
  isLive: boolean;
  lastActivity: Date;
  priority: number; // 優先級：越高越重要
  viewerCount: number;
}

interface ListenerStats {
  totalChannels: number;
  activeChannels: number;
  pausedChannels: number;
  lastHealthCheck: Date | null;
  isHealthy: boolean;
  instanceId: string;
}

// ========== 配置常數 ==========

const MAX_CHANNELS_PER_INSTANCE = 20; // 降低以減少記憶體使用 (Render 免費版 512MB)
const HEALTH_CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 分鐘 (減少系統開銷)
const INACTIVE_TIMEOUT_MS = 30 * 60 * 1000; // 30 分鐘無活動自動停止
const ENABLE_DISTRIBUTED_MODE = process.env.ENABLE_DISTRIBUTED_MODE === "true";

// ========== Listener Manager ==========

export class ChatListenerManager {
  private channels: Map<string, ChannelInfo> = new Map();
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private lastHealthCheck: Date | null = null;
  private isHealthy = true;

  /**
   * 啟動管理器
   */
  public async start(): Promise<void> {
    logger.info("ListenerManager", "正在啟動聊天室監聽管理器");

    // 如果啟用分佈式模式，啟動協調器
    if (ENABLE_DISTRIBUTED_MODE) {
      logger.info("ListenerManager", "分佈式模式已啟用");
      await distributedCoordinator.start();
    }

    // 啟動健康檢查
    this.startHealthCheck();
  }

  /**
   * 停止管理器
   */
  public stop(): void {
    logger.info("ListenerManager", "正在停止聊天室監聽管理器");

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  /**
   * 請求監聽頻道
   */
  public async requestListen(
    channelName: string,
    options?: {
      priority?: number;
      isLive?: boolean;
    }
  ): Promise<boolean> {
    const normalizedName = channelName.toLowerCase().replace(/^#/, "");

    // 檢查是否已在監聽
    if (this.channels.has(normalizedName)) {
      // 更新資訊
      const info = this.channels.get(normalizedName);
      if (info) {
        info.lastActivity = new Date();
        if (options?.isLive !== undefined) {
          info.isLive = options.isLive;
        }
        if (options?.priority !== undefined) {
          info.priority = options.priority;
        }
      }
      return true;
    }

    // 檢查是否超過最大限制
    if (this.channels.size >= MAX_CHANNELS_PER_INSTANCE) {
      // 嘗試移除優先級最低的離線頻道
      const removed = this.evictLowestPriorityChannel();
      if (!removed) {
        logger.warn(
          "ListenerManager",
          `無法加入頻道 ${normalizedName}: 達到上限 (${MAX_CHANNELS_PER_INSTANCE})`
        );
        return false;
      }
    }

    // 加入頻道
    try {
      await twurpleChatService.joinChannel(normalizedName);

      this.channels.set(normalizedName, {
        channelName: normalizedName,
        isLive: options?.isLive ?? false,
        lastActivity: new Date(),
        priority: options?.priority ?? 1,
        viewerCount: 0,
      });

      // logger.info(
      //   "ListenerManager",
      //   `Added channel: ${normalizedName} (total: ${this.channels.size})`
      // );
      return true;
    } catch (error) {
      logger.error("ListenerManager", `加入頻道失敗: ${normalizedName}`, error);
      return false;
    }
  }

  /**
   * 停止監聽頻道
   */
  public async stopListening(channelName: string): Promise<void> {
    const normalizedName = channelName.toLowerCase().replace(/^#/, "");

    if (this.channels.has(normalizedName)) {
      await twurpleChatService.leaveChannel(normalizedName);
      this.channels.delete(normalizedName);
      // logger.info(
      //   "ListenerManager",
      //   `Removed channel: ${normalizedName} (total: ${this.channels.size})`
      // );
    }
  }

  /**
   * 更新頻道狀態（直播中/離線）
   */
  public updateChannelStatus(
    channelName: string,
    isLive: boolean,
    viewerCount?: number
  ): void {
    const normalizedName = channelName.toLowerCase().replace(/^#/, "");
    const info = this.channels.get(normalizedName);

    if (info) {
      info.isLive = isLive;
      info.lastActivity = new Date();
      if (viewerCount !== undefined) {
        info.viewerCount = viewerCount;
      }

      // 如果頻道離線，降低優先級
      if (!isLive && info.priority > 0) {
        info.priority = Math.max(0, info.priority - 1);
      }
    }
  }

  /**
   * 移除優先級最低的離線頻道
   */
  private evictLowestPriorityChannel(): boolean {
    let lowestPriority = Infinity;
    let candidateChannel: string | null = null;

    this.channels.forEach((info, name) => {
      // 只考慮離線頻道
      if (!info.isLive && info.priority < lowestPriority) {
        lowestPriority = info.priority;
        candidateChannel = name;
      }
    });

    if (candidateChannel) {
      this.stopListening(candidateChannel);
      return true;
    }

    return false;
  }

  /**
   * 啟動健康檢查
   */
  private startHealthCheck(): void {
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
    }, HEALTH_CHECK_INTERVAL_MS);

    // 立即執行一次
    this.performHealthCheck();
  }

  /**
   * 執行健康檢查
   */
  private performHealthCheck(): void {
    const now = new Date();
    this.lastHealthCheck = now;

    try {
      const chatStatus = twurpleChatService.getStatus();
      this.isHealthy = chatStatus.connected;

      // 檢查並移除長時間無活動的離線頻道
      const channelsToRemove: string[] = [];

      this.channels.forEach((info, name) => {
        const inactiveTime = now.getTime() - info.lastActivity.getTime();

        // 離線且超過無活動時間
        if (!info.isLive && inactiveTime > INACTIVE_TIMEOUT_MS) {
          channelsToRemove.push(name);
        }
      });

      // 移除無活動頻道
      for (const name of channelsToRemove) {
        this.stopListening(name);
        logger.info("ListenerManager", `自動停止非活躍頻道: ${name}`);
      }

      if (channelsToRemove.length > 0) {
        logger.info(
          "ListenerManager",
          `健康檢查: 已移除 ${channelsToRemove.length} 個非活躍頻道`
        );
      }
    } catch (error) {
      this.isHealthy = false;
      logger.error("ListenerManager", "健康檢查失敗", error);
    }
  }

  /**
   * 獲取統計資訊
   */
  public getStats(): ListenerStats {
    let activeCount = 0;
    let pausedCount = 0;

    this.channels.forEach((info) => {
      if (info.isLive) {
        activeCount++;
      } else {
        pausedCount++;
      }
    });

    return {
      totalChannels: this.channels.size,
      activeChannels: activeCount,
      pausedChannels: pausedCount,
      lastHealthCheck: this.lastHealthCheck,
      isHealthy: this.isHealthy,
      instanceId: ENABLE_DISTRIBUTED_MODE
        ? distributedCoordinator.getInstanceId()
        : "standalone",
    };
  }

  /**
   * 獲取所有頻道資訊
   */
  public getChannels(): ChannelInfo[] {
    return Array.from(this.channels.values());
  }

  /**
   * 獲取健康狀態（用於 /health 端點）
   */
  public getHealthStatus(): {
    status: "healthy" | "degraded" | "unhealthy";
    details: {
      connected: boolean;
      channelCount: number;
      maxChannels: number;
      lastHealthCheck: string | null;
    };
  } {
    const chatStatus = twurpleChatService.getStatus();

    let status: "healthy" | "degraded" | "unhealthy" = "healthy";
    if (!chatStatus.connected) {
      status = "unhealthy";
    } else if (this.channels.size > MAX_CHANNELS_PER_INSTANCE * 0.9) {
      status = "degraded";
    }

    return {
      status,
      details: {
        connected: chatStatus.connected,
        channelCount: this.channels.size,
        maxChannels: MAX_CHANNELS_PER_INSTANCE,
        lastHealthCheck: this.lastHealthCheck?.toISOString() || null,
      },
    };
  }
}

// 單例模式
export const chatListenerManager = new ChatListenerManager();
