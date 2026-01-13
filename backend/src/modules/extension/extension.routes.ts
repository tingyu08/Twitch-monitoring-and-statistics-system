/**
 * Extension Routes
 * 瀏覽器擴充功能 API 路由
 */

import { Router } from "express";
import { postHeartbeatHandler } from "./extension.controller";
import { authMiddleware } from "../auth/auth.middleware";

const router = Router();

// POST /api/extension/heartbeat - 需要認證
router.post("/heartbeat", authMiddleware, postHeartbeatHandler);

export default router;
