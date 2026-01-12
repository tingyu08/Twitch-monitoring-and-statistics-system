import type { Response } from "express";
import type { AuthRequest } from "../auth/auth.middleware";
import {
  getStreamerGameStats,
  getStreamerVideos,
  getStreamerClips,
} from "./streamer.service";
import { streamerLogger } from "../../utils/logger";

/**
 * 取得遊戲/分類統計
 * GET /api/streamer/me/game-stats?range=30d
 */
export async function getGameStatsHandler(
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
    if (!["7d", "30d", "90d"].includes(range)) {
      res.status(400).json({ error: "Invalid range parameter." });
      return;
    }
    // Cast strict type
    const stats = await getStreamerGameStats(
      streamerId,
      range as "7d" | "30d" | "90d"
    );
    res.json(stats);
  } catch (error) {
    streamerLogger.error("Get Game Stats Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
}

/**
 * 取得 VOD 列表
 * GET /api/streamer/me/videos?page=1&limit=20
 */
export async function getVideosHandler(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const streamerId = req.user?.streamerId;
    if (!streamerId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;

    // Max limit
    const safeLimit = Math.min(limit, 100);

    const result = await getStreamerVideos(streamerId, safeLimit, page);
    res.json(result);
  } catch (error) {
    streamerLogger.error("Get Videos Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
}

/**
 * 取得 Clips 列表
 * GET /api/streamer/me/clips?page=1&limit=20
 */
export async function getClipsHandler(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const streamerId = req.user?.streamerId;
    if (!streamerId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const safeLimit = Math.min(limit, 100);

    const result = await getStreamerClips(streamerId, safeLimit, page);
    res.json(result);
  } catch (error) {
    streamerLogger.error("Get Clips Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
}
