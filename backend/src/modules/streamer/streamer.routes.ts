import { Router } from "express";
import { requireAuth } from "../auth/auth.middleware";
import {
  getSummaryHandler,
  getStreamerSummaryByIdHandler,
  getTimeSeriesHandler,
  getHeatmapHandler,
  getSubscriptionTrendHandler,
  syncSubscriptionsHandler
} from "./streamer.controller";

const router = Router();

// GET /api/streamer/me/summary?range=30d - 查詢自己的統計
router.get("/me/summary", requireAuth, getSummaryHandler);

// GET /api/streamer/me/time-series?range=30d&granularity=day - 查詢時間序列資料
router.get("/me/time-series", requireAuth, getTimeSeriesHandler);

// GET /api/streamer/me/heatmap?range=30d - 查詢 Heatmap 資料
router.get("/me/heatmap", requireAuth, getHeatmapHandler);

// GET /api/streamer/me/subscription-trend?range=30d - 查詢訂閱趨勢資料
router.get("/me/subscription-trend", requireAuth, getSubscriptionTrendHandler);

// POST /api/streamer/me/sync-subscriptions - 手動同步訂閱數據
router.post("/me/sync-subscriptions", requireAuth, syncSubscriptionsHandler);

// GET /api/streamer/:streamerId/summary?range=30d - 查詢指定 streamer 的統計（開發模式）
// ⚠️ 注意：這是開發/測試用的端點，生產環境應加上權限控制
if (process.env.NODE_ENV !== 'production') {
  router.get("/:streamerId/summary", getStreamerSummaryByIdHandler);
}

export const streamerRoutes = router;