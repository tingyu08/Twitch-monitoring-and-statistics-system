import type { Request, Response } from "express";
import type { AuthRequest } from "../auth/auth.middleware";
import { getStreamerSummary } from "./streamer.service";

export async function getSummaryHandler(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const streamerId = req.user?.streamerId;
    console.log('[DEBUG] getSummary - streamerId:', streamerId);

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
    console.log('[DEBUG] getSummary - result:', summary);
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

    console.log('[DEBUG] getStreamerSummaryById - streamerId:', streamerId, 'range:', range);

    if (!streamerId) {
      res.status(400).json({ error: "streamerId is required" });
      return;
    }

    if (!["7d", "30d", "90d"].includes(range)) {
      res.status(400).json({ error: "Invalid range parameter. Use 7d, 30d, or 90d." });
      return;
    }

    const summary = await getStreamerSummary(streamerId, range);
    console.log('[DEBUG] getStreamerSummaryById - result:', summary);
    res.json(summary);
  } catch (error) {
    console.error("Get Streamer Summary By ID Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
}