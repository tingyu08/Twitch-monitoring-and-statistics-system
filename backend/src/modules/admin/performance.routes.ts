/**
 * API Performance Monitoring Routes
 *
 * 提供效能統計端點：
 * - GET /api/admin/performance/stats - 取得效能統計
 * - GET /api/admin/performance/slow - 取得慢速請求列表
 * - POST /api/admin/performance/reset - 重置效能指標
 */

import { Router, Request, Response } from "express";
import {
  performanceMonitor,
  performanceLogger,
} from "../../utils/performance-monitor";

const router = Router();

/**
 * GET /api/admin/performance/stats
 * 取得 API 效能統計
 */
router.get("/stats", (req: Request, res: Response) => {
  try {
    const stats = performanceMonitor.getStats();
    performanceLogger.info(
      `Performance stats requested: ${stats.totalRequests} total requests`
    );
    res.json({
      success: true,
      data: {
        ...stats,
        slowThreshold: 200, // ms
        collectedAt: new Date().toISOString(),
      },
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
router.get("/slow", (req: Request, res: Response) => {
  try {
    const slowRequests = performanceMonitor.getSlowRequests();
    performanceLogger.info(
      `Slow requests requested: ${slowRequests.length} slow requests found`
    );
    res.json({
      success: true,
      data: {
        count: slowRequests.length,
        threshold: 200, // ms
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
 * POST /api/admin/performance/reset
 * 重置效能指標 (僅限開發環境)
 */
router.post("/reset", (req: Request, res: Response) => {
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
router.get("/health", (req: Request, res: Response) => {
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
