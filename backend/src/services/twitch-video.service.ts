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
   * 只保留最新的 6 筆封存影片 (Archive)
   */
  async syncVideos(userId: string, streamerId: string) {
    try {
      const client = await this.getClient();
      // 獲取前 6 筆 Archive (過往實況) - 依時間排序最新的
      const videos = await client.videos.getVideosByUser(userId, {
        limit: 6,
        type: "archive",
      });

      let syncedCount = 0;
      const syncedVideoIds: string[] = [];

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
        syncedVideoIds.push(video.id);
        syncedCount++;
      }

      // 刪除不在最新 6 部中的舊影片
      const deleteResult = await prisma.video.deleteMany({
        where: {
          streamerId: streamerId,
          twitchVideoId: {
            notIn: syncedVideoIds,
          },
        },
      });

      logger.info(
        "TwitchVideo",
        `Synced ${syncedCount} videos for user ${userId}, deleted ${deleteResult.count} old videos`,
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
   * 只保留觀看次數最高的 6 筆
   */
  async syncClips(userId: string, streamerId: string) {
    try {
      const client = await this.getClient();

      // 從 Twitch API 獲取剪輯（API 預設依觀看次數排序）
      const clips = await client.clips.getClipsForBroadcaster(userId, {
        limit: 6,
      });

      let syncedCount = 0;
      const syncedClipIds: string[] = [];

      for (const clip of clips.data) {
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
        syncedClipIds.push(clip.id);
        syncedCount++;
      }

      // 刪除不在 Top 6 觀看次數中的舊剪輯
      const deleteResult = await prisma.clip.deleteMany({
        where: {
          streamerId: streamerId,
          twitchClipId: {
            notIn: syncedClipIds,
          },
        },
      });

      logger.info(
        "TwitchVideo",
        `Synced ${syncedCount} clips for user ${userId}, deleted ${deleteResult.count} old clips`,
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
