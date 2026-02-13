import type { Request, Response } from "express";
import type { AuthRequest } from "../auth/auth.middleware";
import { prisma } from "../../db/prisma";
import {
  getChannelGameStats,
  getStreamerGameStats,
  getStreamerVideos,
  getStreamerClips,
} from "./streamer.service";
import { streamerLogger } from "../../utils/logger";
import { cacheManager, CacheTTL, getAdaptiveTTL } from "../../utils/cache-manager";

/**
 * 取得遊戲/分類統計
 * GET /api/streamer/me/game-stats?range=30d
 */
export async function getGameStatsHandler(req: AuthRequest, res: Response): Promise<void> {
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
    const stats = await getStreamerGameStats(streamerId, range as "7d" | "30d" | "90d");
    res.json(stats);
  } catch (error) {
    streamerLogger.error("Get Game Stats Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
}

/**
 * 公開: 取得指定頻道的遊戲/分類統計（帶快取）
 * GET /api/streamer/:channelId/game-stats?range=30d
 */
export async function getPublicGameStatsHandler(req: Request, res: Response): Promise<void> {
  try {
    const { streamerId: channelId } = req.params;
    if (!channelId) {
      res.status(400).json({ error: "channelId required" });
      return;
    }

    const range = (req.query.range as string) || "30d";
    if (!["7d", "30d", "90d"].includes(range)) {
      res.status(400).json({ error: "Invalid range parameter." });
      return;
    }

    // 快取鍵
    const cacheKey = `channel:${channelId}:gamestats:${range}`;
    const ttl = getAdaptiveTTL(CacheTTL.MEDIUM, cacheManager);

    const stats = await cacheManager.getOrSetWithTags(
      cacheKey,
      async () => {
        return await getChannelGameStats(channelId, range as "7d" | "30d" | "90d");
      },
      ttl,
      [`channel:${channelId}`, "streamer:public-game-stats"]
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
export async function getVideosHandler(req: AuthRequest, res: Response): Promise<void> {
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
export async function getClipsHandler(req: AuthRequest, res: Response): Promise<void> {
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
 * 公開: 取得指定頻道的 VOD 列表（觀眾追蹤名單用）
 * GET /api/streamer/:channelId/videos
 * 
 * 使用 ViewerChannelVideo 表，此表每個 Channel 最多存 6 部最新影片，
 * 專門優化給觀眾追蹤名單使用，避免查詢實況主的完整 Video 表。
 */
export async function getPublicVideosHandler(req: Request, res: Response): Promise<void> {
  try {
    const { streamerId: channelId } = req.params; // 參數名稱是 streamerId 但其實是 channelId
    if (!channelId) {
      res.status(400).json({ error: "channelId required" });
      return;
    }

    // 直接查詢 ViewerChannelVideo 表（已按 Channel 分離，效能最佳）
    const videos = await prisma.viewerChannelVideo.findMany({
      where: { channelId },
      orderBy: { publishedAt: "desc" },
      select: {
        id: true,
        twitchVideoId: true,
        title: true,
        url: true,
        thumbnailUrl: true,
        viewCount: true,
        duration: true,
        publishedAt: true,
      },
      take: 6, // 最多 6 部
    });

    res.json({
      data: videos,
      total: videos.length,
      page: 1,
      limit: 6,
      totalPages: 1,
    });
  } catch (error) {
    streamerLogger.error("Get Public Videos Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
}

/**
 * 公開: 取得指定頻道的 Clips 列表（觀眾追蹤名單用）
 * GET /api/streamer/:channelId/clips
 * 
 * 使用 ViewerChannelClip 表，此表每個 Channel 只保留觀看次數最高的 6 部剪輯，
 * 專門優化給觀眾追蹤名單使用，避免查詢實況主的完整 Clip 表。
 */
export async function getPublicClipsHandler(req: Request, res: Response): Promise<void> {
  try {
    const { streamerId: channelId } = req.params; // 參數名稱是 streamerId 但其實是 channelId
    if (!channelId) {
      res.status(400).json({ error: "channelId required" });
      return;
    }

    // 直接查詢 ViewerChannelClip 表（已按 Channel 分離，效能最佳）
    const clips = await prisma.viewerChannelClip.findMany({
      where: { channelId },
      orderBy: { viewCount: "desc" },
      select: {
        id: true,
        twitchClipId: true,
        creatorName: true,
        title: true,
        url: true,
        thumbnailUrl: true,
        viewCount: true,
        duration: true,
        createdAt: true,
      },
      take: 6, // 最多 6 部
    });

    res.json({
      data: clips,
      total: clips.length,
      page: 1,
      limit: 6,
      totalPages: 1,
    });
  } catch (error) {
    streamerLogger.error("Get Public Clips Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
}

/**
 * 公開: 取得指定頻道的觀眾人數趨勢（帶快取）
 * GET /api/streamer/:channelId/viewer-trends?range=30d
 */
export async function getPublicViewerTrendsHandler(req: Request, res: Response): Promise<void> {
  try {
    const { streamerId: channelId } = req.params;
    if (!channelId) {
      res.status(400).json({ error: "channelId required" });
      return;
    }

    const range = (req.query.range as string) || "30d";
    const days = range === "7d" ? 7 : range === "90d" ? 90 : 30;

    // 快取鍵
    const cacheKey = `channel:${channelId}:viewertrends:${range}`;
    const ttl = getAdaptiveTTL(CacheTTL.MEDIUM, cacheManager);

    const data = await cacheManager.getOrSetWithTags(
      cacheKey,
      async () => {
        const channel = await prisma.channel.findUnique({
          where: { id: channelId },
          select: { id: true },
        });

        if (!channel) {
          throw new Error("Channel not found");
        }

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

        return sessions.map(
          (s: {
            startedAt: Date;
            title: string | null;
            category: string | null;
            avgViewers: number | null;
            peakViewers: number | null;
            durationSeconds: number | null;
          }) => ({
            date: s.startedAt.toISOString().split("T")[0],
            title: s.title || "Untitled",
            avgViewers: s.avgViewers || 0,
            peakViewers: s.peakViewers || 0,
            durationHours: Math.round(((s.durationSeconds || 0) / 3600) * 10) / 10,
            category: s.category || "Just Chatting",
          })
        );
      },
      ttl,
      [`channel:${channelId}`, "streamer:public-viewer-trends"]
    );

    res.json(data);
  } catch (error) {
    streamerLogger.error("Get Public Viewer Trends Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
}

/**
 * 公開: 取得特定直播的小時觀眾分佈（帶快取）
 * GET /api/streamer/:channelId/stream-hourly?date=YYYY-MM-DD
 */
export async function getPublicStreamHourlyHandler(req: Request, res: Response): Promise<void> {
  try {
    const { streamerId: channelId } = req.params;
    const { date } = req.query;

    if (!channelId || !date) {
      res.status(400).json({ error: "channelId and date required" });
      return;
    }

    // 快取鍵（歷史資料可以長時間快取）
    const cacheKey = `channel:${channelId}:streamhourly:${date}`;

    // 歷史資料使用較長的 TTL（30 分鐘），因為不會再變動
    const ttl = getAdaptiveTTL(CacheTTL.VERY_LONG, cacheManager);

    const data = await cacheManager.getOrSetWithTags(
      cacheKey,
      async () => {
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
            id: true,
            startedAt: true,
            durationSeconds: true,
            avgViewers: true,
            peakViewers: true,
            metrics: {
              orderBy: { timestamp: "asc" },
              select: {
                timestamp: true,
                viewerCount: true,
              },
            },
          },
        });

        if (!session) {
          return [];
        }

        // 1. 如果有真實數據 (Metrics)，優先使用
        if (session.metrics && session.metrics.length > 0) {
          return session.metrics.map((m: { timestamp: Date; viewerCount: number }) => ({
            timestamp: m.timestamp.toISOString(),
            viewers: m.viewerCount,
          }));
        }

        // 2. 如果沒有真實數據，且無法模擬 (無 duration/avg)，回傳空
        if (!session.durationSeconds || !session.avgViewers) {
          return [];
        }

        // 3. Fallback: 使用模擬演算法 (舊資料/未能採集到時使用)
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
          const pointTime = new Date(session.startedAt.getTime() + i * 60 * 60 * 1000);

          result.push({
            timestamp: pointTime.toISOString(),
            viewers: Math.round(viewers),
          });
        }

        return result;
      },
      ttl,
      [`channel:${channelId}`, "streamer:public-stream-hourly"]
    );

    res.json(data);
  } catch (error) {
    streamerLogger.error("Get Public Stream Hourly Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
}
