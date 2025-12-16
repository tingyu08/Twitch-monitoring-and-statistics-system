/**
 * Health Check Routes
 *
 * 提供系統健康狀態檢查端點
 */

import { Router, Request, Response } from "express";
import { chatListenerManager } from "../../services/chat-listener-manager";
import { twurpleChatService } from "../../services/twitch-chat.service";
import { prisma } from "../../db/prisma";

const healthRoutes = Router();

/**
 * 基本健康檢查
 * GET /api/health
 */
healthRoutes.get("/", async (_req: Request, res: Response) => {
  try {
    // 檢查資料庫連線
    await prisma.$queryRaw`SELECT 1`;

    res.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  } catch {
    res.status(503).json({
      status: "unhealthy",
      timestamp: new Date().toISOString(),
      error: "Database connection failed",
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
      },
      system: {
        uptime: process.uptime(),
        memory: {
          heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + " MB",
          heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + " MB",
          rss: Math.round(memUsage.rss / 1024 / 1024) + " MB",
        },
        nodeVersion: process.version,
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
  const { distributedCoordinator } = await import(
    "../../services/distributed-coordinator"
  );

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
