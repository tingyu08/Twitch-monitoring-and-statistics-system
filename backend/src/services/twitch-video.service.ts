import { prisma } from "../db/prisma";
import { twurpleAuthService } from "./twurple-auth.service";
import { logger } from "../utils/logger";

export class TwurpleVideoService {
  // ApiClient 透過動態導入，使用 unknown 類型
  private apiClient: unknown = null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async getClient(): Promise<any> {
    if (!this.apiClient) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { ApiClient } = await new Function('return import("@twurple/api")')() as { ApiClient: any };
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

      // 清理超過 90 天的影片（實況主用表格）
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

      const deleteResult = await prisma.video.deleteMany({
        where: {
          streamerId: streamerId,
          publishedAt: { lt: ninetyDaysAgo },
        },
      });

      if (deleteResult.count > 0) {
        logger.debug("TwitchVideo", `Cleaned up ${deleteResult.count} videos older than 90 days for streamer ${streamerId}`);
      }

      logger.debug("TwitchVideo", `Synced ${syncedCount} videos for user ${userId}`);
    } catch (error) {
      logger.error("TwitchVideo", `Failed to sync videos for user ${userId}`, error);
    }
  }

  /**
   * 同步觀眾追蹤名單用的影片（ViewerChannelVideo）
   * 每個 Channel 最多保留 6 部最新影片
   * 
   * @param channelId - 資料庫中的 Channel ID
   * @param twitchUserId - Twitch 用戶 ID
   */
  async syncViewerVideos(channelId: string, twitchUserId: string) {
    try {
      const client = await this.getClient();
      
      // 獲取最新 6 筆 Archive (過往實況)
      const videos = await client.videos.getVideosByUser(twitchUserId, {
        limit: 6,
        type: "archive",
      });

      // 使用 transaction：先刪除舊資料，再插入新資料
      await prisma.$transaction(async (tx) => {
        // 1. 刪除該 Channel 的所有舊影片
        await tx.viewerChannelVideo.deleteMany({
          where: { channelId },
        });

        // 2. 插入新的影片
        for (const video of videos.data) {
          await tx.viewerChannelVideo.create({
            data: {
              twitchVideoId: video.id,
              channelId: channelId,
              title: video.title,
              url: video.url,
              thumbnailUrl: video.thumbnailUrl
                .replace("%{width}", "320")
                .replace("%{height}", "180")
                .replace("{width}", "320")
                .replace("{height}", "180"),
              viewCount: video.views,
              duration: video.duration,
              publishedAt: video.publishDate,
            },
          });
        }
      });

      logger.debug("TwitchVideo", `Synced ${videos.data.length} viewer videos for channel ${channelId}`);
    } catch (error) {
      logger.error("TwitchVideo", `Failed to sync viewer videos for channel ${channelId}`, error);
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
      // 注意：Twurple 有 bug，startDate 的 Date 物件會被錯誤序列化為 toString() 格式
      // 而非 ISO 8601 格式，因此這裡使用底層 API 調用來繞過此問題
      const recentStart = new Date();
      recentStart.setDate(recentStart.getDate() - 60); // 抓過去 60 天
      const recentClipsPromise = client.callApi({
        type: "helix",
        url: "clips",
        query: {
          broadcaster_id: userId,
          started_at: recentStart.toISOString(), // 手動轉換為 ISO 8601 格式
          first: "50",
        },
      });

      const [topClips, recentClipsResponse] = await Promise.all([
        topClipsPromise,
        recentClipsPromise,
      ]);

      // 將原始 API 回應轉換為與 Twurple 相同的格式
      interface RawClipData {
        id: string;
        url: string;
        embed_url: string;
        broadcaster_id: string;
        broadcaster_name: string;
        creator_id: string;
        creator_name: string;
        video_id: string;
        game_id: string;
        language: string;
        title: string;
        view_count: number;
        created_at: string;
        thumbnail_url: string;
        duration: number;
      }
      const recentClips = {
        data: (recentClipsResponse.data || []).map((clip: RawClipData) => ({
          id: clip.id,
          url: clip.url,
          embedUrl: clip.embed_url,
          broadcasterId: clip.broadcaster_id,
          broadcasterDisplayName: clip.broadcaster_name,
          creatorId: clip.creator_id,
          creatorDisplayName: clip.creator_name,
          videoId: clip.video_id,
          gameId: clip.game_id,
          language: clip.language,
          title: clip.title,
          views: clip.view_count,
          creationDate: new Date(clip.created_at),
          thumbnailUrl: clip.thumbnail_url,
          duration: clip.duration,
        })),
      };

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
        `Synced ${syncedCount} clips (Top 6 + Recent) for user ${userId}`
      );
    } catch (error) {
      logger.error("TwitchVideo", `Failed to sync clips for user ${userId}`, error);
    }
  }

  /**
   * 同步觀眾追蹤名單用的剪輯（ViewerChannelClip）
   * 只保留觀看次數最高的 6 部剪輯
   * 
   * 策略：
   * - 從 Twitch API 抓取 Top 6 熱門剪輯
   * - 與現有資料比較，只更新有變化的部分
   * - 刪除不在 Top 6 的舊資料
   * 
   * @param channelId - 資料庫中的 Channel ID
   * @param twitchUserId - Twitch 用戶 ID
   */
  async syncViewerClips(channelId: string, twitchUserId: string) {
    try {
      const client = await this.getClient();
      
      // 獲取觀看次數最高的 6 部剪輯（Twitch API 預設按熱門排序）
      const topClips = await client.clips.getClipsForBroadcaster(twitchUserId, {
        limit: 6,
      });

      const newTopClipIds = new Set<string>(topClips.data.map((clip: { id: string }) => clip.id));

      await prisma.$transaction(async (tx) => {
        // 1. 刪除不在新 Top 6 中的舊剪輯
        await tx.viewerChannelClip.deleteMany({
          where: {
            channelId,
            twitchClipId: { notIn: [...newTopClipIds] },
          },
        });

        // 2. Upsert 新的 Top 6 剪輯
        for (const clip of topClips.data) {
          await tx.viewerChannelClip.upsert({
            where: { twitchClipId: clip.id },
            create: {
              twitchClipId: clip.id,
              channelId: channelId,
              creatorName: clip.creatorDisplayName,
              title: clip.title,
              url: clip.url,
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
        }
      });

      logger.debug("TwitchVideo", `Synced ${topClips.data.length} viewer clips for channel ${channelId}`);
    } catch (error) {
      logger.error("TwitchVideo", `Failed to sync viewer clips for channel ${channelId}`, error);
    }
  }
}

export const twurpleVideoService = new TwurpleVideoService();
