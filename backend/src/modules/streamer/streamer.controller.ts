import type { Request, Response } from "express";
import type { AuthRequest } from "../auth/auth.middleware";
import { getStreamerSummary, getStreamerTimeSeries, getStreamerHeatmap } from "./streamer.service";

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
      res.status(400).json({ error: "Invalid range parameter. Use 7d, 30d, or 90d." });
      return;
    }

    const summary = await getStreamerSummary(streamerId, range);
    res.json(summary);
  } catch (error) {
    console.error("Get Summary Error:", error);
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
      res.status(400).json({ error: "Invalid range parameter. Use 7d, 30d, or 90d." });
      return;
    }

    const summary = await getStreamerSummary(streamerId, range);
    res.json(summary);
  } catch (error) {
    console.error("Get Streamer Summary By ID Error:", error);
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
      res.status(400).json({ error: "Invalid range parameter. Use 7d, 30d, or 90d." });
      return;
    }

    if (!["day", "week"].includes(granularity)) {
      res.status(400).json({ error: "Invalid granularity parameter. Use day or week." });
      return;
    }

    const timeSeries = await getStreamerTimeSeries(
      streamerId,
      range,
      granularity as 'day' | 'week'
    );
    res.json(timeSeries);
  } catch (error) {
    console.error("Get Time Series Error:", error);
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
      res.status(400).json({ error: "Invalid range parameter. Use 7d, 30d, or 90d." });
      return;
    }

    const heatmap = await getStreamerHeatmap(streamerId, range);
    res.json(heatmap);
  } catch (error) {
    console.error("Get Heatmap Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
}