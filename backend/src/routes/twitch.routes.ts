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
 */
router.get("/channel/:login", async (req: Request, res: Response) => {
  try {
    const { login } = req.params;

    // P1 Fix: 驗證 login 參數格式
    if (!isValidTwitchLogin(login)) {
      return res.status(400).json({ error: "無效的頻道名稱格式" });
    }

    const channelInfo = await unifiedTwitchService.getChannelInfo(login);

    if (!channelInfo) {
      return res.status(404).json({ error: "頻道不存在" });
    }

    return res.json(channelInfo);
  } catch (error) {
    logger.error("Twitch API", "Failed to get channel info", error);
    return res.status(500).json({ error: "伺服器錯誤" });
  }
});

/**
 * POST /api/twitch/channels
 * 批量獲取頻道資訊
 * Body: { logins: string[] }
 */
router.post("/channels", async (req: Request, res: Response) => {
  try {
    const { logins } = req.body;

    if (!Array.isArray(logins) || logins.length === 0) {
      return res.status(400).json({ error: "請提供頻道列表" });
    }

    if (logins.length > 100) {
      return res.status(400).json({ error: "一次最多查詢 100 個頻道" });
    }

    // P1 Fix: 驗證每個 login 都是有效字串
    const validLogins = logins.filter(isValidTwitchLogin);
    if (validLogins.length !== logins.length) {
      return res.status(400).json({ error: "頻道名稱格式無效" });
    }

    const channels = await unifiedTwitchService.getChannelsInfo(validLogins);
    return res.json({ channels });
  } catch (error) {
    logger.error("Twitch API", "Failed to get channels info", error);
    return res.status(500).json({ error: "伺服器錯誤" });
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
      return res.status(400).json({ error: "無效的頻道或用戶名稱格式" });
    }

    const followInfo = await unifiedTwitchService.getUserFollowInfo(channel, user);

    return res.json(followInfo);
  } catch (error) {
    logger.error("Twitch API", "Failed to get follow info", error);
    return res.status(500).json({ error: "伺服器錯誤" });
  }
});

/**
 * GET /api/twitch/relation/:channel/:viewer
 * 獲取觀眾與頻道的完整關係資訊
 */
router.get("/relation/:channel/:viewer", async (req: Request, res: Response) => {
  try {
    const { channel, viewer } = req.params;

    // P1 Fix: 驗證參數格式
    if (!isValidTwitchLogin(channel) || !isValidTwitchLogin(viewer)) {
      return res.status(400).json({ error: "無效的頻道或用戶名稱格式" });
    }

    const relation = await unifiedTwitchService.getViewerChannelRelation(channel, viewer);

    if (!relation) {
      return res.status(404).json({ error: "無法獲取關係資訊" });
    }

    return res.json(relation);
  } catch (error) {
    logger.error("Twitch API", "Failed to get relation info", error);
    return res.status(500).json({ error: "伺服器錯誤" });
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
      return res.status(400).json({ error: "請提供頻道 ID 列表" });
    }

    if (channelIds.length > 100) {
      return res.status(400).json({ error: "一次最多查詢 100 個頻道" });
    }

    // P1 Fix: 驗證每個 channelId 都是有效的 Twitch ID
    const validIds = channelIds.filter(isValidTwitchId);
    if (validIds.length !== channelIds.length) {
      return res.status(400).json({ error: "頻道 ID 格式無效" });
    }

    const statusMap = await unifiedTwitchService.checkLiveStatus(validIds);
    const status: Record<string, boolean> = {};
    statusMap.forEach((isLive, channelId) => {
      status[channelId] = isLive;
    });

    return res.json({ status });
  } catch (error) {
    logger.error("Twitch API", "Failed to check live status", error);
    return res.status(500).json({ error: "伺服器錯誤" });
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
    return res.status(500).json({ error: "伺服器錯誤" });
  }
});

export default router;
