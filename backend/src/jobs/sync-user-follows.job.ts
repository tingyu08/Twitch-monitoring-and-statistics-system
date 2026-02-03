/**
 * Sync User Follows Job
 * 定時同步使用者的 Twitch 追蹤名單 (使用 Twurple)
 *
 * Story 3.6: 使用者追蹤頻道與全域監控
 */

import cron from "node-cron";
import pLimit from "p-limit";
import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { twurpleHelixService } from "../services/twitch-helix.service";
import { logger } from "../utils/logger";
import { decryptToken } from "../utils/crypto.utils";
import { cacheManager } from "../utils/cache-manager";

// 類型定義
type TransactionClient = Prisma.TransactionClient;

interface ExistingFollow {
  id: string;
  channel: { twitchChannelId: string };
}

interface ExistingChannel {
  id: string;
  twitchChannelId: string;
  isMonitored: boolean;
  streamerId: string | null;
  streamer?: { id: string; twitchUserId: string } | null;
}

interface ExistingStreamer {
  id: string;
  twitchUserId: string;
}

// P1 Fix: 每小時第 30 分鐘執行（錯開 channelStatsSyncJob 的第 10 分鐘執行）
const SYNC_FOLLOWS_CRON = process.env.SYNC_FOLLOWS_CRON || "30 * * * *";

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
    logger.info("Jobs", `📋 Sync User Follows Job 已排程: ${SYNC_FOLLOWS_CRON}`);

    cron.schedule(SYNC_FOLLOWS_CRON, async () => {
      await this.execute();
    });
  }

  /**
   * 執行追蹤名單同步
   */
  async execute(): Promise<SyncUserFollowsResult> {
    if (this.isRunning) {
      logger.debug("Jobs", "Sync User Follows Job 正在執行中，跳過...");
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
    logger.debug("Jobs", "開始同步使用者追蹤名單...");

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
      logger.debug("Jobs", `找到 ${usersWithFollowScope.length} 個有追蹤權限的使用者`);

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
            logger.error("Jobs", `同步使用者 ${user.twitchUserId} 追蹤名單失敗`, error);
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
      refreshToken: string | null;
      expiresAt: Date | null;
      tokenId: string;
    }>
  > {
    const users: Array<{
      id: string;
      twitchUserId: string;
      userType: "streamer" | "viewer";
      accessToken: string;
      refreshToken: string | null;
      expiresAt: Date | null;
      tokenId: string;
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
          refreshToken: token.refreshToken,
          expiresAt: token.expiresAt,
          tokenId: token.id,
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
          refreshToken: token.refreshToken,
          expiresAt: token.expiresAt,
          tokenId: token.id,
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
    refreshToken: string | null;
    expiresAt: Date | null;
    tokenId: string;
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

    // 1. 從 Twitch 獲取追蹤名單 (使用完整 Token 資訊以支援自動刷新)
    const decryptedAccessToken = decryptToken(user.accessToken);
    const decryptedRefreshToken = user.refreshToken ? decryptToken(user.refreshToken) : "";

    // 使用 tokenInfo 參數以支援 Token 自動刷新
    const followedChannels = await twurpleHelixService.getFollowedChannels(
      user.twitchUserId,
      undefined, // 不使用舊的 userAccessToken 參數
      {
        accessToken: decryptedAccessToken,
        refreshToken: decryptedRefreshToken,
        expiresAt: user.expiresAt,
        tokenId: user.tokenId,
      }
    );

    // 2. 獲取目前資料庫中的追蹤記錄
    const existingFollows = await prisma.userFollow.findMany({
      where: { userId: user.id },
      include: { channel: true },
    });

    const existingFollowMap = new Map(
      existingFollows.map((f: ExistingFollow) => [f.channel.twitchChannelId, f])
    );

    // 3. 批量獲取現有資料（消除 N+1 查詢）
    const broadcasterIds = followedChannels.map((f) => f.broadcasterId);

    const existingChannels = await prisma.channel.findMany({
      where: { twitchChannelId: { in: broadcasterIds } },
      include: { streamer: true },
    });

    const existingChannelMap = new Map<string, ExistingChannel>(
      existingChannels.map((ch: ExistingChannel) => [ch.twitchChannelId, ch])
    );

    const existingStreamers = await prisma.streamer.findMany({
      where: { twitchUserId: { in: broadcasterIds } },
    });

    const existingStreamerMap = new Map<string, ExistingStreamer>(
      existingStreamers.map((s: ExistingStreamer) => [s.twitchUserId, s])
    );

    // 4. 找出需要更新頭貼的現有 Streamers
    const streamersNeedingUpdate: ExistingStreamer[] = [];
    for (const streamer of existingStreamers) {
      if (!streamer.avatarUrl || streamer.avatarUrl === "") {
        streamersNeedingUpdate.push(streamer);
      }
    }

    // 5. 批量抓取需要更新的 Streamers 資料
    if (streamersNeedingUpdate.length > 0) {
      try {
        const idsToFetch = streamersNeedingUpdate.map((s) => s.twitchUserId);
        const twitchUsers = await twurpleHelixService.getUsersByIds(idsToFetch);
        const userMap = new Map(twitchUsers.map((u) => [u.id, u]));

        // 批量更新
        const updatePromises = streamersNeedingUpdate.map((streamer) => {
          const twitchUser = userMap.get(streamer.twitchUserId);
          if (twitchUser) {
            return prisma.streamer.update({
              where: { id: streamer.id },
              data: {
                displayName: twitchUser.displayName,
                avatarUrl: twitchUser.profileImageUrl,
              },
            });
          }
          return Promise.resolve();
        });

        await Promise.all(updatePromises);
        logger.info(
          "SyncFollows",
          `已更新 ${streamersNeedingUpdate.length} 個現有 Streamer 的頭貼和名稱`
        );
      } catch (error) {
        logger.warn("SyncFollows", "更新現有 Streamer 資料失敗", error);
      }
    }

    // 6. 準備批量操作資料
    const streamersToUpsert: Array<{
      twitchUserId: string;
      displayName: string;
      avatarUrl: string;
    }> = [];
    const channelsToCreate: Array<{
      twitchChannelId: string;
      channelName: string;
      channelUrl: string;
      broadcasterLogin: string;
    }> = [];
    const channelsToUpdate: string[] = [];

    for (const follow of followedChannels) {
      const existingFollow = existingFollowMap.get(follow.broadcasterId);

      if (existingFollow) {
        existingFollowMap.delete(follow.broadcasterId);
      } else {
        const channel = existingChannelMap.get(follow.broadcasterId);

        if (!channel) {
          if (!existingStreamerMap.has(follow.broadcasterId)) {
            streamersToUpsert.push({
              twitchUserId: follow.broadcasterId,
              displayName: follow.broadcasterLogin,
              avatarUrl: "",
            });
          }

          channelsToCreate.push({
            twitchChannelId: follow.broadcasterId,
            channelName: follow.broadcasterLogin,
            channelUrl: `https://www.twitch.tv/${follow.broadcasterLogin}`,
            broadcasterLogin: follow.broadcasterLogin,
          });
        } else if (!channel.isMonitored) {
          channelsToUpdate.push(channel.id);
        }
      }
    }

    // 7. 批量抓取新 Streamer 的完整資料（頭貼、顯示名稱）
    if (streamersToUpsert.length > 0) {
      try {
        const twitchIds = streamersToUpsert.map((s) => s.twitchUserId);
        const twitchUsers = await twurpleHelixService.getUsersByIds(twitchIds);

        // 更新 streamersToUpsert 的資料
        const userMap = new Map(twitchUsers.map((u) => [u.id, u]));
        for (const streamerData of streamersToUpsert) {
          const twitchUser = userMap.get(streamerData.twitchUserId);
          if (twitchUser) {
            streamerData.displayName = twitchUser.displayName;
            streamerData.avatarUrl = twitchUser.profileImageUrl;
          }
        }

        logger.info(
          "SyncFollows",
          `已抓取 ${twitchUsers.length}/${twitchIds.length} 個新 Streamer 的完整資料`
        );
      } catch (error) {
        logger.warn("SyncFollows", "抓取 Streamer 資料失敗，使用預設值", error);
      }
    }

    // 8. 批量執行資料庫操作
    await prisma.$transaction(async (tx: TransactionClient) => {
      for (const streamerData of streamersToUpsert) {
        const upserted = await tx.streamer.upsert({
          where: { twitchUserId: streamerData.twitchUserId },
          create: streamerData,
          update: {
            displayName: streamerData.displayName,
            avatarUrl: streamerData.avatarUrl,
          },
        });
        existingStreamerMap.set(upserted.twitchUserId, upserted);
      }

      for (const channelData of channelsToCreate) {
        const streamer = existingStreamerMap.get(channelData.twitchChannelId);
        if (streamer) {
          const channel = await tx.channel.create({
            data: {
              twitchChannelId: channelData.twitchChannelId,
              channelName: channelData.channelName,
              channelUrl: channelData.channelUrl,
              source: "external",
              isMonitored: true,
              streamer: {
                connect: { id: streamer.id },
              },
            },
            include: {
              streamer: true,
            },
          });
          existingChannelMap.set(channel.twitchChannelId, channel);
          result.channelsCreated++;
        }
      }

      if (channelsToUpdate.length > 0) {
        await tx.channel.updateMany({
          where: { id: { in: channelsToUpdate } },
          data: { isMonitored: true },
        });
      }
    });

    // 6. 批量建立 UserFollow 記錄
    const followsToCreate: Array<{
      userId: string;
      userType: "streamer" | "viewer";
      channelId: string;
      followedAt: Date;
    }> = [];

    for (const follow of followedChannels) {
      if (!existingFollowMap.has(follow.broadcasterId)) {
        const channel = existingChannelMap.get(follow.broadcasterId);
        if (channel) {
          followsToCreate.push({
            userId: user.id,
            userType: user.userType,
            channelId: channel.id,
            followedAt: follow.followedAt,
          });
        }
      }
    }

    // 使用原生 SQL 批次 upsert，降低 DB 寫入成本
    // 記憶體優化：每 100 筆為一批，讓 GC 有機會回收
    const UPSERT_BATCH_SIZE = 100;
    for (let i = 0; i < followsToCreate.length; i += UPSERT_BATCH_SIZE) {
      const batch = followsToCreate.slice(i, i + UPSERT_BATCH_SIZE);

      try {
        const rows = batch.map((followData) =>
          Prisma.sql`(${randomUUID()}, ${followData.userId}, ${followData.userType}, ${
            followData.channelId
          }, ${followData.followedAt})`
        );

        await prisma.$executeRaw(
          Prisma.sql`
            INSERT INTO user_follows (id, userId, userType, channelId, followedAt)
            VALUES ${Prisma.join(rows)}
            ON CONFLICT(userId, channelId) DO UPDATE SET followedAt=excluded.followedAt
          `
        );

        // followsToCreate 已排除 existingFollowMap，因此可視為新增
        result.followsCreated += batch.length;
      } catch (error) {
        logger.warn(
          "Jobs",
          `批次 upsert 失敗 (${i}/${followsToCreate.length}):`,
          error instanceof Error ? error.message : String(error)
        );
      }

      if (i + UPSERT_BATCH_SIZE < followsToCreate.length) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }

    // 7. 批量刪除不再追蹤的記錄
    const followIdsToDelete = Array.from(existingFollowMap.values()).map(
      (f: ExistingFollow) => f.id
    );
    if (followIdsToDelete.length > 0) {
      await prisma.userFollow.deleteMany({
        where: { id: { in: followIdsToDelete } },
      });
      result.followsRemoved = followIdsToDelete.length;
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
      },
      select: { id: true },
    });

    if (orphanedChannels.length === 0) {
      return 0;
    }

    // 使用 updateMany 批次更新（修復 N+1 問題）
    const orphanedIds = orphanedChannels.map((c: { id: string }) => c.id);
    await prisma.channel.updateMany({
      where: { id: { in: orphanedIds } },
      data: { isMonitored: false },
    });

    logger.info("Jobs", `🧹 停用 ${orphanedChannels.length} 個無人追蹤的外部頻道`);

    return orphanedChannels.length;
  }

  /**
   * 獲取目前監控中的頻道總數
   */
  private async getMonitoredChannelCount(): Promise<number> {
    const count = await prisma.channel.count({
      where: { isMonitored: true },
    });
    return count;
  }
}

// 匯出單例
export const syncUserFollowsJob = new SyncUserFollowsJob();

// Additional types for triggerFollowSyncForUser
interface TriggerExistingFollow {
  id: string;
  channel: { twitchChannelId: string };
}

interface TriggerExistingChannel {
  id: string;
  twitchChannelId: string;
  isMonitored: boolean;
  streamerId: string | null;
}

interface TriggerExistingStreamer {
  id: string;
  twitchUserId: string;
  avatarUrl?: string | null;
}

/**
 * 為單一使用者觸發追蹤名單同步（登入時使用）
 * 同步所有追蹤頻道，使用批次處理避免記憶體過載
 * @param viewerId - Viewer ID
 * @param accessToken - 使用者的 Twitch Access Token (已解密)
 */
export async function triggerFollowSyncForUser(
  viewerId: string,
  accessToken: string
): Promise<void> {
  // 批次處理大小（每處理 N 個頻道休息一下讓 GC 工作）
  const BATCH_SIZE = 20;

  try {
    logger.info("Jobs", `🔄 登入後同步使用者追蹤名單: ${viewerId}`);

    // 獲取 Viewer 的 Twitch User ID
    const viewer = await prisma.viewer.findUnique({
      where: { id: viewerId },
      select: { twitchUserId: true },
    });

    if (!viewer) {
      logger.warn("Jobs", `找不到 Viewer: ${viewerId}`);
      return;
    }

    // 呼叫 Twurple API 獲取所有追蹤清單（不限制數量）
    const followedChannels = await twurpleHelixService.getFollowedChannels(
      viewer.twitchUserId,
      accessToken
    );

    logger.info("Jobs", `📋 從 Twitch 取得 ${followedChannels.length} 個追蹤頻道`);

    // 獲取現有的追蹤記錄
    const existingFollows = await prisma.userFollow.findMany({
      where: {
        userId: viewerId,
        userType: "viewer",
      },
      select: {
        id: true,
        channel: { select: { twitchChannelId: true } },
      },
    });

    const existingFollowMap = new Map<string, TriggerExistingFollow>(
      existingFollows.map((f: TriggerExistingFollow) => [f.channel.twitchChannelId, f])
    );

    // P1 Fix: 批次查詢所有頻道，避免 N+1 查詢問題
    const allBroadcasterIds = followedChannels.map((f) => f.broadcasterId);
    const existingChannels = await prisma.channel.findMany({
      where: { twitchChannelId: { in: allBroadcasterIds } },
      select: { id: true, twitchChannelId: true, isMonitored: true, streamerId: true },
    });
    const existingChannelMap = new Map<string, TriggerExistingChannel>(
      existingChannels.map((c: TriggerExistingChannel) => [c.twitchChannelId, c])
    );

    // P1 Fix: 批次查詢所有 Streamer，避免 N+1 查詢問題
    const existingStreamers = await prisma.streamer.findMany({
      where: { twitchUserId: { in: allBroadcasterIds } },
      select: { id: true, twitchUserId: true, avatarUrl: true },
    });
    const existingStreamerMap = new Map<string, TriggerExistingStreamer & { avatarUrl?: string | null }>(
      existingStreamers.map((s) => [s.twitchUserId, s])
    );

    // 修復：找出需要更新頭貼的現有 Streamers
    const streamersNeedingUpdate = existingStreamers.filter(
      (s) => !s.avatarUrl || s.avatarUrl === ""
    );

    // 批量抓取需要更新的 Streamers 資料
    if (streamersNeedingUpdate.length > 0) {
      try {
        const idsToFetch = streamersNeedingUpdate.map((s) => s.twitchUserId);
        const twitchUsers = await twurpleHelixService.getUsersByIds(idsToFetch);
        const userMap = new Map(twitchUsers.map((u) => [u.id, u]));

        // 批量更新
        const updatePromises = streamersNeedingUpdate.map((streamer) => {
          const twitchUser = userMap.get(streamer.twitchUserId);
          if (twitchUser) {
            return prisma.streamer.update({
              where: { id: streamer.id },
              data: {
                displayName: twitchUser.displayName,
                avatarUrl: twitchUser.profileImageUrl,
              },
            });
          }
          return Promise.resolve();
        });

        await Promise.all(updatePromises);
        logger.info(
          "Jobs",
          `✅ 已更新 ${streamersNeedingUpdate.length} 個現有 Streamer 的頭貼和名稱`
        );
      } catch (error) {
        logger.warn("Jobs", "更新現有 Streamer 資料失敗", error);
      }
    }

    let created = 0;
    let removed = 0;
    let processed = 0;
    const followsToUpsert: Array<{
      userId: string;
      userType: "viewer";
      channelId: string;
      followedAt: Date;
    }> = [];

    // 收集所有新建立的 streamers，稍後批次抓取資料
    const newStreamerIds: string[] = [];

    // 處理每個追蹤的頻道（批次處理）
    for (const follow of followedChannels) {
      try {
        const existingFollow = existingFollowMap.get(follow.broadcasterId);

        // P1 Fix: 使用預先載入的 Map，避免 N+1 查詢
        const existingChannel = existingChannelMap.get(follow.broadcasterId);

        let channelId = existingChannel?.id;
        let streamerId = existingChannel?.streamerId;

        // 如果頻道不存在，或者需要更新監控狀態
        if (!existingChannel || !existingChannel.isMonitored) {
          // 確保 Streamer 存在
          if (!existingChannel) {
            // P1 Fix: 先檢查 Map，避免查詢
            let streamer = existingStreamerMap.get(follow.broadcasterId);

            if (!streamer) {
              const displayName = follow.broadcasterLogin;
              const newStreamer = await prisma.streamer.upsert({
                where: { twitchUserId: follow.broadcasterId },
                create: {
                  twitchUserId: follow.broadcasterId,
                  displayName,
                  avatarUrl: "",
                },
                update: {},
              });
              streamer = { id: newStreamer.id, twitchUserId: newStreamer.twitchUserId };
              // 加入 Map 以便後續使用
              existingStreamerMap.set(follow.broadcasterId, streamer);
              // 記錄新建立的 streamer ID，稍後批次抓取資料
              newStreamerIds.push(follow.broadcasterId);
            }
            streamerId = streamer.id;
          }

          // 建立或更新頻道
          // P0 Fix: 確保 streamerId 存在，避免 N+1 查詢
          const resolvedStreamerId = streamerId || existingStreamerMap.get(follow.broadcasterId)?.id;
          
          if (!resolvedStreamerId) {
            logger.warn("Jobs", `無法解析 streamerId for ${follow.broadcasterLogin}, 跳過此頻道`);
            continue;
          }

          const channel = await prisma.channel.upsert({
            where: { twitchChannelId: follow.broadcasterId },
            create: {
              twitchChannelId: follow.broadcasterId,
              channelName: follow.broadcasterLogin,
              channelUrl: `https://www.twitch.tv/${follow.broadcasterLogin}`,
              source: "external",
              isMonitored: true,
              streamerId: resolvedStreamerId,
            },
            update: {
              channelName: follow.broadcasterLogin,
              isMonitored: true,
            },
          });
          channelId = channel.id;
          // 加入 Map 以便後續使用
          existingChannelMap.set(follow.broadcasterId, {
            id: channel.id,
            twitchChannelId: channel.twitchChannelId,
            isMonitored: true,
            streamerId: channel.streamerId,
          });
        }

        if (!channelId) {
          throw new Error(`Failed to resolve channelId for ${follow.broadcasterLogin}`);
        }

        if (existingFollow) {
          // 已存在的追蹤，從 map 中移除（避免被刪除）
          existingFollowMap.delete(follow.broadcasterId);
        } else {
          // 新追蹤：先收集，稍後批次 upsert
          followsToUpsert.push({
            userId: viewerId,
            userType: "viewer",
            channelId: channelId,
            followedAt: follow.followedAt,
          });
        }
      } catch (err) {
        logger.warn("Jobs", `同步頻道 ${follow.broadcasterLogin} 失敗`, err);
        // Continue to verify next channel even if one fails
      }

      processed++;

      // 每處理 BATCH_SIZE 個頻道，等待一下讓系統喘息
      if (processed % BATCH_SIZE === 0) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    // 批次建立追蹤記錄（避免逐筆寫入）
    const UPSERT_BATCH_SIZE = 50;
    for (let i = 0; i < followsToUpsert.length; i += UPSERT_BATCH_SIZE) {
      const batch = followsToUpsert.slice(i, i + UPSERT_BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map((followData) =>
          prisma.userFollow.upsert({
            where: {
              userId_channelId: {
                userId: followData.userId,
                channelId: followData.channelId,
              },
            },
            create: followData,
            update: { followedAt: followData.followedAt },
          })
        )
      );

      created += results.filter((r) => r.status === "fulfilled").length;

      const failures = results.filter((r) => r.status === "rejected");
      if (failures.length > 0) {
        logger.warn("Jobs", `批次 upsert 有 ${failures.length} 筆失敗`);
      }

      if (i + UPSERT_BATCH_SIZE < followsToUpsert.length) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }

    // 修復：批量抓取新建立 Streamers 的完整資料（頭貼、顯示名稱）
    if (newStreamerIds.length > 0) {
      try {
        const twitchUsers = await twurpleHelixService.getUsersByIds(newStreamerIds);
        const userMap = new Map(twitchUsers.map((u) => [u.id, u]));

        // 批量更新新建立的 streamers
        const updatePromises = newStreamerIds.map((twitchUserId) => {
          const twitchUser = userMap.get(twitchUserId);
          if (twitchUser) {
            return prisma.streamer.update({
              where: { twitchUserId },
              data: {
                displayName: twitchUser.displayName,
                avatarUrl: twitchUser.profileImageUrl,
              },
            });
          }
          return Promise.resolve();
        });

        await Promise.all(updatePromises);
        logger.info(
          "Jobs",
          `✅ 已抓取 ${twitchUsers.length}/${newStreamerIds.length} 個新 Streamer 的完整資料`
        );
      } catch (error) {
        logger.warn("Jobs", "抓取新 Streamer 資料失敗，使用預設值", error);
      }
    }

    // 批次刪除不再追蹤的記錄（修復 N+1 問題）
    const oldFollowIds = Array.from(existingFollowMap.values()).map(
      (f: TriggerExistingFollow) => f.id
    );
    if (oldFollowIds.length > 0) {
      await prisma.userFollow.deleteMany({
        where: { id: { in: oldFollowIds } },
      });
      removed = oldFollowIds.length;
    }

    logger.info("Jobs", `✅ 追蹤同步完成: 新增 ${created}, 移除 ${removed}`);

    // 清除該用戶的 channels_list 快取，確保下次刷新頁面能看到最新資料
    const cacheKey = `viewer:${viewerId}:channels_list`;
    cacheManager.delete(cacheKey);
    logger.debug("Jobs", `已清除快取: ${cacheKey}`);

    // 立即觸發開台狀態更新，確保使用者登入後能看到最新的開台狀態
    try {
      const { updateLiveStatusFn } = await import("./update-live-status.job");
      await updateLiveStatusFn();
      logger.info("Jobs", "✅ 開台狀態已即時更新");
    } catch (updateError) {
      logger.warn("Jobs", "登入後開台狀態更新失敗（不影響主流程）", updateError);
    }
  } catch (error) {
    logger.error("Jobs", "追蹤同步失敗", error);
    throw error;
  }
}
