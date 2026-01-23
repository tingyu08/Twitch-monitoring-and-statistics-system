/**
 * Token Management Routes
 *
 * 管理員端點用於：
 * - 查看 Token 狀態統計
 * - 手動觸發 Token 驗證
 * - 標記特定 Token 狀態
 */

import { Router, Request, Response } from "express";
import {
  tokenValidationService,
  TokenStatus,
  type TokenStatusType,
} from "../../services/token-validation.service";
import {
  validateTokensJob,
  getLastRunResult,
  getTokenStatusStats,
  validateSingleToken,
} from "../../jobs/validate-tokens.job";
import { getTokenManagementStatus } from "../../services/token-management.init";
import { logger } from "../../utils/logger";
import { validateRequest } from "../../middlewares/validate.middleware";
import * as schemas from "./token-management.schema";

const router = Router();

/**
 * GET /api/admin/tokens/stats
 * 獲取 Token 狀態統計
 */
router.get("/stats", async (_req: Request, res: Response) => {
  try {
    const stats = await getTokenStatusStats();
    const managementStatus = await getTokenManagementStatus();

    res.json({
      success: true,
      data: {
        tokenStats: stats,
        activeProviders: managementStatus.authProviderCount,
        activeUserIds: managementStatus.activeUserIds,
      },
    });
  } catch (error) {
    logger.error("Token Admin", "Failed to get token stats", error);
    res.status(500).json({
      success: false,
      error: "Failed to get token stats",
    });
  }
});

/**
 * POST /api/admin/tokens/validate-all
 * 手動觸發驗證所有 Token
 */
router.post("/validate-all", async (_req: Request, res: Response) => {
  try {
    logger.info("Token Admin", "Manual token validation triggered");

    // 執行驗證任務
    const result = await validateTokensJob();

    res.json({
      success: result.success,
      data: {
        duration: `${result.durationMs}ms`,
        stats: result.stats,
        errors: result.errors.slice(0, 10), // 只返回前 10 個錯誤
        hasMoreErrors: result.errors.length > 10,
      },
    });
  } catch (error) {
    logger.error("Token Admin", "Manual validation failed", error);
    res.status(500).json({
      success: false,
      error: "Failed to run token validation",
    });
  }
});

/**
 * POST /api/admin/tokens/:tokenId/validate
 * 驗證單個 Token
 */
router.post("/:tokenId/validate", async (req: Request, res: Response) => {
  try {
    const { tokenId } = req.params;

    const result = await validateSingleToken(tokenId);

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    logger.error("Token Admin", `Failed to validate token ${req.params.tokenId}`, error);
    res.status(500).json({
      success: false,
      error: "Failed to validate token",
    });
  }
});

/**
 * PATCH /api/admin/tokens/:tokenId/status
 * 手動更新 Token 狀態
 */
router.patch("/:tokenId/status", validateRequest(schemas.updateTokenStatusSchema), async (req: Request, res: Response) => {
  try {
    const { tokenId } = req.params;
    const { status, reason } = req.body;

    // 驗證狀態值
    const validStatuses: TokenStatusType[] = [
      TokenStatus.ACTIVE,
      TokenStatus.EXPIRED,
      TokenStatus.REVOKED,
      TokenStatus.INVALID,
    ];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: `Invalid status. Must be one of: ${validStatuses.join(", ")}`,
      });
    }

    await tokenValidationService.markTokenStatus(tokenId, status, reason);

    res.json({
      success: true,
      message: `Token ${tokenId} status updated to ${status}`,
    });
  } catch (error) {
    logger.error("Token Admin", `Failed to update token status`, error);
    res.status(500).json({
      success: false,
      error: "Failed to update token status",
    });
  }
});

/**
 * GET /api/admin/tokens/last-validation
 * 獲取上次驗證任務的結果
 */
router.get("/last-validation", async (_req: Request, res: Response) => {
  const result = getLastRunResult();

  if (!result) {
    return res.json({
      success: true,
      data: null,
      message: "No validation job has been run yet",
    });
  }

  res.json({
    success: true,
    data: {
      success: result.success,
      startTime: result.startTime,
      endTime: result.endTime,
      duration: `${result.durationMs}ms`,
      stats: result.stats,
      errorCount: result.errors.length,
    },
  });
});

/**
 * GET /api/admin/tokens/needs-refresh
 * 獲取需要刷新的 Token 列表
 */
router.get("/needs-refresh", async (_req: Request, res: Response) => {
  try {
    const tokens = await tokenValidationService.getTokensNeedingRefresh();

    res.json({
      success: true,
      data: {
        count: tokens.length,
        tokens: tokens.map((t) => ({
          id: t.id,
          ownerType: t.ownerType,
          streamerId: t.streamerId,
          viewerId: t.viewerId,
        })),
      },
    });
  } catch (error) {
    logger.error("Token Admin", "Failed to get tokens needing refresh", error);
    res.status(500).json({
      success: false,
      error: "Failed to get tokens needing refresh",
    });
  }
});

export default router;
