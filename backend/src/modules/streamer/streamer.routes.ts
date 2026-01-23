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

const router = Router();

// Epic 4: 實況設定與模板管理路由
router.use("/", streamerSettingsRoutes);

// Epic 4: 收益分析路由
router.use("/revenue", revenueRoutes);

// GET /api/streamer/me/summary?range=30d - 查詢自己的統計
router.get("/me/summary", (req, res, next) => requireAuth(req, res, next), getSummaryHandler);

// GET /api/streamer/me/time-series?range=30d&granularity=day - 查詢時間序列資料
router.get(
  "/me/time-series",
  (req, res, next) => requireAuth(req, res, next),
  getTimeSeriesHandler
);

// GET /api/streamer/me/heatmap?range=30d - 查詢 Heatmap 資料
router.get("/me/heatmap", (req, res, next) => requireAuth(req, res, next), getHeatmapHandler);

// GET /api/streamer/me/subscription-trend?range=30d - 查詢訂閱趨勢資料
router.get(
  "/me/subscription-trend",
  (req, res, next) => requireAuth(req, res, next),
  getSubscriptionTrendHandler
);

// GET /api/streamer/me/game-stats - 遊戲/分類統計
router.get("/me/game-stats", (req, res, next) => requireAuth(req, res, next), getGameStatsHandler);

// GET /api/streamer/me/videos - VOD 列表
router.get("/me/videos", (req, res, next) => requireAuth(req, res, next), getVideosHandler);

// GET /api/streamer/me/clips - Clips 列表
router.get("/me/clips", (req, res, next) => requireAuth(req, res, next), getClipsHandler);

// POST /api/streamer/me/sync-subscriptions - 手動同步訂閱數據
router.post("/me/sync-subscriptions", requireAuth, syncSubscriptionsHandler);

// GET /api/streamer/:streamerId/summary?range=30d - 查詢指定 streamer 的統計（開發模式）
// ⚠️ 注意：這是開發/測試用的端點，生產環境應加上權限控制
if (process.env.NODE_ENV !== "production") {
  router.get("/:streamerId/summary", getStreamerSummaryByIdHandler);
}

// Public Routes (Viewer Dashboard Access)
router.get("/:streamerId/videos", getPublicVideosHandler);
router.get("/:streamerId/clips", getPublicClipsHandler);
router.get("/:streamerId/game-stats", getPublicGameStatsHandler);
router.get("/:streamerId/viewer-trends", getPublicViewerTrendsHandler);
router.get("/:streamerId/stream-hourly", getPublicStreamHourlyHandler);

export const streamerRoutes = router;
