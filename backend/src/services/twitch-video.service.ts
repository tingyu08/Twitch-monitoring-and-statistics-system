import { prisma } from "../db/prisma";
import { twurpleAuthService } from "./twurple-auth.service";
import { logger } from "../utils/logger";

/* eslint-disable @typescript-eslint/no-explicit-any */
export class TwurpleVideoService {
  private apiClient: any | null = null;

  private async getClient() {
    if (!this.apiClient) {
      const { ApiClient } = await new Function(
        'return import("@twurple/api")',
      )();
      const authProvider = await twurpleAuthService.getAppAuthProvider();
      this.apiClient = new ApiClient({ authProvider });
    }
    return this.apiClient;
  }

  /**
   * 同步實況主的 VOD (Videos)
   * 預設同步最新的 20 筆封存影片 (Archive)
   */
  async syncVideos(userId: string, streamerId: string) {
    try {
      const client = await this.getClient();
      // 獲取前 20 筆 Archive (過往實況)
      const videos = await client.videos.getVideosByUser(userId, {
        limit: 20,
        type: "archive",
      });

      let syncedCount = 0;

      for (const video of videos.data) {
        // Twurple video.duration is a string like "3h30m20s"
        await prisma.video.upsert({
          where: { twitchVideoId: video.id },
          create: {
            twitchVideoId: video.id,
            streamerId: streamerId,
            title: video.title,
            description: video.description,
            url: video.url,
            // Replace {width}x{height} placeholders
            thumbnailUrl: video.thumbnailUrl
              .replace("%{width}", "320")
              .replace("%{height}", "180")
              .replace("{width}", "320")
              .replace("{height}", "180"),
            viewCount: video.views,
            duration: video.duration,
            language: video.language,
            type: video.type,
            createdAt: video.creationDate,
            publishedAt: video.publishDate,
          },
          update: {
            title: video.title,
            description: video.description,
            thumbnailUrl: video.thumbnailUrl
              .replace("%{width}", "320")
              .replace("%{height}", "180")
              .replace("{width}", "320")
              .replace("{height}", "180"),
            viewCount: video.views,
          },
        });
        syncedCount++;
      }

      logger.debug(
        "TwitchVideo",
        `Synced ${syncedCount} videos for user ${userId}`,
      );
    } catch (error) {
      logger.error(
        "TwitchVideo",
        `Failed to sync videos for user ${userId}`,
        error,
      );
    }
  }

  /**
   * 同步實況主的 Clips (精華)
   * 預設同步最新的 50 筆
   */
  async syncClips(userId: string, streamerId: string) {
    try {
      const client = await this.getClient();

      // 策略更新：分開抓取以滿足兩種需求
      // 1. 觀眾追蹤名單：需要歷史觀看數最高的 6 部 (Top 6 All-time)
      const topClipsPromise = client.clips.getClipsForBroadcaster(userId, {
        limit: 6,
      });

      // 2. 實況主後台：需要顯示最近生成的剪輯 (Recent 50)
      // Twitch API Clips 預設按熱門排序，要抓「最新」只能透過 startDate 限制範圍
      const recentStart = new Date();
      recentStart.setDate(recentStart.getDate() - 60); // 抓過去 60 天
      const recentClipsPromise = client.clips.getClipsForBroadcaster(userId, {
        startDate: recentStart,
        limit: 50,
      });

      const [topClips, recentClips] = await Promise.all([
        topClipsPromise,
        recentClipsPromise,
      ]);

      // 合併結果並去重
      const uniqueClips = new Map();
      [...topClips.data, ...recentClips.data].forEach((clip) => {
        uniqueClips.set(clip.id, clip);
      });

      let syncedCount = 0;

      for (const clip of uniqueClips.values()) {
        await prisma.clip.upsert({
          where: { twitchClipId: clip.id },
          create: {
            twitchClipId: clip.id,
            streamerId: streamerId,
            creatorId: clip.creatorId,
            creatorName: clip.creatorDisplayName,
            videoId: clip.videoId,
            gameId: clip.gameId,
            title: clip.title,
            url: clip.url,
            embedUrl: clip.embedUrl,
            thumbnailUrl: clip.thumbnailUrl
              .replace("%{width}", "320")
              .replace("%{height}", "180")
              .replace("{width}", "320")
              .replace("{height}", "180"),
            viewCount: clip.views,
            duration: clip.duration,
            createdAt: clip.creationDate,
          },
          update: {
            title: clip.title,
            viewCount: clip.views,
            thumbnailUrl: clip.thumbnailUrl
              .replace("%{width}", "320")
              .replace("%{height}", "180")
              .replace("{width}", "320")
              .replace("{height}", "180"),
          },
        });
        syncedCount++;
      }
      logger.debug(
        "TwitchVideo",
        `Synced ${syncedCount} clips (Top 6 + Recent) for user ${userId}`,
      );
    } catch (error) {
      logger.error(
        "TwitchVideo",
        `Failed to sync clips for user ${userId}`,
        error,
      );
    }
  }
}

export const twurpleVideoService = new TwurpleVideoService();
