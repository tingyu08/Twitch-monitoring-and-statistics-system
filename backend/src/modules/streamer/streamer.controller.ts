import type { Request, Response } from "express";
import type { AuthRequest } from "../auth/auth.middleware";
import {
  getStreamerSummary,
  getStreamerTimeSeries,
  getStreamerHeatmap,
} from "./streamer.service";
import {
  getSubscriptionTrend,
  syncSubscriptionSnapshot,
} from "./subscription-sync.service";
import { streamerLogger } from "../../utils/logger";

export async function getSummaryHandler(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const streamerId = req.user?.streamerId;

    if (!streamerId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const range = (req.query.range as string) || "30d";

    // 驗證 range 參數
    if (!["7d", "30d", "90d"].includes(range)) {
      res
        .status(400)
        .json({ error: "Invalid range parameter. Use 7d, 30d, or 90d." });
      return;
    }

    const summary = await getStreamerSummary(streamerId, range);
    res.json(summary);
  } catch (error) {
    streamerLogger.error("Get Summary Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
}

/**
 * 開發模式專用：透過 streamerId 查詢任意 streamer 的統計
 * GET /api/streamer/:streamerId/summary?range=30d
 * ⚠️ 僅限開發環境使用，生產環境不會註冊此路由
 */
export async function getStreamerSummaryByIdHandler(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { streamerId } = req.params;
    const range = (req.query.range as string) || "30d";

    if (!streamerId) {
      res.status(400).json({ error: "streamerId is required" });
      return;
    }

    if (!["7d", "30d", "90d"].includes(range)) {
      res
        .status(400)
        .json({ error: "Invalid range parameter. Use 7d, 30d, or 90d." });
      return;
    }

    const summary = await getStreamerSummary(streamerId, range);
    res.json(summary);
  } catch (error) {
    streamerLogger.error("Get Streamer Summary By ID Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
}

/**
 * 取得時間序列資料（每日或每週開台統計）
 * GET /api/streamer/me/time-series?range=30d&granularity=day
 */
export async function getTimeSeriesHandler(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const streamerId = req.user?.streamerId;

    if (!streamerId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const range = (req.query.range as string) || "30d";
    const granularity = (req.query.granularity as string) || "day";

    // 驗證參數
    if (!["7d", "30d", "90d"].includes(range)) {
      res
        .status(400)
        .json({ error: "Invalid range parameter. Use 7d, 30d, or 90d." });
      return;
    }

    if (!["day", "week"].includes(granularity)) {
      res
        .status(400)
        .json({ error: "Invalid granularity parameter. Use day or week." });
      return;
    }

    const timeSeries = await getStreamerTimeSeries(
      streamerId,
      range,
      granularity as "day" | "week"
    );
    res.json(timeSeries);
  } catch (error) {
    streamerLogger.error("Get Time Series Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
}

/**
 * 取得 Heatmap 資料（一週 × 24 小時的開台分布）
 * GET /api/streamer/me/heatmap?range=30d
 */
export async function getHeatmapHandler(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const streamerId = req.user?.streamerId;

    if (!streamerId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const range = (req.query.range as string) || "30d";

    // 驗證參數
    if (!["7d", "30d", "90d"].includes(range)) {
      res
        .status(400)
        .json({ error: "Invalid range parameter. Use 7d, 30d, or 90d." });
      return;
    }

    const heatmap = await getStreamerHeatmap(streamerId, range);
    res.json(heatmap);
  } catch (error) {
    streamerLogger.error("Get Heatmap Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
}

/**
 * 取得訂閱趨勢資料
 * GET /api/streamer/me/subscription-trend?range=30d
 */
export async function getSubscriptionTrendHandler(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const streamerId = req.user?.streamerId;

    if (!streamerId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const range = (req.query.range as string) || "30d";

    // 驗證參數
    if (!["7d", "30d", "90d"].includes(range)) {
      res
        .status(400)
        .json({ error: "Invalid range parameter. Use 7d, 30d, or 90d." });
      return;
    }

    const trendData = await getSubscriptionTrend(streamerId, range);
    res.json(trendData);
  } catch (error) {
    streamerLogger.error("Get Subscription Trend Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
}

/**
 * 手動同步訂閱數據
 * POST /api/streamer/me/sync-subscriptions
 */
export async function syncSubscriptionsHandler(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const streamerId = req.user?.streamerId;

    if (!streamerId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    await syncSubscriptionSnapshot(streamerId);
    res.json({ message: "Subscription data synced successfully" });
  } catch (error) {
    streamerLogger.error("Sync Subscriptions Error:", error);

    // 檢查是否是特定的錯誤類型
    if (error instanceof Error) {
      if (error.message.includes("No channel found")) {
        res.status(404).json({ error: "Channel not found" });
        return;
      }
      if (error.message.includes("No Twitch token found")) {
        res
          .status(401)
          .json({ error: "Twitch token not found. Please re-authenticate." });
        return;
      }
      if (
        error.message.includes("Unauthorized") ||
        error.message.includes("Forbidden")
      ) {
        res
          .status(403)
          .json({
            error:
              "Unable to access subscription data. Please check permissions.",
          });
        return;
      }
    }

    res.status(500).json({ error: "Failed to sync subscription data" });
  }
}
