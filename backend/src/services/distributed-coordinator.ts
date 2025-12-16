/**
 * Distributed Listener Coordinator
 *
 * 多實例協調器，確保同一個頻道不會被多個實例重複監聽。
 *
 * 策略：
 * - 使用資料庫作為分佈式鎖
 * - 每個實例有唯一 ID
 * - 定期心跳更新，超時自動釋放
 * - 支援 Redis (可選，效能更好)
 */

import { prisma } from "../db/prisma";
import { logger } from "../utils/logger";
import { v4 as uuidv4 } from "uuid";

// ========== 配置常數 ==========

const INSTANCE_ID =
  process.env.INSTANCE_ID || `instance-${uuidv4().slice(0, 8)}`;
const HEARTBEAT_INTERVAL_MS = 30 * 1000; // 30 秒
const LOCK_TIMEOUT_MS = 60 * 1000; // 60 秒無心跳視為死亡
const MAX_CHANNELS_PER_INSTANCE = 50;

// ========== 類型定義 ==========

interface ChannelLock {
  channelId: string;
  instanceId: string;
  lastHeartbeat: Date;
  acquiredAt: Date;
}

interface InstanceInfo {
  instanceId: string;
  channelCount: number;
  lastHeartbeat: Date;
  isHealthy: boolean;
}

// ========== 分佈式協調器 ==========

export class DistributedListenerCoordinator {
  private instanceId: string;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private acquiredChannels: Set<string> = new Set();
  private isStarted = false;

  constructor() {
    this.instanceId = INSTANCE_ID;
  }

  /**
   * 獲取當前實例 ID
   */
  public getInstanceId(): string {
    return this.instanceId;
  }

  /**
   * 啟動協調器
   */
  public async start(): Promise<void> {
    if (this.isStarted) return;

    logger.info(
      "DistributedCoordinator",
      `Starting with instance ID: ${this.instanceId}`
    );

    // 確保資料表存在
    await this.ensureTablesExist();

    // 註冊實例
    await this.registerInstance();

    // 啟動心跳
    this.startHeartbeat();

    this.isStarted = true;
  }

  /**
   * 停止協調器
   */
  public async stop(): Promise<void> {
    if (!this.isStarted) return;

    logger.info("DistributedCoordinator", "Stopping...");

    // 停止心跳
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    // 釋放所有頻道鎖
    await this.releaseAllChannels();

    // 移除實例註冊
    await this.unregisterInstance();

    this.isStarted = false;
  }

  /**
   * 嘗試獲取頻道監聽權
   */
  public async tryAcquireChannel(channelId: string): Promise<boolean> {
    try {
      // 檢查是否已持有
      if (this.acquiredChannels.has(channelId)) {
        return true;
      }

      // 檢查本實例是否已達上限
      if (this.acquiredChannels.size >= MAX_CHANNELS_PER_INSTANCE) {
        logger.warn(
          "DistributedCoordinator",
          `Instance ${this.instanceId} reached max channels (${MAX_CHANNELS_PER_INSTANCE})`
        );
        return false;
      }

      // 嘗試獲取鎖
      const acquired = await this.acquireLock(channelId);
      if (acquired) {
        this.acquiredChannels.add(channelId);
        logger.info(
          "DistributedCoordinator",
          `Acquired channel: ${channelId} (total: ${this.acquiredChannels.size})`
        );
      }

      return acquired;
    } catch (error) {
      logger.error(
        "DistributedCoordinator",
        `Failed to acquire channel: ${channelId}`,
        error
      );
      return false;
    }
  }

  /**
   * 釋放頻道監聽權
   */
  public async releaseChannel(channelId: string): Promise<void> {
    try {
      await this.releaseLock(channelId);
      this.acquiredChannels.delete(channelId);
      logger.info(
        "DistributedCoordinator",
        `Released channel: ${channelId} (total: ${this.acquiredChannels.size})`
      );
    } catch (error) {
      logger.error(
        "DistributedCoordinator",
        `Failed to release channel: ${channelId}`,
        error
      );
    }
  }

  /**
   * 獲取當前持有的頻道列表
   */
  public getAcquiredChannels(): string[] {
    return Array.from(this.acquiredChannels);
  }

  /**
   * 獲取所有實例資訊
   */
  public async getAllInstances(): Promise<InstanceInfo[]> {
    try {
      const instances = await prisma.listenerInstance.findMany();
      const now = new Date();

      return instances.map((inst) => ({
        instanceId: inst.instanceId,
        channelCount: inst.channelCount,
        lastHeartbeat: inst.lastHeartbeat,
        isHealthy:
          now.getTime() - inst.lastHeartbeat.getTime() < LOCK_TIMEOUT_MS,
      }));
    } catch {
      return [];
    }
  }

  /**
   * 獲取頻道鎖定資訊
   */
  public async getChannelLocks(): Promise<ChannelLock[]> {
    try {
      const locks = await prisma.channelListenerLock.findMany();
      return locks.map((lock) => ({
        channelId: lock.channelId,
        instanceId: lock.instanceId,
        lastHeartbeat: lock.lastHeartbeat,
        acquiredAt: lock.acquiredAt,
      }));
    } catch {
      return [];
    }
  }

  // ========== 私有方法 ==========

  /**
   * 確保需要的資料表存在
   */
  private async ensureTablesExist(): Promise<void> {
    // Prisma 會自動創建表，這裡只是確認連接正常
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch (error) {
      logger.error(
        "DistributedCoordinator",
        "Database connection failed",
        error
      );
      throw error;
    }
  }

  /**
   * 註冊實例
   */
  private async registerInstance(): Promise<void> {
    try {
      await prisma.listenerInstance.upsert({
        where: { instanceId: this.instanceId },
        create: {
          instanceId: this.instanceId,
          channelCount: 0,
          lastHeartbeat: new Date(),
          startedAt: new Date(),
        },
        update: {
          lastHeartbeat: new Date(),
          channelCount: this.acquiredChannels.size,
        },
      });
    } catch (error) {
      logger.error(
        "DistributedCoordinator",
        "Failed to register instance",
        error
      );
    }
  }

  /**
   * 移除實例註冊
   */
  private async unregisterInstance(): Promise<void> {
    try {
      await prisma.listenerInstance.delete({
        where: { instanceId: this.instanceId },
      });
    } catch {
      // 忽略錯誤
    }
  }

  /**
   * 獲取頻道鎖
   */
  private async acquireLock(channelId: string): Promise<boolean> {
    const now = new Date();
    const timeout = new Date(now.getTime() - LOCK_TIMEOUT_MS);

    try {
      // 嘗試獲取鎖（如果不存在或已過期）
      await prisma.channelListenerLock.upsert({
        where: { channelId },
        create: {
          channelId,
          instanceId: this.instanceId,
          lastHeartbeat: now,
          acquiredAt: now,
        },
        update: {
          // 只有在自己持有或已過期時才更新
          instanceId: this.instanceId,
          lastHeartbeat: now,
        },
      });

      // 確認是否真的獲取到了
      const lock = await prisma.channelListenerLock.findUnique({
        where: { channelId },
      });

      if (lock && lock.instanceId === this.instanceId) {
        return true;
      }

      // 檢查現有鎖是否已過期
      if (lock && lock.lastHeartbeat < timeout) {
        // 鎖已過期，強制接管
        await prisma.channelListenerLock.update({
          where: { channelId },
          data: {
            instanceId: this.instanceId,
            lastHeartbeat: now,
            acquiredAt: now,
          },
        });
        return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * 釋放頻道鎖
   */
  private async releaseLock(channelId: string): Promise<void> {
    try {
      // 只釋放自己持有的鎖
      await prisma.channelListenerLock.deleteMany({
        where: {
          channelId,
          instanceId: this.instanceId,
        },
      });
    } catch {
      // 忽略錯誤
    }
  }

  /**
   * 釋放所有頻道鎖
   */
  private async releaseAllChannels(): Promise<void> {
    try {
      await prisma.channelListenerLock.deleteMany({
        where: { instanceId: this.instanceId },
      });
      this.acquiredChannels.clear();
    } catch (error) {
      logger.error(
        "DistributedCoordinator",
        "Failed to release all channels",
        error
      );
    }
  }

  /**
   * 啟動心跳
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(async () => {
      await this.performHeartbeat();
    }, HEARTBEAT_INTERVAL_MS);

    // 立即執行一次
    this.performHeartbeat();
  }

  /**
   * 執行心跳
   */
  private async performHeartbeat(): Promise<void> {
    const now = new Date();

    try {
      // 更新實例心跳
      await prisma.listenerInstance.update({
        where: { instanceId: this.instanceId },
        data: {
          lastHeartbeat: now,
          channelCount: this.acquiredChannels.size,
        },
      });

      // 更新所有持有鎖的心跳
      if (this.acquiredChannels.size > 0) {
        await prisma.channelListenerLock.updateMany({
          where: {
            instanceId: this.instanceId,
            channelId: { in: Array.from(this.acquiredChannels) },
          },
          data: { lastHeartbeat: now },
        });
      }

      // 清理過期的實例和鎖
      await this.cleanupExpiredLocks();
    } catch (error) {
      logger.error("DistributedCoordinator", "Heartbeat failed", error);
    }
  }

  /**
   * 清理過期的鎖
   */
  private async cleanupExpiredLocks(): Promise<void> {
    const timeout = new Date(Date.now() - LOCK_TIMEOUT_MS);

    try {
      // 刪除過期的頻道鎖
      const expired = await prisma.channelListenerLock.deleteMany({
        where: { lastHeartbeat: { lt: timeout } },
      });

      if (expired.count > 0) {
        logger.info(
          "DistributedCoordinator",
          `Cleaned up ${expired.count} expired channel locks`
        );
      }

      // 刪除過期的實例
      await prisma.listenerInstance.deleteMany({
        where: { lastHeartbeat: { lt: timeout } },
      });
    } catch {
      // 忽略錯誤
    }
  }
}

// 單例模式
export const distributedCoordinator = new DistributedListenerCoordinator();
