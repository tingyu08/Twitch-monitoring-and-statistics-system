import { Router } from "express";
import rateLimit from "express-rate-limit";
import { revenueController } from "./revenue.controller";
import { requireAuth } from "../auth/auth.middleware";
import { requireStreamer } from "./streamer.middleware";
import { RATE_LIMITS } from "../../config/revenue.config";
import type { AuthRequest } from "../auth/auth.middleware";

const router = Router();

// 速率限制器：sync 端點
const syncLimiter = rateLimit({
  windowMs: RATE_LIMITS.SYNC.windowMs,
  max: RATE_LIMITS.SYNC.max,
  keyGenerator: (req) => (req as AuthRequest).user?.streamerId || req.ip || "unknown",
  message: { error: "Too many sync requests, please wait 5 minutes" },
  standardHeaders: true,
  legacyHeaders: false,
});

// 速率限制器：export 端點
const exportLimiter = rateLimit({
  windowMs: RATE_LIMITS.EXPORT.windowMs,
  max: RATE_LIMITS.EXPORT.max,
  keyGenerator: (req) => (req as AuthRequest).user?.streamerId || req.ip || "unknown",
  message: { error: "Too many export requests, please wait 15 minutes" },
  standardHeaders: true,
  legacyHeaders: false,
});

// 所有路由都需要認證，且必須是 Streamer
router.use((req, res, next) => requireAuth(req, res, next));
router.use(requireStreamer);

// GET /api/streamer/revenue/overview - 收益總覽
router.get("/overview", (req, res) => revenueController.getOverview(req, res));

// GET /api/streamer/revenue/subscriptions?days=30 - 訂閱統計趨勢
router.get("/subscriptions", (req, res) => revenueController.getSubscriptionStats(req, res));

// GET /api/streamer/revenue/bits?days=30 - Bits 統計趨勢
router.get("/bits", (req, res) => revenueController.getBitsStats(req, res));

// GET /api/streamer/revenue/top-supporters?limit=10 - Top 贊助者
router.get("/top-supporters", (req, res) => revenueController.getTopSupporters(req, res));

// POST /api/streamer/revenue/sync - 手動同步訂閱
router.post("/sync", syncLimiter, (req, res) => revenueController.syncSubscriptions(req, res));

// GET /api/streamer/revenue/export?format=csv&days=30 - 匯出報表
router.get("/export", exportLimiter, (req, res) => revenueController.exportReport(req, res));

export default router;
