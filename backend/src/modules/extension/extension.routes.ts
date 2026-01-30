/**
 * Extension Routes
 * 瀏覽器擴充功能 API 路由
 *
 * P0 Security: Added dedicated JWT authentication
 */

import { Router } from "express";
import { postHeartbeatHandler, getExtensionTokenHandler } from "./extension.controller";
import { extensionAuthMiddleware } from "./extension.middleware";
import { validateRequest } from "../../middlewares/validate.middleware";
import * as schemas from "./extension.schema";

const router = Router();

// POST /api/extension/token => /api/sync/auth-token
// Generate extension JWT token (requires auth cookie from normal login)
router.post("/auth-token", getExtensionTokenHandler);

// POST /api/extension/heartbeat
// P0 Security: Now uses JWT authentication via middleware
router.post(
  "/heartbeat",
  extensionAuthMiddleware,
  validateRequest(schemas.heartbeatSchema),
  postHeartbeatHandler
);

export default router;
