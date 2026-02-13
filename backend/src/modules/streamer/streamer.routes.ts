import { Router } from "express";
import { requireAuth } from "../auth/auth.middleware";
import {
  getSummaryHandler,
  getStreamerSummaryByIdHandler,
  getTimeSeriesHandler,
  getHeatmapHandler,
  getSubscriptionTrendHandler,
  syncSubscriptionsHandler,
} from "./streamer.controller";
import {
  getGameStatsHandler,
  getVideosHandler,
  getClipsHandler,
  getPublicVideosHandler,
  getPublicClipsHandler,
  getPublicGameStatsHandler,
  getPublicViewerTrendsHandler,
  getPublicStreamHourlyHandler,
} from "./streamer-stats.controller";
import streamerSettingsRoutes from "./streamer-settings.routes";
import revenueRoutes from "./revenue.routes";
import {
  staticDataCache,
  dynamicCache,
  privateDataCache,
  privateStaticCache,
} from "../../middlewares/cache-control.middleware";

const router = Router();

// Epic 4: 實況設定與模板管理路由
router.use("/", streamerSettingsRoutes);

// Epic 4: 收益分析路由
router.use("/revenue", revenueRoutes);

// GET /api/streamer/me/summary?range=30d - 查詢自己的統計
// P1 Fix: 加入 30 秒私有快取，減少重複查詢
router.get(
  "/me/summary",
  requireAuth(),
  privateDataCache,
  getSummaryHandler
);

// GET /api/streamer/me/time-series?range=30d&granularity=day - 查詢時間序列資料
// P1 Fix: 加入 30 秒私有快取
router.get(
  "/me/time-series",
  requireAuth(),
  privateDataCache,
  getTimeSeriesHandler
);

// GET /api/streamer/me/heatmap?range=30d - 查詢 Heatmap 資料
// P1 Fix: 加入 2 分鐘私有快取（heatmap 計算較為密集，資料變化較慢）
router.get(
  "/me/heatmap",
  requireAuth(),
  privateStaticCache,
  getHeatmapHandler
);

// GET /api/streamer/me/subscription-trend?range=30d - 查詢訂閱趨勢資料
router.get(
  "/me/subscription-trend",
  requireAuth(),
  getSubscriptionTrendHandler
);

// GET /api/streamer/me/game-stats - 遊戲/分類統計
router.get("/me/game-stats", requireAuth(), getGameStatsHandler);

// GET /api/streamer/me/videos - VOD 列表
router.get("/me/videos", requireAuth(), getVideosHandler);

// GET /api/streamer/me/clips - Clips 列表
router.get("/me/clips", requireAuth(), getClipsHandler);

// POST /api/streamer/me/sync-subscriptions - 手動同步訂閱數據
router.post("/me/sync-subscriptions", requireAuth(), syncSubscriptionsHandler);

// GET /api/streamer/:streamerId/summary?range=30d - 查詢指定 streamer 的統計（開發模式）
// ⚠️ 注意：這是開發/測試用的端點，生產環境應加上權限控制
if (process.env.NODE_ENV !== "production") {
  router.get("/:streamerId/summary", getStreamerSummaryByIdHandler);
}

// Public Routes (Viewer Dashboard Access)
// P2 優化：靜態資料使用長時間快取（5 分鐘）
router.get("/:streamerId/videos", staticDataCache, getPublicVideosHandler);
router.get("/:streamerId/clips", staticDataCache, getPublicClipsHandler);
router.get("/:streamerId/game-stats", staticDataCache, getPublicGameStatsHandler);
router.get("/:streamerId/viewer-trends", staticDataCache, getPublicViewerTrendsHandler);
router.get("/:streamerId/stream-hourly", dynamicCache, getPublicStreamHourlyHandler); // 小時統計較動態，使用 10 秒快取

export const streamerRoutes = router;
