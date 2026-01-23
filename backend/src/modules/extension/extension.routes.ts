/**
 * Extension Routes
 * 瀏覽器擴充功能 API 路由
 */

import { Router } from "express";
import { postHeartbeatHandler } from "./extension.controller";
import { validateRequest } from "../../middlewares/validate.middleware";
import * as schemas from "./extension.schema";

const router = Router();

// POST /api/extension/heartbeat
// 認證在 controller 中透過 Authorization header 處理
router.post("/heartbeat", validateRequest(schemas.heartbeatSchema), postHeartbeatHandler);

export default router;
