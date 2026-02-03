/**
 * Twitch API Routes
 *
 * 提供 Twitch 相關的 API 端點：
 * - 頻道資訊查詢
 * - 追蹤資訊查詢
 * - 直播狀態查詢
 * - 服務狀態
 */

import { Router, Request, Response } from "express";
import { unifiedTwitchService } from "../services/unified-twitch.service";
import { logger } from "../utils/logger";
import { withTimeout, isTimeoutError, API_TIMEOUT_MS } from "../utils/timeout.utils";
import {
  BadRequestError,
  NotFoundError,
  GatewayTimeoutError,
  isAppError,
  formatErrorResponse,
} from "../utils/errors";

const router = Router();

// P1 Fix: 輸入驗證工具函數
const TWITCH_LOGIN_REGEX = /^[a-zA-Z0-9_]{1,25}$/;
const TWITCH_ID_REGEX = /^[0-9]+$/;

function isValidTwitchLogin(login: unknown): login is string {
  return typeof login === "string" && TWITCH_LOGIN_REGEX.test(login);
}

function isValidTwitchId(id: unknown): id is string {
  return typeof id === "string" && TWITCH_ID_REGEX.test(id);
}

// ========== 頻道相關 ==========

/**
 * GET /api/twitch/channel/:login
 * 獲取頻道資訊
 * P1 Fix: 加入 10 秒超時保護
 */
router.get("/channel/:login", async (req: Request, res: Response) => {
  try {
    const { login } = req.params;

    // P1 Fix: 驗證 login 參數格式
    if (!isValidTwitchLogin(login)) {
      throw new BadRequestError("無效的頻道名稱格式", "INVALID_CHANNEL_NAME");
    }

    // P1 Fix: 加入超時保護
    const channelInfo = await withTimeout(
      unifiedTwitchService.getChannelInfo(login),
      API_TIMEOUT_MS.MEDIUM,
      `Channel info request timed out for ${login}`
    );

    if (!channelInfo) {
      throw new NotFoundError("頻道不存在", "CHANNEL_NOT_FOUND");
    }

    return res.json(channelInfo);
  } catch (error) {
    if (isTimeoutError(error)) {
      logger.warn("Twitch API", `Timeout getting channel info: ${req.params.login}`);
      const timeoutError = new GatewayTimeoutError("請求超時，請稍後再試");
      const { status, body } = formatErrorResponse(timeoutError);
      return res.status(status).json(body);
    }
    if (isAppError(error)) {
      const { status, body } = formatErrorResponse(error);
      return res.status(status).json(body);
    }
    logger.error("Twitch API", "Failed to get channel info", error);
    const { status, body } = formatErrorResponse(error);
    return res.status(status).json(body);
  }
});

/**
 * POST /api/twitch/channels
 * 批量獲取頻道資訊
 * Body: { logins: string[] }
 * P1 Fix: 加入 30 秒超時保護（批量操作）
 */
router.post("/channels", async (req: Request, res: Response) => {
  try {
    const { logins } = req.body;

    if (!Array.isArray(logins) || logins.length === 0) {
      throw new BadRequestError("請提供頻道列表", "MISSING_LOGINS");
    }

    if (logins.length > 100) {
      throw new BadRequestError("一次最多查詢 100 個頻道", "TOO_MANY_LOGINS");
    }

    // P1 Fix: 驗證每個 login 都是有效字串
    const validLogins = logins.filter(isValidTwitchLogin);
    if (validLogins.length !== logins.length) {
      throw new BadRequestError("頻道名稱格式無效", "INVALID_CHANNEL_NAME");
    }

    // P1 Fix: 加入超時保護（批量操作使用較長超時）
    const channels = await withTimeout(
      unifiedTwitchService.getChannelsInfo(validLogins),
      API_TIMEOUT_MS.LONG,
      `Batch channels request timed out`
    );
    return res.json({ channels });
  } catch (error) {
    if (isTimeoutError(error)) {
      logger.warn("Twitch API", "Timeout getting batch channels info");
      const timeoutError = new GatewayTimeoutError("請求超時，請稍後再試");
      const { status, body } = formatErrorResponse(timeoutError);
      return res.status(status).json(body);
    }
    if (isAppError(error)) {
      const { status, body } = formatErrorResponse(error);
      return res.status(status).json(body);
    }
    logger.error("Twitch API", "Failed to get channels info", error);
    const { status, body } = formatErrorResponse(error);
    return res.status(status).json(body);
  }
});

// ========== 追蹤相關 ==========

/**
 * GET /api/twitch/followage/:channel/:user
 * 獲取用戶追蹤頻道的資訊
 */
router.get("/followage/:channel/:user", async (req: Request, res: Response) => {
  try {
    const { channel, user } = req.params;

    // P1 Fix: 驗證參數格式
    if (!isValidTwitchLogin(channel) || !isValidTwitchLogin(user)) {
      throw new BadRequestError("無效的頻道或用戶名稱格式", "INVALID_PARAMS");
    }

    const followInfo = await unifiedTwitchService.getUserFollowInfo(channel, user);

    return res.json(followInfo);
  } catch (error) {
    if (isAppError(error)) {
      const { status, body } = formatErrorResponse(error);
      return res.status(status).json(body);
    }
    logger.error("Twitch API", "Failed to get follow info", error);
    const { status, body } = formatErrorResponse(error);
    return res.status(status).json(body);
  }
});

/**
 * GET /api/twitch/relation/:channel/:viewer
 * 獲取觀眾與頻道的完整關係資訊
 * P1 Fix: 加入 10 秒超時保護
 */
router.get("/relation/:channel/:viewer", async (req: Request, res: Response) => {
  try {
    const { channel, viewer } = req.params;

    // P1 Fix: 驗證參數格式
    if (!isValidTwitchLogin(channel) || !isValidTwitchLogin(viewer)) {
      throw new BadRequestError("無效的頻道或用戶名稱格式", "INVALID_PARAMS");
    }

    // P1 Fix: 加入超時保護
    const relation = await withTimeout(
      unifiedTwitchService.getViewerChannelRelation(channel, viewer),
      API_TIMEOUT_MS.MEDIUM,
      `Relation request timed out for ${channel}/${viewer}`
    );

    if (!relation) {
      throw new NotFoundError("無法獲取關係資訊", "RELATION_NOT_FOUND");
    }

    return res.json(relation);
  } catch (error) {
    if (isTimeoutError(error)) {
      logger.warn("Twitch API", `Timeout getting relation info: ${req.params.channel}/${req.params.viewer}`);
      const timeoutError = new GatewayTimeoutError("請求超時，請稍後再試");
      const { status, body } = formatErrorResponse(timeoutError);
      return res.status(status).json(body);
    }
    if (isAppError(error)) {
      const { status, body } = formatErrorResponse(error);
      return res.status(status).json(body);
    }
    logger.error("Twitch API", "Failed to get relation info", error);
    const { status, body } = formatErrorResponse(error);
    return res.status(status).json(body);
  }
});

// ========== 直播狀態 ==========

/**
 * POST /api/twitch/live-status
 * 批量檢查頻道直播狀態
 * Body: { channelIds: string[] }
 */
router.post("/live-status", async (req: Request, res: Response) => {
  try {
    const { channelIds } = req.body;

    if (!Array.isArray(channelIds) || channelIds.length === 0) {
      throw new BadRequestError("請提供頻道 ID 列表", "MISSING_CHANNEL_IDS");
    }

    if (channelIds.length > 100) {
      throw new BadRequestError("一次最多查詢 100 個頻道", "TOO_MANY_CHANNEL_IDS");
    }

    // P1 Fix: 驗證每個 channelId 都是有效的 Twitch ID
    const validIds = channelIds.filter(isValidTwitchId);
    if (validIds.length !== channelIds.length) {
      throw new BadRequestError("頻道 ID 格式無效", "INVALID_CHANNEL_ID");
    }

    const statusMap = await unifiedTwitchService.checkLiveStatus(validIds);
    const status: Record<string, boolean> = {};
    statusMap.forEach((isLive, channelId) => {
      status[channelId] = isLive;
    });

    return res.json({ status });
  } catch (error) {
    if (isAppError(error)) {
      const { status, body } = formatErrorResponse(error);
      return res.status(status).json(body);
    }
    logger.error("Twitch API", "Failed to check live status", error);
    const { status, body } = formatErrorResponse(error);
    return res.status(status).json(body);
  }
});

// ========== 服務狀態 ==========

/**
 * GET /api/twitch/status
 * 獲取 Twitch 服務狀態
 */
router.get("/status", async (_req: Request, res: Response) => {
  try {
    const status = unifiedTwitchService.getServicesStatus();
    return res.json(status);
  } catch (error) {
    logger.error("Twitch API", "Failed to get service status", error);
    const { status, body } = formatErrorResponse(error);
    return res.status(status).json(body);
  }
});

export default router;
