import type { Request, Response } from "express";
import type { AuthRequest } from "../auth/auth.middleware";
import { prisma } from "../../db/prisma";
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
 * 公開: 取得指定頻道的遊戲/分類統計
 * GET /api/streamer/:channelId/game-stats?range=30d
 */
export async function getPublicGameStatsHandler(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { streamerId: channelId } = req.params;
    if (!channelId) {
      res.status(400).json({ error: "channelId required" });
      return;
    }

    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { streamerId: true },
    });

    if (!channel?.streamerId) {
      res.status(404).json({ error: "Streamer not found for this channel" });
      return;
    }

    const range = (req.query.range as string) || "30d";
    if (!["7d", "30d", "90d"].includes(range)) {
      res.status(400).json({ error: "Invalid range parameter." });
      return;
    }

    const stats = await getStreamerGameStats(
      channel.streamerId,
      range as "7d" | "30d" | "90d"
    );
    res.json(stats);
  } catch (error) {
    streamerLogger.error("Get Public Game Stats Error:", error);
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

/**
 * 公開: 取得指定頻道的 VOD 列表
 * GET /api/streamer/:channelId/videos
 * 注意: 這裡的 channelId 是 Channel 表的 UUID，需要轉換成 streamerId
 */
export async function getPublicVideosHandler(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { streamerId: channelId } = req.params; // 參數名稱是 streamerId 但其實是 channelId
    if (!channelId) {
      res.status(400).json({ error: "channelId required" });
      return;
    }

    // 先查詢 Channel 取得對應的 streamerId
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { streamerId: true },
    });

    if (!channel?.streamerId) {
      // 嘗試直接用 channelId 當 streamerId 查詢（相容舊邏輯）
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const safeLimit = Math.min(limit, 100);
      const result = await getStreamerVideos(channelId, safeLimit, page);
      res.json(result);
      return;
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const safeLimit = Math.min(limit, 100);

    const result = await getStreamerVideos(channel.streamerId, safeLimit, page);
    res.json(result);
  } catch (error) {
    streamerLogger.error("Get Public Videos Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
}

/**
 * 公開: 取得指定頻道的 Clips 列表
 * GET /api/streamer/:channelId/clips
 * 注意: 這裡的 channelId 是 Channel 表的 UUID，需要轉換成 streamerId
 */
export async function getPublicClipsHandler(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { streamerId: channelId } = req.params; // 參數名稱是 streamerId 但其實是 channelId
    if (!channelId) {
      res.status(400).json({ error: "channelId required" });
      return;
    }

    // 先查詢 Channel 取得對應的 streamerId
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { streamerId: true },
    });

    if (!channel?.streamerId) {
      // 嘗試直接用 channelId 當 streamerId 查詢（相容舊邏輯）
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const safeLimit = Math.min(limit, 100);
      const result = await getStreamerClips(channelId, safeLimit, page);
      res.json(result);
      return;
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const safeLimit = Math.min(limit, 100);

    const result = await getStreamerClips(channel.streamerId, safeLimit, page);
    res.json(result);
  } catch (error) {
    streamerLogger.error("Get Public Clips Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
}
