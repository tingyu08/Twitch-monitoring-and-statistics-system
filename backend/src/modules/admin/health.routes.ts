/**
 * Health Check Routes
 *
 * 提供系統健康狀態檢查端點
 */

import { Router, Request, Response } from "express";
import { chatListenerManager } from "../../services/chat-listener-manager";
import { twurpleChatService } from "../../services/twitch-chat.service";
import { prisma } from "../../db/prisma";
import { cacheManager } from "../../utils/cache-manager";

const healthRoutes = Router();

// 快取最後一次成功的資料庫檢查時間
let lastDbCheckTime = 0;
let lastDbCheckSuccess = false;
const DB_CHECK_CACHE_MS = 30 * 1000; // 30 秒快取

/**
 * 超輕量級 Ping 端點（給 UptimeRobot 使用）
 * GET /api/health/ping
 *
 * 這個端點不做任何資料庫查詢，只回傳基本狀態
 * 用於 Render Free Tier 的冷啟動監控
 */
healthRoutes.get("/ping", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
  });
});

/**
 * 基本健康檢查（含快取優化）
 * GET /api/health
 */
healthRoutes.get("/", async (_req: Request, res: Response) => {
  try {
    const now = Date.now();

    // 如果快取還有效，使用快取結果
    if (now - lastDbCheckTime < DB_CHECK_CACHE_MS && lastDbCheckSuccess) {
      return res.json({
        status: "healthy",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        cached: true,
      });
    }

    // 檢查資料庫連線（設定超時）
    const dbCheckPromise = prisma.$queryRaw`SELECT 1`;
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("DB check timeout")), 5000)
    );

    await Promise.race([dbCheckPromise, timeoutPromise]);

    // 更新快取
    lastDbCheckTime = now;
    lastDbCheckSuccess = true;

    res.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      cached: false,
    });
  } catch (error) {
    lastDbCheckSuccess = false;

    res.status(503).json({
      status: "unhealthy",
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : "Database connection failed",
    });
  }
});

/**
 * 詳細健康檢查
 * GET /api/health/detailed
 */
healthRoutes.get("/detailed", async (_req: Request, res: Response) => {
  try {
    // 1. 資料庫檢查
    let dbStatus = "healthy";
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      dbStatus = "unhealthy";
    }

    // 2. Twurple Chat 狀態
    const chatStatus = twurpleChatService.getStatus();

    // 3. Listener Manager 狀態
    const listenerHealth = chatListenerManager.getHealthStatus();
    const listenerStats = chatListenerManager.getStats();

    // 4. 系統資訊
    const memUsage = process.memoryUsage();

    // 決定整體狀態
    let overallStatus: "healthy" | "degraded" | "unhealthy" = "healthy";
    if (dbStatus === "unhealthy" || listenerHealth.status === "unhealthy") {
      overallStatus = "unhealthy";
    } else if (listenerHealth.status === "degraded") {
      overallStatus = "degraded";
    }

    // 5. 快取統計
    const cacheStats = cacheManager.getStats();

    // 記憶體警告檢查（Render Free Tier: 512MB）
    const heapUsedMB = memUsage.heapUsed / 1024 / 1024;
    const memoryWarning = heapUsedMB > 400 ? "high" : heapUsedMB > 300 ? "medium" : "normal";

    res.json({
      status: overallStatus,
      timestamp: new Date().toISOString(),
      components: {
        database: {
          status: dbStatus,
        },
        twitchChat: {
          status: chatStatus.connected ? "healthy" : "unhealthy",
          connected: chatStatus.connected,
          channelCount: chatStatus.channelCount,
        },
        listenerManager: {
          status: listenerHealth.status,
          ...listenerStats,
        },
        cache: {
          status: "healthy",
          ...cacheStats,
        },
      },
      system: {
        uptime: process.uptime(),
        memory: {
          heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + " MB",
          heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + " MB",
          rss: Math.round(memUsage.rss / 1024 / 1024) + " MB",
          warning: memoryWarning,
        },
        nodeVersion: process.version,
        platform: process.platform,
        env: process.env.NODE_ENV || "development",
      },
    });
  } catch (err) {
    res.status(500).json({
      status: "error",
      timestamp: new Date().toISOString(),
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }
});

/**
 * 監聽器狀態
 * GET /api/health/listeners
 */
healthRoutes.get("/listeners", (_req: Request, res: Response) => {
  const health = chatListenerManager.getHealthStatus();
  const stats = chatListenerManager.getStats();
  const channels = chatListenerManager.getChannels();

  res.json({
    ...health,
    stats,
    channels: channels.map((ch) => ({
      name: ch.channelName,
      isLive: ch.isLive,
      priority: ch.priority,
      lastActivity: ch.lastActivity,
    })),
  });
});

/**
 * 分佈式協調器狀態
 * GET /api/health/distributed
 */
healthRoutes.get("/distributed", async (_req: Request, res: Response) => {
  const { distributedCoordinator } = await import("../../services/distributed-coordinator");

  const instances = await distributedCoordinator.getAllInstances();
  const locks = await distributedCoordinator.getChannelLocks();
  const currentInstanceId = distributedCoordinator.getInstanceId();
  const acquiredChannels = distributedCoordinator.getAcquiredChannels();

  res.json({
    enabled: process.env.ENABLE_DISTRIBUTED_MODE === "true",
    currentInstance: {
      id: currentInstanceId,
      acquiredChannels: acquiredChannels.length,
      channels: acquiredChannels,
    },
    allInstances: instances,
    channelLocks: locks.map((lock) => ({
      channelId: lock.channelId,
      instanceId: lock.instanceId,
      acquiredAt: lock.acquiredAt,
      lastHeartbeat: lock.lastHeartbeat,
    })),
  });
});

export { healthRoutes };
