import { prisma } from "../db/prisma";
import { twurpleAuthService } from "./twurple-auth.service";
import { logger } from "../utils/logger";
import { retryDatabaseOperation } from "../utils/db-retry";

export class TwurpleVideoService {
  // ApiClient 透過動態導入，使用 unknown 類型
  private apiClient: unknown = null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async getClient(): Promise<any> {
    if (!this.apiClient) {
      const { ApiClient } = (await new Function('return import("@twurple/api")')()) as {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ApiClient: any;
      };
      const authProvider = await twurpleAuthService.getAppAuthProvider();
      this.apiClient = new ApiClient({ authProvider });
    }
    return this.apiClient;
  }

  /**
   * 同步實況主的 VOD (Videos)
   * 預設同步所有可取得的封存影片 (Archive)
   */
  async syncVideos(userId: string, streamerId: string) {
    try {
      const client = await this.getClient();
      const MAX_PAGES = 20;
      const PAGE_SIZE = 100;
      let cursor: string | undefined;
      let page = 0;
      let syncedCount = 0;

      const normalizeThumbnail = (url?: string | null) => {
        if (!url) return null;
        return url
          .replace("%{width}", "320")
          .replace("%{height}", "180")
          .replace("{width}", "320")
          .replace("{height}", "180");
      };

      while (page < MAX_PAGES) {
        const response = await client.callApi({
          type: "helix",
          url: "videos",
          query: {
            user_id: userId,
            type: "archive",
            first: String(PAGE_SIZE),
            ...(cursor ? { after: cursor } : {}),
          },
        });

        const data = (response?.data || []) as Array<{
          id: string;
          title: string;
          description: string | null;
          url: string;
          thumbnail_url: string | null;
          view_count: number;
          duration: string;
          language: string | null;
          type: string;
          created_at: string;
          published_at: string;
        }>;

        if (data.length === 0) {
          break;
        }

        for (const video of data) {
          await prisma.video.upsert({
            where: { twitchVideoId: video.id },
            create: {
              twitchVideoId: video.id,
              streamerId: streamerId,
              title: video.title,
              description: video.description,
              url: video.url,
              thumbnailUrl: normalizeThumbnail(video.thumbnail_url),
              viewCount: video.view_count,
              duration: video.duration,
              language: video.language,
              type: video.type,
              createdAt: new Date(video.created_at),
              publishedAt: new Date(video.published_at),
            },
            update: {
              title: video.title,
              description: video.description,
              thumbnailUrl: normalizeThumbnail(video.thumbnail_url),
              viewCount: video.view_count,
            },
          });
          syncedCount++;
        }

        cursor = response?.pagination?.cursor;
        if (!cursor) {
          break;
        }
        page++;
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
        logger.debug(
          "TwitchVideo",
          `Cleaned up ${deleteResult.count} videos older than 90 days for streamer ${streamerId}`
        );
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

      // 優化：使用重試機制包裝 transaction，並使用批量插入
      await retryDatabaseOperation(async () => {
        await prisma.$transaction(
          async (tx) => {
            // 1. 刪除該 Channel 的所有舊影片
            await tx.viewerChannelVideo.deleteMany({
              where: { channelId },
            });

            // 2. 批量插入新的影片（而非循環插入，避免超時）
            if (videos.data.length > 0) {
              await tx.viewerChannelVideo.createMany({
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                data: videos.data.map((video: any) => ({
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
                })),
              });
            }
          },
          {
            maxWait: 10000, // 最多等待 10 秒獲取 transaction
            timeout: 15000, // transaction 超時時間 15 秒
          }
        );
      });

      logger.debug(
        "TwitchVideo",
        `Synced ${videos.data.length} viewer videos for channel ${channelId}`
      );
    } catch (error) {
      logger.error("TwitchVideo", `Failed to sync viewer videos for channel ${channelId}`, error);
    }
  }

  /**
   * 同步實況主的 Clips (精華)
   * 透過分頁同步所有可取得的剪輯
   */
  async syncClips(userId: string, streamerId: string) {
    try {
      const client = await this.getClient();
      const MAX_PAGES = 50;
      const PAGE_SIZE = 100;
      const startDate = new Date("2016-01-01T00:00:00Z");
      let cursor: string | undefined;
      let page = 0;
      let syncedCount = 0;

      const normalizeThumbnail = (url?: string | null) => {
        if (!url) return null;
        return url
          .replace("%{width}", "320")
          .replace("%{height}", "180")
          .replace("{width}", "320")
          .replace("{height}", "180");
      };

      while (page < MAX_PAGES) {
        const response = await client.callApi({
          type: "helix",
          url: "clips",
          query: {
            broadcaster_id: userId,
            started_at: startDate.toISOString(),
            first: String(PAGE_SIZE),
            ...(cursor ? { after: cursor } : {}),
          },
        });

        const data = (response?.data || []) as Array<{
          id: string;
          url: string;
          embed_url: string | null;
          creator_id: string | null;
          creator_name: string | null;
          video_id: string | null;
          game_id: string | null;
          title: string;
          view_count: number;
          created_at: string;
          thumbnail_url: string | null;
          duration: number;
        }>;

        if (data.length === 0) {
          break;
        }

        for (const clip of data) {
          await prisma.clip.upsert({
            where: { twitchClipId: clip.id },
            create: {
              twitchClipId: clip.id,
              streamerId: streamerId,
              creatorId: clip.creator_id,
              creatorName: clip.creator_name,
              videoId: clip.video_id,
              gameId: clip.game_id,
              title: clip.title,
              url: clip.url,
              embedUrl: clip.embed_url,
              thumbnailUrl: normalizeThumbnail(clip.thumbnail_url),
              viewCount: clip.view_count,
              duration: clip.duration,
              createdAt: new Date(clip.created_at),
            },
            update: {
              title: clip.title,
              viewCount: clip.view_count,
              thumbnailUrl: normalizeThumbnail(clip.thumbnail_url),
            },
          });
          syncedCount++;
        }

        cursor = response?.pagination?.cursor;
        if (!cursor) {
          break;
        }
        page++;
      }

      logger.debug("TwitchVideo", `Synced ${syncedCount} clips for user ${userId}`);
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

      // 優化：使用重試機制 + 批量操作（避免循環 upsert 超時）
      await retryDatabaseOperation(async () => {
        await prisma.$transaction(
          async (tx) => {
            // 1. 刪除該 Channel 的所有舊剪輯（簡化策略：全部刪除再重建）
            await tx.viewerChannelClip.deleteMany({
              where: { channelId },
            });

            // 2. 批量插入新的 Top 6 剪輯（避免循環 upsert 導致超時）
            if (topClips.data.length > 0) {
              await tx.viewerChannelClip.createMany({
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                data: topClips.data.map((clip: any) => ({
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
                })),
              });
            }
          },
          {
            maxWait: 10000, // 最多等待 10 秒獲取 transaction
            timeout: 15000, // transaction 超時時間 15 秒
          }
        );
      });

      logger.debug(
        "TwitchVideo",
        `Synced ${topClips.data.length} viewer clips for channel ${channelId}`
      );
    } catch (error) {
      logger.error("TwitchVideo", `Failed to sync viewer clips for channel ${channelId}`, error);
    }
  }
}

export const twurpleVideoService = new TwurpleVideoService();
