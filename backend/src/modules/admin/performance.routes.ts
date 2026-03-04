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
import { prisma } from "../../db/prisma";
import { watchTimeIncrementJob } from "../../jobs/watch-time-increment.job";
import { cacheManager } from "../../utils/cache-manager";
import { revenueSyncQueue } from "../../utils/revenue-sync-queue";
import { dataExportQueue } from "../../utils/data-export-queue";
import { getRedisCircuitBreakerStats } from "../../utils/redis-client";

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
        const alerts: string[] = [];
        if ((revenueQueue.oldestWaitingMs || 0) > 120000) {
          alerts.push("Revenue queue waiting oldest > 120s");
        }
        if ((exportQueue.oldestWaitingMs || 0) > 300000) {
          alerts.push("Export queue waiting oldest > 300s");
        }
        if ((revenueQueue.failedRatioPercent || 0) > 5) {
          alerts.push("Revenue queue failed ratio > 5%");
        }
        if ((exportQueue.failedRatioPercent || 0) > 10) {
          alerts.push("Export queue failed ratio > 10%");
        }

        if (alerts.length > 0) {
          performanceLogger.warn(`Queue alerts: ${alerts.join("; ")}`);
        }

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
            redis: {
              circuitBreaker: getRedisCircuitBreakerStats(),
            },
            alerts,
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

/**
 * GET /api/admin/performance/watch-time
 * 觀看時數排程與資料寫入診斷
 */
router.get("/watch-time", async (_req: Request, res: Response) => {
  try {
    const windows = [10, 30, 60, 180, 1440];
    const activePairsByWindow: Record<string, { messageCount: number; activePairs: number }> = {};

    for (const minutes of windows) {
      const [row] = (await prisma.$queryRawUnsafe(
        `SELECT
           COUNT(*) AS messageCount,
           COUNT(DISTINCT viewerId || '::' || channelId) AS activePairs
         FROM viewer_channel_messages
         WHERE timestamp >= datetime('now', '-${minutes} minutes')`
      )) as Array<{ messageCount: number | null; activePairs: number | null }>;

      activePairsByWindow[`${minutes}m`] = {
        messageCount: Number(row?.messageCount ?? 0),
        activePairs: Number(row?.activePairs ?? 0),
      };
    }

    const [dailySummaryRow] = (await prisma.$queryRawUnsafe(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN watchSeconds > 0 THEN 1 ELSE 0 END) AS withWatchSeconds,
         SUM(CASE WHEN source = 'chat' THEN 1 ELSE 0 END) AS chatRows,
         SUM(CASE WHEN source = 'extension' THEN 1 ELSE 0 END) AS extensionRows,
         MAX(updatedAt) AS latestDailyUpdate,
         MAX(CASE WHEN watchSeconds > 0 THEN updatedAt END) AS latestNonZeroWatchUpdate
       FROM viewer_channel_daily_stats`
    )) as Array<{
      total: number | null;
      withWatchSeconds: number | null;
      chatRows: number | null;
      extensionRows: number | null;
      latestDailyUpdate: string | null;
      latestNonZeroWatchUpdate: string | null;
    }>;

    const dailyByUpdateDay = (await prisma.$queryRawUnsafe(
      `SELECT
         date(updatedAt) AS day,
         COUNT(*) AS rows,
         SUM(CASE WHEN watchSeconds > 0 THEN 1 ELSE 0 END) AS rowsWithWatch,
         SUM(watchSeconds) AS watchSecondsSum,
         SUM(messageCount) AS messageCountSum
       FROM viewer_channel_daily_stats
       WHERE updatedAt >= datetime('now', '-14 days')
       GROUP BY date(updatedAt)
       ORDER BY day DESC`
    )) as Array<{
      day: string;
      rows: number | null;
      rowsWithWatch: number | null;
      watchSecondsSum: number | null;
      messageCountSum: number | null;
    }>;

    res.json({
      success: true,
      data: {
        job: watchTimeIncrementJob.getStatus(),
        activePairsByWindow,
        dailySummary: {
          total: Number(dailySummaryRow?.total ?? 0),
          withWatchSeconds: Number(dailySummaryRow?.withWatchSeconds ?? 0),
          chatRows: Number(dailySummaryRow?.chatRows ?? 0),
          extensionRows: Number(dailySummaryRow?.extensionRows ?? 0),
          latestDailyUpdate: dailySummaryRow?.latestDailyUpdate ?? null,
          latestNonZeroWatchUpdate: dailySummaryRow?.latestNonZeroWatchUpdate ?? null,
        },
        dailyByUpdateDay: dailyByUpdateDay.map((row) => ({
          day: row.day,
          rows: Number(row.rows ?? 0),
          rowsWithWatch: Number(row.rowsWithWatch ?? 0),
          watchSecondsSum: Number(row.watchSecondsSum ?? 0),
          messageCountSum: Number(row.messageCountSum ?? 0),
        })),
        collectedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    performanceLogger.error("Failed to get watch-time diagnostics", error);
    res.status(500).json({
      success: false,
      error: "Failed to retrieve watch-time diagnostics",
    });
  }
});

export const performanceRoutes = router;
