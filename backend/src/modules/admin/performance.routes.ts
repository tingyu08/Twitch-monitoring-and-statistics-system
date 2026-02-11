/**
 * API Performance Monitoring Routes
 *
 * 提供以下功能：
 * - GET /api/admin/performance/stats - 取得效能統計
 * - GET /api/admin/performance/slow - 取得慢速請求
 * - POST /api/admin/performance/reset - 重置效能指標
 */

import { Router, Request, Response } from "express";
import {
  performanceMonitor,
  performanceLogger,
  API_SLOW_THRESHOLD_MS,
} from "../../utils/performance-monitor";
import { cacheManager } from "../../utils/cache-manager";
import { revenueSyncQueue } from "../../utils/revenue-sync-queue";
import { dataExportQueue } from "../../utils/data-export-queue";

const router = Router();

/**
 * GET /api/admin/performance/stats
 * 取得 API 效能統計（含快取統計）
 */
router.get("/stats", (_req: Request, res: Response) => {
  try {
    const stats = performanceMonitor.getStats();
    const cacheStats = cacheManager.getStats();
    const memUsage = process.memoryUsage();

    Promise.all([revenueSyncQueue.getStatus(), dataExportQueue.getStatus()])
      .then(([revenueQueue, exportQueue]) => {
        performanceLogger.info(`Performance stats requested: ${stats.totalRequests} total requests`);
        res.json({
          success: true,
          data: {
            api: {
              ...stats,
              slowThreshold: API_SLOW_THRESHOLD_MS,
            },
            cache: cacheStats,
            memory: {
              heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
              heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
              rss: Math.round(memUsage.rss / 1024 / 1024),
              external: Math.round(memUsage.external / 1024 / 1024),
              unit: "MB",
            },
            queues: {
              revenueSync: revenueQueue,
              dataExport: exportQueue,
            },
            system: {
              uptime: Math.floor(process.uptime()),
              nodeVersion: process.version,
              platform: process.platform,
            },
            collectedAt: new Date().toISOString(),
          },
        });
      })
      .catch((error) => {
        performanceLogger.error("Failed to get queue stats", error);
        res.status(500).json({
          success: false,
          error: "Failed to retrieve queue statistics",
        });
      });
  } catch (error) {
    performanceLogger.error("Failed to get performance stats", error);
    res.status(500).json({
      success: false,
      error: "Failed to retrieve performance statistics",
    });
  }
});

/**
 * GET /api/admin/performance/slow
 * 取得慢速請求列表
 */
router.get("/slow", (_req: Request, res: Response) => {
  try {
    const slowRequests = performanceMonitor.getSlowRequests();
    performanceLogger.info(`Slow requests requested: ${slowRequests.length} slow requests found`);
    res.json({
      success: true,
      data: {
        count: slowRequests.length,
        threshold: API_SLOW_THRESHOLD_MS,
        requests: slowRequests.slice(-50), // 最近 50 個慢速請求
      },
    });
  } catch (error) {
    performanceLogger.error("Failed to get slow requests", error);
    res.status(500).json({
      success: false,
      error: "Failed to retrieve slow requests",
    });
  }
});

/**
 * GET /api/admin/performance/queues
 * 取得佇列狀態
 */
router.get("/queues", async (_req: Request, res: Response) => {
  try {
    const [revenueQueue, exportQueue] = await Promise.all([
      revenueSyncQueue.getStatus(),
      dataExportQueue.getStatus(),
    ]);

    res.json({
      success: true,
      data: {
        revenueSync: revenueQueue,
        dataExport: exportQueue,
        collectedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    performanceLogger.error("Failed to get queue status", error);
    res.status(500).json({
      success: false,
      error: "Failed to retrieve queue status",
    });
  }
});

/**
 * GET /api/admin/performance/queues/failed
 * 取得近期失敗佇列任務
 */
router.get("/queues/failed", async (req: Request, res: Response) => {
  try {
    const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 20));
    const [revenue, exportJobs] = await Promise.all([
      revenueSyncQueue.getDiagnostics(limit),
      dataExportQueue.getDiagnostics(limit),
    ]);

    res.json({
      success: true,
      data: {
        revenueSync: revenue,
        dataExport: exportJobs,
        collectedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    performanceLogger.error("Failed to get failed queue jobs", error);
    res.status(500).json({
      success: false,
      error: "Failed to retrieve failed queue jobs",
    });
  }
});

/**
 * POST /api/admin/performance/reset
 * 重置效能指標 (僅限開發環境)
 */
router.post("/reset", (_req: Request, res: Response) => {
  if (process.env.NODE_ENV === "production") {
    res.status(403).json({
      success: false,
      error: "Reset is not allowed in production environment",
    });
    return;
  }

  try {
    performanceMonitor.reset();
    performanceLogger.info("Performance metrics reset");
    res.json({
      success: true,
      message: "Performance metrics have been reset",
    });
  } catch (error) {
    performanceLogger.error("Failed to reset performance metrics", error);
    res.status(500).json({
      success: false,
      error: "Failed to reset performance metrics",
    });
  }
});

/**
 * GET /api/admin/performance/health
 * 效能健康檢查
 */
router.get("/health", (_req: Request, res: Response) => {
  try {
    const stats = performanceMonitor.getStats();
    const isHealthy = stats.averageResponseTime < 500 && stats.p95 < 1000;

    res.status(isHealthy ? 200 : 503).json({
      success: true,
      data: {
        status: isHealthy ? "healthy" : "degraded",
        metrics: {
          averageResponseTime: stats.averageResponseTime,
          p95: stats.p95,
          slowRequestsRatio:
            stats.totalRequests > 0
              ? Math.round((stats.slowRequests / stats.totalRequests) * 100)
              : 0,
        },
        thresholds: {
          averageResponseTime: 500,
          p95: 1000,
        },
        checkedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    performanceLogger.error("Health check failed", error);
    res.status(500).json({
      success: false,
      error: "Health check failed",
    });
  }
});

export const performanceRoutes = router;
