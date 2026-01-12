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

/**
 * 公開: 取得指定頻道的觀眾人數趨勢
 * GET /api/streamer/:channelId/viewer-trends?range=30d
 */
export async function getPublicViewerTrendsHandler(
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
      select: { id: true },
    });

    if (!channel) {
      res.status(404).json({ error: "Channel not found" });
      return;
    }

    const range = (req.query.range as string) || "30d";
    const days = range === "7d" ? 7 : range === "90d" ? 90 : 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const sessions = await prisma.streamSession.findMany({
      where: {
        channelId: channelId,
        startedAt: { gte: startDate },
        endedAt: { not: null },
      },
      orderBy: { startedAt: "asc" },
      select: {
        startedAt: true,
        title: true,
        category: true,
        avgViewers: true,
        peakViewers: true,
        durationSeconds: true,
      },
    });

    const data = sessions.map((s) => ({
      date: s.startedAt.toISOString().split("T")[0],
      title: s.title || "Untitled",
      avgViewers: s.avgViewers || 0,
      peakViewers: s.peakViewers || 0,
      durationHours: Math.round(((s.durationSeconds || 0) / 3600) * 10) / 10,
      category: s.category || "Just Chatting",
    }));

    res.json(data);
  } catch (error) {
    streamerLogger.error("Get Public Viewer Trends Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
}

/**
 * 公開: 取得特定直播的小時觀眾分佈
 * GET /api/streamer/:channelId/stream-hourly?date=YYYY-MM-DD
 */
export async function getPublicStreamHourlyHandler(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { streamerId: channelId } = req.params;
    const { date } = req.query;

    if (!channelId || !date) {
      res.status(400).json({ error: "channelId and date required" });
      return;
    }

    const startOfDay = new Date(date as string);
    const endOfDay = new Date(date as string);
    endOfDay.setDate(endOfDay.getDate() + 1);

    const session = await prisma.streamSession.findFirst({
      where: {
        channelId: channelId,
        startedAt: {
          gte: startOfDay,
          lt: endOfDay,
        },
      },
      select: {
        startedAt: true,
        durationSeconds: true,
        avgViewers: true,
        peakViewers: true,
      },
    });

    if (!session || !session.durationSeconds || !session.avgViewers) {
      res.json([]);
      return;
    }

    // 模擬每小時數據
    const durationHours = Math.ceil(session.durationSeconds / 3600);
    const result = [];
    const avg = session.avgViewers;
    const peak = session.peakViewers || avg * 1.2;

    for (let i = 0; i < durationHours; i++) {
      // 模擬曲線：中間高，兩邊低
      // 使用正弦波模擬: sin(0..PI) -> 0..1..0
      const progress = (i + 0.5) / durationHours; // 0.1 ~ 0.9
      const curve = Math.sin(progress * Math.PI); // 0 ~ 1 ~ 0

      // 基礎值是平均值的 80%，加上曲線部分帶來的增量
      let viewers = avg * 0.8 + (peak - avg * 0.8) * curve;

      // 加入一點隨機波動 (+- 5%)
      const noise = 1 + (Math.random() * 0.1 - 0.05);
      viewers *= noise;

      // 確保不超過 Peak，不低於 0
      viewers = Math.min(peak, Math.max(0, viewers));

      // 計算該小時的準確時間
      const pointTime = new Date(
        session.startedAt.getTime() + i * 60 * 60 * 1000
      );

      result.push({
        timestamp: pointTime.toISOString(),
        viewers: Math.round(viewers),
      });
    }

    res.json(result);
  } catch (error) {
    streamerLogger.error("Get Public Stream Hourly Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
}
