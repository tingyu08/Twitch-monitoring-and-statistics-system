import { Router } from "express";
import { revenueController } from "./revenue.controller";
import { requireAuth } from "../auth/auth.middleware";

const router = Router();

// 所有路由都需要認證
router.use(requireAuth);

// GET /api/streamer/revenue/overview - 收益總覽
router.get("/overview", (req, res) => revenueController.getOverview(req, res));

// GET /api/streamer/revenue/subscriptions?days=30 - 訂閱統計趨勢
router.get("/subscriptions", (req, res) =>
  revenueController.getSubscriptionStats(req, res)
);

// GET /api/streamer/revenue/bits?days=30 - Bits 統計趨勢
router.get("/bits", (req, res) => revenueController.getBitsStats(req, res));

// GET /api/streamer/revenue/top-supporters?limit=10 - Top 贊助者
router.get("/top-supporters", (req, res) =>
  revenueController.getTopSupporters(req, res)
);

// POST /api/streamer/revenue/sync - 手動同步訂閱
router.post("/sync", (req, res) =>
  revenueController.syncSubscriptions(req, res)
);

// GET /api/streamer/revenue/export?format=csv&days=30 - 匯出報表
router.get("/export", (req, res) => revenueController.exportReport(req, res));

export default router;
