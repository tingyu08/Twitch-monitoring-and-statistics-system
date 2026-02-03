/**
 * 效能監控 API 路由
 * 提供效能指標和記憶體使用情況
 * 僅在開發環境或有適當權限時啟用
 */

import { Router } from "express";
import { performanceMonitor } from "../utils/performance-monitor";
import { cacheManager } from "../utils/cache-manager";

const router = Router();

/**
 * GET /api/monitoring/performance
 * 取得效能統計
 */
router.get("/performance", (_req, res) => {
  const stats = performanceMonitor.getStats();
  res.json(stats);
});

/**
 * GET /api/monitoring/cache
 * 取得快取統計
 */
router.get("/cache", (_req, res) => {
  const stats = cacheManager.getStats();
  res.json(stats);
});

/**
 * GET /api/monitoring/memory
 * 取得詳細記憶體資訊
 */
router.get("/memory", (_req, res) => {
  const memorySnapshot = performanceMonitor.getMemorySnapshot();
  const memoryUsage = process.memoryUsage();

  res.json({
    ...memorySnapshot,
    detailed: {
      heapUsed: memoryUsage.heapUsed,
      heapTotal: memoryUsage.heapTotal,
      external: memoryUsage.external,
      arrayBuffers: memoryUsage.arrayBuffers,
      rss: memoryUsage.rss,
    },
    limits: {
      totalRAM: 512, // MB (0.5GB 環境)
      heapLimit: memoryUsage.heapTotal,
      warningThreshold: 350, // MB
    },
    usagePercent: {
      rss: ((memoryUsage.rss / 1024 / 1024 / 512) * 100).toFixed(1),
      heap: ((memoryUsage.heapUsed / memoryUsage.heapTotal) * 100).toFixed(1),
    },
  });
});

/**
 * GET /api/monitoring/slow-requests
 * 取得慢速請求列表
 */
router.get("/slow-requests", (_req, res) => {
  const slowRequests = performanceMonitor.getSlowRequests();
  res.json({
    count: slowRequests.length,
    requests: slowRequests.slice(-20), // 只回傳最近 20 個
  });
});

/**
 * GET /api/monitoring/health
 * 健康檢查端點（簡化版）
 */
router.get("/health", (_req, res) => {
  const memUsage = process.memoryUsage();
  const rssMB = memUsage.rss / 1024 / 1024;
  const cacheStats = cacheManager.getStats();

  const health = {
    status: rssMB < 350 ? "healthy" : rssMB < 400 ? "warning" : "critical",
    uptime: process.uptime(),
    memory: {
      rss: Math.round(rssMB),
      heap: Math.round(memUsage.heapUsed / 1024 / 1024),
      limit: 512,
    },
    cache: {
      items: cacheStats.itemCount,
      memoryMB: Math.round(cacheStats.memoryUsage / 1024 / 1024),
      hitRate: cacheStats.hitRate || 0,
    },
    timestamp: new Date().toISOString(),
  };

  res.json(health);
});

/**
 * POST /api/monitoring/reset
 * 重置效能統計（僅開發環境）
 */
router.post("/reset", (_req, res) => {
  if (process.env.NODE_ENV === "production") {
    return res.status(403).json({ error: "Not allowed in production" });
  }

  performanceMonitor.reset();
  cacheManager.resetStats();

  res.json({ message: "Stats reset successfully" });
});

export default router;
