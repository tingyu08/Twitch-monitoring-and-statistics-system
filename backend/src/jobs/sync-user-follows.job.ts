/**
 * Sync User Follows Job
 * 定時同步使用者的 Twitch 追蹤名單 (使用 Twurple)
 *
 * Story 3.6: 使用者追蹤頻道與全域監控
 */

/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
/* eslint-disable @typescript-eslint/no-explicit-any */

import cron from "node-cron";
import pLimit from "p-limit";
import { prisma } from "../db/prisma";
import { twurpleHelixService } from "../services/twitch-helix.service";
import { logger } from "../utils/logger";

// 每小時執行一次
const SYNC_FOLLOWS_CRON = process.env.SYNC_FOLLOWS_CRON || "0 * * * *";

// 並發控制：同時最多處理 5 個使用者
const CONCURRENCY_LIMIT = 5;

export interface SyncUserFollowsResult {
  usersProcessed: number;
  channelsCreated: number;
  followsCreated: number;
  followsRemoved: number;
  channelsDeactivated: number;
  // Monitoring fields
  usersFailed: number;
  totalMonitoredChannels: number;
  executionTimeMs: number;
}

export class SyncUserFollowsJob {
  private isRunning = false;

  /**
   * 啟動 Cron Job
   */
  start(): void {
    logger.info(
      "Jobs",
      `📋 Sync User Follows Job 已排程: ${SYNC_FOLLOWS_CRON}`
    );

    cron.schedule(SYNC_FOLLOWS_CRON, async () => {
      await this.execute();
    });
  }

  /**
   * 執行追蹤名單同步
   */
  async execute(): Promise<SyncUserFollowsResult> {
    if (this.isRunning) {
      logger.warn("Jobs", "⚠️ Sync User Follows Job 正在執行中，跳過...");
      return {
        usersProcessed: 0,
        channelsCreated: 0,
        followsCreated: 0,
        followsRemoved: 0,
        channelsDeactivated: 0,
        usersFailed: 0,
        totalMonitoredChannels: 0,
        executionTimeMs: 0,
      };
    }

    this.isRunning = true;
    const startTime = Date.now();
    logger.info("Jobs", "📋 開始同步使用者追蹤名單...");

    const result: SyncUserFollowsResult = {
      usersProcessed: 0,
      channelsCreated: 0,
      followsCreated: 0,
      followsRemoved: 0,
      channelsDeactivated: 0,
      usersFailed: 0,
      totalMonitoredChannels: 0,
      executionTimeMs: 0,
    };

    try {
      // 1. 獲取所有有 user:read:follows 權限的使用者
      const usersWithFollowScope = await this.getUsersWithFollowScope();
      logger.info(
        "Jobs",
        `找到 ${usersWithFollowScope.length} 個有追蹤權限的使用者`
      );

      // 2. 對每個使用者同步追蹤名單 (使用並發控制)
      const limit = pLimit(CONCURRENCY_LIMIT);

      const syncTasks = usersWithFollowScope.map((user) =>
        limit(async () => {
          try {
            const userResult = await this.syncUserFollows(user);
            return {
              success: true,
              channelsCreated: userResult.channelsCreated,
              followsCreated: userResult.followsCreated,
              followsRemoved: userResult.followsRemoved,
            };
          } catch (error) {
            logger.error(
              "Jobs",
              `同步使用者 ${user.twitchUserId} 追蹤名單失敗`,
              error
            );
            return {
              success: false,
              channelsCreated: 0,
              followsCreated: 0,
              followsRemoved: 0,
            };
          }
        })
      );

      const taskResults = await Promise.all(syncTasks);

      // 聚合結果
      for (const taskResult of taskResults) {
        if (taskResult.success) {
          result.usersProcessed++;
          result.channelsCreated += taskResult.channelsCreated;
          result.followsCreated += taskResult.followsCreated;
          result.followsRemoved += taskResult.followsRemoved;
        } else {
          result.usersFailed++;
        }
      }

      // 3. 清理不再被追蹤的 external 頻道
      result.channelsDeactivated = await this.cleanupUnfollowedChannels();

      // 4. 獲取目前監控中的頻道總數
      result.totalMonitoredChannels = await this.getMonitoredChannelCount();

      // 5. 計算執行時間
      result.executionTimeMs = Date.now() - startTime;

      // 6. 輸出完整監控日誌
      logger.info(
        "Jobs",
        `✅ Sync User Follows Job 完成: ${result.usersProcessed} 使用者, ` +
          `${result.channelsCreated} 新頻道, ${result.followsCreated} 新追蹤, ` +
          `${result.followsRemoved} 移除追蹤, ${result.channelsDeactivated} 停用頻道, ` +
          `${result.usersFailed} 失敗, ${result.totalMonitoredChannels} 監控中, ` +
          `耗時 ${result.executionTimeMs}ms`
      );

      return result;
    } catch (error) {
      result.executionTimeMs = Date.now() - startTime;
      logger.error("Jobs", "❌ Sync User Follows Job 執行失敗", error);
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * 獲取所有有 user:read:follows 權限的使用者
   */
  private async getUsersWithFollowScope(): Promise<
    Array<{
      id: string;
      twitchUserId: string;
      userType: "streamer" | "viewer";
      accessToken: string;
    }>
  > {
    const users: Array<{
      id: string;
      twitchUserId: string;
      userType: "streamer" | "viewer";
      accessToken: string;
    }> = [];

    // 獲取有 user:read:follows scope 的 Streamer tokens
    // 注意：統一登入後，streamer token 也會有 viewerId
    const streamerTokens = await prisma.twitchToken.findMany({
      where: {
        ownerType: "streamer",
        streamerId: { not: null },
        scopes: { contains: "user:read:follows" },
      },
      include: { streamer: true, viewer: true },
    });

    for (const token of streamerTokens) {
      if (token.streamer && token.streamerId) {
        // 優先使用 viewerId（因為前端查詢使用 viewerId）
        // 如果沒有 viewerId，則使用 streamerId
        const userId = token.viewerId || token.streamerId;
        const userType = token.viewerId ? "viewer" : "streamer";

        users.push({
          id: userId,
          twitchUserId: token.streamer.twitchUserId,
          userType: userType as "streamer" | "viewer",
          accessToken: token.accessToken,
        });
      }
    }

    // 獲取有 user:read:follows scope 的 Viewer tokens
    const viewerTokens = await prisma.twitchToken.findMany({
      where: {
        ownerType: "viewer",
        viewerId: { not: null },
        scopes: { contains: "user:read:follows" },
      },
      include: { viewer: true },
    });

    for (const token of viewerTokens) {
      if (token.viewer && token.viewerId) {
        users.push({
          id: token.viewerId,
          twitchUserId: token.viewer.twitchUserId,
          userType: "viewer",
          accessToken: token.accessToken,
        });
      }
    }

    return users;
  }

  /**
   * 同步單一使用者的追蹤名單
   */
  private async syncUserFollows(user: {
    id: string;
    twitchUserId: string;
    userType: "streamer" | "viewer";
    accessToken: string;
  }): Promise<{
    channelsCreated: number;
    followsCreated: number;
    followsRemoved: number;
  }> {
    const result = {
      channelsCreated: 0,
      followsCreated: 0,
      followsRemoved: 0,
    };

    // 1. 從 Twitch 獲取追蹤名單 (需要傳入解密後的 User Token)
    const { decryptToken } = await import("../utils/crypto.utils");
    const decryptedToken = decryptToken(user.accessToken);

    const followedChannels = await twurpleHelixService.getFollowedChannels(
      user.twitchUserId,
      decryptedToken
    );

    // 2. 獲取目前資料庫中的追蹤記錄
    const existingFollows = await prisma.userFollow.findMany({
      where: { userId: user.id },
      include: { channel: true },
    });

    const existingFollowMap = new Map(
      existingFollows.map((f) => [f.channel.twitchChannelId, f])
    );

    // 3. 處理每個追蹤的頻道
    for (const follow of followedChannels) {
      const existingFollow = existingFollowMap.get(follow.broadcasterId);

      if (existingFollow) {
        // 已存在，從 map 中移除（剩餘的就是需要刪除的）
        existingFollowMap.delete(follow.broadcasterId);
      } else {
        // 新追蹤：確保頻道存在，建立追蹤記錄
        let channel = await prisma.channel.findUnique({
          where: { twitchChannelId: follow.broadcasterId },
        });

        if (!channel) {
          // 獲取該頻道的詳細資訊（包含頭像）
          let avatarUrl = "";
          let displayName = follow.broadcasterLogin;
          try {
            const userInfo = await twurpleHelixService.getUserById(
              follow.broadcasterId
            );
            if (userInfo) {
              avatarUrl = userInfo.profileImageUrl || "";
              displayName = userInfo.displayName || follow.broadcasterLogin;
            }
          } catch {
            // 如果獲取失敗，繼續使用預設值
          }

          // 先建立或獲取 Streamer 記錄（用於儲存頭像等資訊）
          const existingStreamer = await prisma.streamer.findUnique({
            where: { twitchUserId: follow.broadcasterId },
          });

          let streamerId: string | null = null;
          if (existingStreamer) {
            // 更新頭像
            await prisma.streamer.update({
              where: { id: existingStreamer.id },
              data: { avatarUrl, displayName },
            });
            streamerId = existingStreamer.id;
          } else {
            // 建立新的 Streamer 記錄
            const newStreamer = await prisma.streamer.create({
              data: {
                twitchUserId: follow.broadcasterId,
                displayName,
                avatarUrl,
              },
            });
            streamerId = newStreamer.id;
          }

          // 建立新的 external 頻道
          channel = await prisma.channel.create({
            data: {
              twitchChannelId: follow.broadcasterId,
              channelName: follow.broadcasterLogin,
              channelUrl: `https://www.twitch.tv/${follow.broadcasterLogin}`,
              source: "external",
              isMonitored: true,
              streamerId, // 關聯到 Streamer 以獲取頭像
            },
          });
          result.channelsCreated++;
        } else if (!channel.isMonitored) {
          // 重新啟用監控
          await prisma.channel.update({
            where: { id: channel.id },
            data: { isMonitored: true },
          });
        }

        // 建立追蹤記錄
        await prisma.userFollow.create({
          data: {
            userId: user.id,
            userType: user.userType,
            channelId: channel.id,
            followedAt: follow.followedAt,
          },
        });
        result.followsCreated++;
      }
    }

    // 4. 刪除不再追蹤的記錄
    for (const [, oldFollow] of existingFollowMap) {
      await prisma.userFollow.delete({
        where: { id: oldFollow.id },
      });
      result.followsRemoved++;
    }

    return result;
  }

  /**
   * 清理不再被任何使用者追蹤的外部頻道
   */
  private async cleanupUnfollowedChannels(): Promise<number> {
    // 找出所有 source="external" 且沒有 UserFollow 關聯的頻道
    const orphanedChannels = await prisma.channel.findMany({
      where: {
        source: "external",
        isMonitored: true,
        userFollows: { none: {} },
      } as any, // Type assertion for stale Prisma type cache
    });

    // 將其 isMonitored 設為 false
    for (const channel of orphanedChannels) {
      await prisma.channel.update({
        where: { id: channel.id },
        data: { isMonitored: false } as any,
      });
    }

    if (orphanedChannels.length > 0) {
      logger.info(
        "Jobs",
        `🧹 停用 ${orphanedChannels.length} 個無人追蹤的外部頻道`
      );
    }

    return orphanedChannels.length;
  }

  /**
   * 獲取目前監控中的頻道總數
   */
  private async getMonitoredChannelCount(): Promise<number> {
    const count = await prisma.channel.count({
      where: { isMonitored: true } as any,
    });
    return count;
  }
}

// 匯出單例
export const syncUserFollowsJob = new SyncUserFollowsJob();

/**
 * 為單一使用者觸發追蹤名單同步（登入時使用）
 * @param viewerId - Viewer ID
 * @param accessToken - 使用者的 Twitch Access Token (已解密)
 */
export async function triggerFollowSyncForUser(
  viewerId: string,
  accessToken: string
): Promise<void> {
  try {
    logger.info("Jobs", `🔄 登入後同步使用者追蹤名單: ${viewerId}`);

    // 獲取 Viewer 的 Twitch User ID
    const viewer = await prisma.viewer.findUnique({
      where: { id: viewerId },
      select: { twitchUserId: true },
    });

    if (!viewer) {
      logger.warn("Jobs", `Viewer not found: ${viewerId}`);
      return;
    }

    // 呼叫 Twurple API 獲取追蹤清單
    const followedChannels = await twurpleHelixService.getFollowedChannels(
      viewer.twitchUserId,
      accessToken
    );

    logger.info("Jobs", `取得 ${followedChannels.length} 個追蹤的頻道`);

    // 獲取現有的追蹤記錄
    const existingFollows = await prisma.userFollow.findMany({
      where: {
        userId: viewerId,
        userType: "viewer",
      },
      include: { channel: true },
    });

    const existingFollowMap = new Map(
      existingFollows.map((f) => [f.channel.twitchChannelId, f])
    );

    let created = 0;
    let removed = 0;

    // 處理每個追蹤的頻道
    for (const follow of followedChannels) {
      const existingFollow = existingFollowMap.get(follow.broadcasterId);

      if (existingFollow) {
        existingFollowMap.delete(follow.broadcasterId);
      } else {
        // 新追蹤：確保頻道存在
        let channel = await prisma.channel.findUnique({
          where: { twitchChannelId: follow.broadcasterId },
        });

        if (!channel) {
          // 獲取頭像等資訊
          let avatarUrl = "";
          let displayName = follow.broadcasterLogin;
          try {
            const userInfo = await twurpleHelixService.getUserById(
              follow.broadcasterId
            );
            if (userInfo) {
              avatarUrl = userInfo.profileImageUrl || "";
              displayName = userInfo.displayName || follow.broadcasterLogin;
            }
          } catch {
            // ignore
          }

          // 建立或獲取 Streamer 記錄
          let streamer = await prisma.streamer.findUnique({
            where: { twitchUserId: follow.broadcasterId },
          });

          if (!streamer) {
            streamer = await prisma.streamer.create({
              data: {
                twitchUserId: follow.broadcasterId,
                displayName,
                avatarUrl,
              },
            });
          }

          // 建立頻道
          channel = await prisma.channel.create({
            data: {
              twitchChannelId: follow.broadcasterId,
              channelName: follow.broadcasterLogin,
              channelUrl: `https://www.twitch.tv/${follow.broadcasterLogin}`,
              source: "external",
              isMonitored: true,
              streamerId: streamer.id,
            },
          });
        }

        // 建立追蹤記錄
        await prisma.userFollow.create({
          data: {
            userId: viewerId,
            userType: "viewer",
            channelId: channel.id,
            followedAt: follow.followedAt,
          },
        });
        created++;
      }
    }

    // 刪除不再追蹤的記錄
    for (const [, oldFollow] of existingFollowMap) {
      await prisma.userFollow.delete({
        where: { id: oldFollow.id },
      });
      removed++;
    }

    logger.info("Jobs", `✅ 追蹤同步完成: 新增 ${created}, 移除 ${removed}`);
  } catch (error) {
    logger.error("Jobs", "追蹤同步失敗", error);
    throw error;
  }
}
