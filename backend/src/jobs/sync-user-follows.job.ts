/**
 * Sync User Follows Job
 * 定時同步使用者的 Twitch 追蹤名單 (使用 Twurple)
 *
 * Story 3.6: 使用者追蹤頻道與全域監控
 */

import cron from "node-cron";
import { randomUUID } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { twurpleHelixService } from "../services/twitch-helix.service";
import { logger } from "../utils/logger";
import { decryptToken } from "../utils/crypto.utils";
import { cacheManager } from "../utils/cache-manager";
import { retryDatabaseOperation } from "../utils/db-retry";
import {
  recordJobFailure,
  recordJobSuccess,
  shouldSkipForCircuitBreaker,
} from "../utils/job-circuit-breaker";
import { importPLimit } from "../utils/esm-import";
import { isRedisEnabled, redisGetJson, redisSetJson } from "../utils/redis-client";
import { refreshViewerChannelSummaryForViewer } from "../modules/viewer/viewer.service";

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
}

interface ExistingStreamer {
  id: string;
  twitchUserId: string;
  avatarUrl?: string | null;
}

interface TwitchUserProfile {
  id: string;
  displayName: string;
  profileImageUrl: string;
}

type StreamerProfileRecord = {
  twitchUserId: string;
  displayName: string;
  avatarUrl: string;
};

type FollowedChannelRecord = {
  broadcasterId: string;
  broadcasterLogin: string;
  followedAt: Date;
};

const FOLLOW_LOOKUP_CHUNK_SIZE = 200;

function chunkArray<T>(items: T[], size: number): T[][] {
  if (items.length === 0) {
    return [];
  }

  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function fetchTwitchUserProfileMapByIds(
  twitchUserIds: string[]
): Promise<Map<string, TwitchUserProfile>> {
  if (twitchUserIds.length === 0) {
    return new Map();
  }

  const users = await twurpleHelixService.getUsersByIds(twitchUserIds);
  return new Map(
    users.map((user) => [
      user.id,
      {
        id: user.id,
        displayName: user.displayName,
        profileImageUrl: user.profileImageUrl,
      },
    ])
  );
}

async function backfillExistingStreamerProfiles(
  streamers: Array<{ id: string; twitchUserId: string }>
): Promise<number> {
  if (streamers.length === 0) {
    return 0;
  }

  const userMap = await fetchTwitchUserProfileMapByIds(streamers.map((s) => s.twitchUserId));
  const updates: Array<{ id: string; displayName: string; avatarUrl: string }> = [];
  for (const streamer of streamers) {
    const profile = userMap.get(streamer.twitchUserId);
    if (!profile) {
      continue;
    }

    updates.push({
      id: streamer.id,
      displayName: profile.displayName,
      avatarUrl: profile.profileImageUrl,
    });
  }

  const UPDATE_BATCH_SIZE = 200;
  for (let i = 0; i < updates.length; i += UPDATE_BATCH_SIZE) {
    const batch = updates.slice(i, i + UPDATE_BATCH_SIZE);
    await Promise.all(
      batch.map((update) =>
        prisma.streamer.update({
          where: { id: update.id },
          data: {
            displayName: update.displayName,
            avatarUrl: update.avatarUrl,
          },
        })
      )
    );
  }

  return updates.length;
}

function hydrateStreamerProfileRecords(
  records: Iterable<StreamerProfileRecord>,
  profileMap: Map<string, TwitchUserProfile>
): number {
  let hydratedCount = 0;

  for (const record of records) {
    const profile = profileMap.get(record.twitchUserId);
    if (!profile) {
      continue;
    }

    record.displayName = profile.displayName;
    record.avatarUrl = profile.profileImageUrl;
    hydratedCount += 1;
  }

  return hydratedCount;
}

// P1 Fix: 每小時第 30 分鐘執行（錯開 channelStatsSyncJob 的第 10 分鐘執行）
const SYNC_FOLLOWS_CRON = process.env.SYNC_FOLLOWS_CRON || "50 * * * *";

// 並發控制：同時最多處理 5 個使用者
const CONCURRENCY_LIMIT = 5;
const TOKEN_QUERY_BATCH_SIZE = 200;
const DB_JITTER_MAX_MS = Number.parseInt(process.env.SYNC_USER_FOLLOWS_DB_JITTER_MAX_MS || "5000", 10);
const JOB_CIRCUIT_BREAKER_NAME = "sync-user-follows";
const DB_RETRY_OPTIONS = {
  maxRetries: 4,
  initialDelayMs: 400,
  maxDelayMs: 6000,
  backoffMultiplier: 2,
  jitterMs: 300,
};
const SUMMARY_REFRESH_DEBOUNCE_MS = Number(process.env.SUMMARY_REFRESH_DEBOUNCE_MS || 30000);
const SUMMARY_REFRESH_BATCH_SIZE = Number(process.env.SUMMARY_REFRESH_BATCH_SIZE || 50);
const SUMMARY_REFRESH_CONCURRENCY = Number(process.env.SUMMARY_REFRESH_CONCURRENCY || 4);
const LIVE_STATUS_REFRESH_DEBOUNCE_MS = Number(
  process.env.LIVE_STATUS_REFRESH_DEBOUNCE_MS || 20000
);
const FOLLOW_SYNC_MAINTENANCE_STATE_PATH = path.join(
  process.cwd(),
  "tmp",
  "follow-sync-maintenance-state.json"
);
const FOLLOW_SYNC_MAINTENANCE_STATE_CACHE_KEY = "jobs:follow-sync:maintenance-state";
const FOLLOW_SYNC_MAINTENANCE_STATE_TTL_SECONDS = 24 * 60 * 60;

const pendingSummaryRefreshViewerIds = new Set<string>();
let summaryRefreshTimer: NodeJS.Timeout | null = null;
let liveStatusRefreshTimer: NodeJS.Timeout | null = null;
let isLiveStatusRefreshing = false;
let maintenanceStateLoaded = false;
let maintenanceStateLoading: Promise<void> | null = null;
let maintenanceStatePersisting = false;
let maintenanceStatePersistQueued = false;

async function ensureMaintenanceStateLoaded(): Promise<void> {
  if (maintenanceStateLoaded) {
    return;
  }

  if (maintenanceStateLoading) {
    await maintenanceStateLoading;
    return;
  }

  maintenanceStateLoading = (async () => {
    try {
      let parsed: {
        pendingSummaryViewerIds?: string[];
        liveStatusRefreshPending?: boolean;
      } | null = null;

      if (isRedisEnabled()) {
        parsed = await redisGetJson<{
          pendingSummaryViewerIds?: string[];
          liveStatusRefreshPending?: boolean;
        }>(FOLLOW_SYNC_MAINTENANCE_STATE_CACHE_KEY);
      }

      if (!parsed) {
        const raw = await readFile(FOLLOW_SYNC_MAINTENANCE_STATE_PATH, "utf8");
        parsed = JSON.parse(raw) as {
          pendingSummaryViewerIds?: string[];
          liveStatusRefreshPending?: boolean;
        };
      }

      for (const viewerId of parsed.pendingSummaryViewerIds ?? []) {
        if (viewerId) {
          pendingSummaryRefreshViewerIds.add(viewerId);
        }
      }

      if (parsed.liveStatusRefreshPending) {
        scheduleLiveStatusRefresh();
      }
    } catch {
      // ignore if state file does not exist or invalid
    } finally {
      maintenanceStateLoaded = true;
    }
  })();

  await maintenanceStateLoading;
  maintenanceStateLoading = null;
}

async function persistMaintenanceState(): Promise<void> {
  if (maintenanceStatePersisting) {
    maintenanceStatePersistQueued = true;
    return;
  }

  maintenanceStatePersisting = true;
  try {
    const statePayload = {
      pendingSummaryViewerIds: Array.from(pendingSummaryRefreshViewerIds),
      liveStatusRefreshPending: Boolean(liveStatusRefreshTimer) || isLiveStatusRefreshing,
    };

    if (isRedisEnabled()) {
      await redisSetJson(
        FOLLOW_SYNC_MAINTENANCE_STATE_CACHE_KEY,
        statePayload,
        FOLLOW_SYNC_MAINTENANCE_STATE_TTL_SECONDS
      );
    }

    await mkdir(path.dirname(FOLLOW_SYNC_MAINTENANCE_STATE_PATH), { recursive: true });
    await writeFile(
      FOLLOW_SYNC_MAINTENANCE_STATE_PATH,
      JSON.stringify(statePayload, null, 2),
      "utf8"
    );
  } catch (error) {
    logger.warn("Jobs", "無法持久化 follow-sync 維護狀態", error);
  } finally {
    maintenanceStatePersisting = false;
    if (maintenanceStatePersistQueued) {
      maintenanceStatePersistQueued = false;
      await persistMaintenanceState();
    }
  }
}

async function flushPendingSummaryRefreshes(): Promise<void> {
  await ensureMaintenanceStateLoaded();

  if (pendingSummaryRefreshViewerIds.size === 0) {
    await persistMaintenanceState();
    return;
  }

  const viewerIds = Array.from(pendingSummaryRefreshViewerIds);
  pendingSummaryRefreshViewerIds.clear();

  const { default: pLimit } = await importPLimit();
  const limit = pLimit(Math.max(1, SUMMARY_REFRESH_CONCURRENCY));

  for (let i = 0; i < viewerIds.length; i += SUMMARY_REFRESH_BATCH_SIZE) {
    const batch = viewerIds.slice(i, i + SUMMARY_REFRESH_BATCH_SIZE);
    await Promise.all(
      batch.map((viewerId) =>
        limit(async () => {
          try {
            await refreshViewerChannelSummaryForViewer(viewerId);
            await cacheManager.invalidateTag(`viewer:${viewerId}`);
          } catch (error) {
            logger.warn("Jobs", `刷新 viewer summary 失敗: ${viewerId}`, error);
          }
        })
      )
    );
  }

  await persistMaintenanceState();
}

function scheduleSummaryRefresh(viewerId: string): void {
  void ensureMaintenanceStateLoaded().catch((err) =>
    logger.warn("Jobs", "ensureMaintenanceStateLoaded failed in scheduleSummaryRefresh", err)
  );
  pendingSummaryRefreshViewerIds.add(viewerId);
  void persistMaintenanceState().catch((err) =>
    logger.warn("Jobs", "persistMaintenanceState failed in scheduleSummaryRefresh", err)
  );

  if (summaryRefreshTimer) {
    return;
  }

  summaryRefreshTimer = setTimeout(() => {
    summaryRefreshTimer = null;
    void flushPendingSummaryRefreshes().catch((err) =>
      logger.warn("Jobs", "flushPendingSummaryRefreshes failed in timer callback", err)
    );
  }, SUMMARY_REFRESH_DEBOUNCE_MS);

  summaryRefreshTimer.unref?.();
}

async function flushLiveStatusRefresh(): Promise<void> {
  await ensureMaintenanceStateLoaded();

  if (isLiveStatusRefreshing) {
    return;
  }

  isLiveStatusRefreshing = true;
  try {
    const { updateLiveStatusFn } = await import("./update-live-status.job");
    await updateLiveStatusFn();
    logger.info("Jobs", "✅ 已批次觸發開台狀態更新");
  } catch (error) {
    logger.warn("Jobs", "批次開台狀態更新失敗（不影響主流程）", error);
  } finally {
    isLiveStatusRefreshing = false;
    await persistMaintenanceState();
  }
}

function scheduleLiveStatusRefresh(): void {
  void ensureMaintenanceStateLoaded().catch((err) =>
    logger.warn("Jobs", "ensureMaintenanceStateLoaded failed in scheduleLiveStatusRefresh", err)
  );

  if (liveStatusRefreshTimer) {
    return;
  }

  void persistMaintenanceState().catch((err) =>
    logger.warn("Jobs", "persistMaintenanceState failed in scheduleLiveStatusRefresh", err)
  );

  liveStatusRefreshTimer = setTimeout(() => {
    liveStatusRefreshTimer = null;
    void flushLiveStatusRefresh().catch((err) =>
      logger.warn("Jobs", "flushLiveStatusRefresh failed in timer callback", err)
    );
  }, LIVE_STATUS_REFRESH_DEBOUNCE_MS);

  liveStatusRefreshTimer.unref?.();
}

export async function flushPendingFollowSyncMaintenance(): Promise<void> {
  await ensureMaintenanceStateLoaded();

  if (summaryRefreshTimer) {
    clearTimeout(summaryRefreshTimer);
    summaryRefreshTimer = null;
  }

  if (liveStatusRefreshTimer) {
    clearTimeout(liveStatusRefreshTimer);
    liveStatusRefreshTimer = null;
  }

  await flushPendingSummaryRefreshes();
  await flushLiveStatusRefresh();
  await persistMaintenanceState();
}

export function initializeFollowSyncMaintenance(): void {
  void ensureMaintenanceStateLoaded().catch((err) =>
    logger.warn("Jobs", "ensureMaintenanceStateLoaded failed in initializeFollowSyncMaintenance", err)
  );
}

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

  private async withDbRetry<T>(operation: () => Promise<T>): Promise<T> {
    return retryDatabaseOperation(operation, DB_RETRY_OPTIONS);
  }

  /**
   * 啟動 Cron Job
   */
  start(): void {
    logger.info("Jobs", `📋 Sync User Follows Job 已排程: ${SYNC_FOLLOWS_CRON}`);

    cron.schedule(SYNC_FOLLOWS_CRON, async () => {
      if (DB_JITTER_MAX_MS > 0) {
        const jitterMs = Math.floor(Math.random() * DB_JITTER_MAX_MS);
        if (jitterMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, jitterMs));
        }
      }
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

    if (shouldSkipForCircuitBreaker(JOB_CIRCUIT_BREAKER_NAME)) {
      logger.warn("Jobs", "Sync User Follows Job 暫停中（circuit breaker），跳過本輪");
      this.isRunning = false;
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
      const { default: pLimit } = await importPLimit();
      const limit = pLimit(CONCURRENCY_LIMIT);

      const USER_CHUNK_SIZE = 100;
      for (let i = 0; i < usersWithFollowScope.length; i += USER_CHUNK_SIZE) {
        const userChunk = usersWithFollowScope.slice(i, i + USER_CHUNK_SIZE);
        const taskResults = await Promise.all(
          userChunk.map((user) =>
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
          )
        );

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

      recordJobSuccess(JOB_CIRCUIT_BREAKER_NAME);

      return result;
    } catch (error) {
      result.executionTimeMs = Date.now() - startTime;
      logger.error("Jobs", "❌ Sync User Follows Job 執行失敗", error);
      recordJobFailure(JOB_CIRCUIT_BREAKER_NAME, error);
      result.usersFailed += 1;
      return result;
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

    // 獲取有 user:read:follows scope 的 Streamer tokens（分頁）
    // 注意：統一登入後，streamer token 也會有 viewerId
    let streamerCursorId: string | undefined;
    while (true) {
      const streamerTokens = await this.withDbRetry(() =>
        prisma.twitchToken.findMany({
        where: {
          ownerType: "streamer",
          streamerId: { not: null },
          scopes: { contains: "user:read:follows" },
        },
        include: { streamer: true, viewer: true },
        orderBy: { id: "asc" },
        take: TOKEN_QUERY_BATCH_SIZE,
        ...(streamerCursorId
          ? {
              cursor: { id: streamerCursorId },
              skip: 1,
            }
          : {}),
        })
      );

      if (streamerTokens.length === 0) {
        break;
      }

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

      streamerCursorId = streamerTokens[streamerTokens.length - 1]?.id;
      if (streamerTokens.length < TOKEN_QUERY_BATCH_SIZE) {
        break;
      }
    }

    // 獲取有 user:read:follows scope 的 Viewer tokens（分頁）
    let viewerCursorId: string | undefined;
    while (true) {
      const viewerTokens = await this.withDbRetry(() =>
        prisma.twitchToken.findMany({
        where: {
          ownerType: "viewer",
          viewerId: { not: null },
          scopes: { contains: "user:read:follows" },
        },
        include: { viewer: true },
        orderBy: { id: "asc" },
        take: TOKEN_QUERY_BATCH_SIZE,
        ...(viewerCursorId
          ? {
              cursor: { id: viewerCursorId },
              skip: 1,
            }
          : {}),
        })
      );

      if (viewerTokens.length === 0) {
        break;
      }

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

      viewerCursorId = viewerTokens[viewerTokens.length - 1]?.id;
      if (viewerTokens.length < TOKEN_QUERY_BATCH_SIZE) {
        break;
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

    // 2. 獲取目前資料庫中的追蹤記錄（只 select 需要的欄位以減少記憶體）
    const existingFollows = await this.withDbRetry(() =>
      prisma.userFollow.findMany({
      where: { userId: user.id },
      select: {
        id: true,
        channel: { select: { twitchChannelId: true } },
      },
      })
    );

    const existingFollowMap = new Map(
      existingFollows.map((f: ExistingFollow) => [f.channel.twitchChannelId, f])
    );

    // 3. 批量獲取現有資料（消除 N+1 查詢）
    const broadcasterIds = Array.from(new Set(followedChannels.map((f) => f.broadcasterId)));
    const existingChannelMap = new Map<string, ExistingChannel>();
    const existingStreamerMap = new Map<string, ExistingStreamer>();
    const existingStreamers: ExistingStreamer[] = [];

    for (const idChunk of chunkArray(broadcasterIds, FOLLOW_LOOKUP_CHUNK_SIZE)) {
      const [channelChunk, streamerChunk] = await Promise.all([
        this.withDbRetry(() =>
          prisma.channel.findMany({
            where: { twitchChannelId: { in: idChunk } },
            select: {
              id: true,
              twitchChannelId: true,
              isMonitored: true,
              streamerId: true,
            },
          })
        ),
        this.withDbRetry(() =>
          prisma.streamer.findMany({
            where: { twitchUserId: { in: idChunk } },
            select: { id: true, twitchUserId: true, avatarUrl: true },
          })
        ),
      ]);

      for (const channel of channelChunk as ExistingChannel[]) {
        existingChannelMap.set(channel.twitchChannelId, channel);
      }

      for (const streamer of streamerChunk as ExistingStreamer[]) {
        existingStreamers.push(streamer);
        existingStreamerMap.set(streamer.twitchUserId, streamer);
      }
    }

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
        const updatedCount = await backfillExistingStreamerProfiles(streamersNeedingUpdate);
        logger.info(
          "SyncFollows",
          `已更新 ${updatedCount}/${streamersNeedingUpdate.length} 個現有 Streamer 的頭貼和名稱`
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
    const newFollowedChannels: typeof followedChannels = [];

    for (const follow of followedChannels) {
      const existingFollow = existingFollowMap.get(follow.broadcasterId);

      if (existingFollow) {
        existingFollowMap.delete(follow.broadcasterId);
      } else {
        newFollowedChannels.push(follow);
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
        const userMap = await fetchTwitchUserProfileMapByIds(twitchIds);
        const hydratedCount = hydrateStreamerProfileRecords(streamersToUpsert, userMap);

        logger.info(
          "SyncFollows",
          `已抓取 ${hydratedCount}/${twitchIds.length} 個新 Streamer 的完整資料`
        );
      } catch (error) {
        logger.warn("SyncFollows", "抓取 Streamer 資料失敗，使用預設值", error);
      }
    }

    // 8. 批量執行資料庫操作
    await this.withDbRetry(() =>
      prisma.$transaction(async (tx: TransactionClient) => {
      const now = new Date();

      if (streamersToUpsert.length > 0) {
        const streamerRows = streamersToUpsert.map((streamerData) =>
          Prisma.sql`(${randomUUID()}::text, ${streamerData.twitchUserId}::text, ${streamerData.displayName}::text, ${streamerData.avatarUrl}::text, ${now}::timestamptz)`
        );

        await tx.$executeRaw(
          Prisma.sql`
            INSERT INTO streamers (id, "twitchUserId", "displayName", "avatarUrl", "updatedAt")
            VALUES ${Prisma.join(streamerRows)}
            ON CONFLICT("twitchUserId") DO UPDATE SET
              "displayName" = excluded."displayName",
              "avatarUrl" = excluded."avatarUrl",
              "updatedAt" = excluded."updatedAt"
          `
        );

        const upsertedStreamers = await tx.streamer.findMany({
          where: {
            twitchUserId: {
              in: streamersToUpsert.map((streamerData) => streamerData.twitchUserId),
            },
          },
          select: {
            id: true,
            twitchUserId: true,
          },
        });

        for (const upserted of upsertedStreamers) {
          existingStreamerMap.set(upserted.twitchUserId, upserted);
        }
      }

      if (channelsToCreate.length > 0) {
        const channelRows: ReturnType<typeof Prisma.sql>[] = [];
        for (const channelData of channelsToCreate) {
          const streamer = existingStreamerMap.get(channelData.twitchChannelId);
          if (!streamer) {
            continue;
          }

          channelRows.push(
            Prisma.sql`(${randomUUID()}::text, ${channelData.twitchChannelId}::text, ${channelData.channelName}::text, ${channelData.channelUrl}::text, ${streamer.id}::text, ${"external"}::text, ${true}::boolean, ${now}::timestamptz)`
          );
        }

        if (channelRows.length > 0) {
          await tx.$executeRaw(
            Prisma.sql`
              INSERT INTO channels (id, "twitchChannelId", "channelName", "channelUrl", "streamerId", source, "isMonitored", "updatedAt")
              VALUES ${Prisma.join(channelRows)}
              ON CONFLICT("twitchChannelId") DO UPDATE SET
                "channelName" = excluded."channelName",
                "channelUrl" = excluded."channelUrl",
                "streamerId" = excluded."streamerId",
                "isMonitored" = true,
                "updatedAt" = excluded."updatedAt"
            `
          );

          const upsertedChannels = await tx.channel.findMany({
            where: {
              twitchChannelId: {
                in: channelsToCreate.map((channelData) => channelData.twitchChannelId),
              },
            },
            select: {
              id: true,
              twitchChannelId: true,
              isMonitored: true,
              streamerId: true,
            },
          });

          for (const channel of upsertedChannels) {
            existingChannelMap.set(channel.twitchChannelId, channel);
          }

          result.channelsCreated += channelRows.length;
        }
      }

      if (channelsToUpdate.length > 0) {
        await tx.channel.updateMany({
          where: { id: { in: channelsToUpdate } },
          data: { isMonitored: true },
        });
      }
      })
    );

    // 6. 批量建立 UserFollow 記錄
    const followsToCreate: Array<{
      userId: string;
      userType: "streamer" | "viewer";
      channelId: string;
      followedAt: Date;
    }> = [];

    for (const follow of newFollowedChannels) {
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

    // 使用原生 SQL 批次 upsert，降低 DB 寫入成本
    // 記憶體優化：每 100 筆為一批，讓 GC 有機會回收
    const UPSERT_BATCH_SIZE = 100;
    for (let i = 0; i < followsToCreate.length; i += UPSERT_BATCH_SIZE) {
      const batch = followsToCreate.slice(i, i + UPSERT_BATCH_SIZE);

      try {
        const rows = batch.map((followData) =>
          Prisma.sql`(${randomUUID()}::text, ${followData.userId}::text, ${followData.userType}::text, ${
            followData.channelId
          }::text, ${followData.followedAt}::timestamptz)`
        );

        const insertedCount = await retryDatabaseOperation(() =>
          prisma.$executeRaw(
            Prisma.sql`
              INSERT INTO user_follows (id, "userId", "userType", "channelId", "followedAt")
              VALUES ${Prisma.join(rows)}
              ON CONFLICT("userId", "channelId") DO NOTHING
            `
          )
        );

        result.followsCreated += Number(insertedCount);
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
      await this.withDbRetry(() =>
        prisma.userFollow.deleteMany({
        where: { id: { in: followIdsToDelete } },
        })
      );
      result.followsRemoved = followIdsToDelete.length;
    }

    scheduleSummaryRefresh(user.id);

    return result;
  }

  /**
   * 清理不再被任何使用者追蹤的外部頻道
   */
  private async cleanupUnfollowedChannels(): Promise<number> {
    // 找出所有 source="external" 且沒有 UserFollow 關聯的頻道
    const orphanedChannels = await this.withDbRetry(() =>
      prisma.channel.findMany({
      where: {
        source: "external",
        isMonitored: true,
        userFollows: { none: {} },
      },
      select: { id: true },
      })
    );

    if (orphanedChannels.length === 0) {
      return 0;
    }

    // 使用 updateMany 批次更新（修復 N+1 問題）
    const orphanedIds = orphanedChannels.map((c: { id: string }) => c.id);
    await this.withDbRetry(() =>
      prisma.channel.updateMany({
      where: { id: { in: orphanedIds } },
      data: { isMonitored: false },
      })
    );

    logger.info("Jobs", `🧹 停用 ${orphanedChannels.length} 個無人追蹤的外部頻道`);

    return orphanedChannels.length;
  }

  /**
   * 獲取目前監控中的頻道總數
   */
  private async getMonitoredChannelCount(): Promise<number> {
    const count = await this.withDbRetry(() =>
      prisma.channel.count({
        where: { isMonitored: true },
      })
    );
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
  try {
    logger.info("Jobs", `🔄 登入後同步使用者追蹤名單: ${viewerId}`);

    // 獲取 Viewer 的 Twitch User ID
    const viewer = await retryDatabaseOperation(
      () =>
        prisma.viewer.findUnique({
          where: { id: viewerId },
          select: { twitchUserId: true },
        }),
      DB_RETRY_OPTIONS
    );

    if (!viewer) {
      logger.warn("Jobs", `找不到 Viewer: ${viewerId}`);
      return;
    }

    // 獲取現有的追蹤記錄
    const existingFollows = await retryDatabaseOperation(
      () =>
        prisma.userFollow.findMany({
          where: {
            userId: viewerId,
            userType: "viewer",
          },
          select: {
            id: true,
            channel: { select: { twitchChannelId: true } },
          },
        }),
      DB_RETRY_OPTIONS
    );

    const existingFollowMap = new Map<string, TriggerExistingFollow>(
      existingFollows.map((f: TriggerExistingFollow) => [f.channel.twitchChannelId, f])
    );
    const existingChannelMap = new Map<string, TriggerExistingChannel>();
    const existingStreamerMap = new Map<string, TriggerExistingStreamer & { avatarUrl?: string | null }>();

    let created = 0;
    let removed = 0;

    const followsToUpsert: Array<{
      userId: string;
      userType: "viewer";
      channelId: string;
      followedAt: Date;
    }> = [];

    const flushFollowUpserts = async (): Promise<void> => {
      if (followsToUpsert.length === 0) {
        return;
      }

      const rows = followsToUpsert.map(
        (followData) =>
          Prisma.sql`(${randomUUID()}::text, ${followData.userId}::text, ${followData.userType}::text, ${
            followData.channelId
          }::text, ${followData.followedAt}::timestamptz)`
      );

      try {
        const insertedCount = await retryDatabaseOperation(
          () =>
            prisma.$executeRaw(
              Prisma.sql`
                INSERT INTO user_follows (id, "userId", "userType", "channelId", "followedAt")
                VALUES ${Prisma.join(rows)}
                ON CONFLICT("userId", "channelId") DO NOTHING
              `
            ),
          DB_RETRY_OPTIONS
        );

        created += Number(insertedCount);
      } catch (error) {
        logger.warn(
          "Jobs",
          `批次 upsert 失敗 (size=${followsToUpsert.length}):`,
          error instanceof Error ? error.message : String(error)
        );
      }

      followsToUpsert.length = 0;
    };

    const processFollowChunk = async (chunk: FollowedChannelRecord[]): Promise<void> => {
      if (chunk.length === 0) {
        return;
      }

      const broadcasterIds = Array.from(new Set(chunk.map((follow) => follow.broadcasterId)));
      const [channelChunk, streamerChunk] = await Promise.all([
        retryDatabaseOperation(
          () =>
            prisma.channel.findMany({
              where: { twitchChannelId: { in: broadcasterIds } },
              select: { id: true, twitchChannelId: true, isMonitored: true, streamerId: true },
            }),
          DB_RETRY_OPTIONS
        ),
        retryDatabaseOperation(
          () =>
            prisma.streamer.findMany({
              where: { twitchUserId: { in: broadcasterIds } },
              select: { id: true, twitchUserId: true, avatarUrl: true },
            }),
          DB_RETRY_OPTIONS
        ),
      ]);

      for (const channel of channelChunk as TriggerExistingChannel[]) {
        existingChannelMap.set(channel.twitchChannelId, channel);
      }

      const existingChunkStreamers = streamerChunk as Array<
        TriggerExistingStreamer & { avatarUrl?: string | null }
      >;
      const streamersNeedingUpdate = existingChunkStreamers.filter(
        (streamer) => !streamer.avatarUrl || streamer.avatarUrl === ""
      );

      if (streamersNeedingUpdate.length > 0) {
        try {
          const updatedCount = await backfillExistingStreamerProfiles(streamersNeedingUpdate);
          logger.info(
            "Jobs",
            `✅ 已更新 ${updatedCount}/${streamersNeedingUpdate.length} 個現有 Streamer 的頭貼和名稱`
          );
        } catch (error) {
          logger.warn("Jobs", "更新現有 Streamer 資料失敗", error);
        }
      }

      for (const streamer of existingChunkStreamers) {
        existingStreamerMap.set(streamer.twitchUserId, streamer);
      }

      const streamersToUpsert = new Map<string, StreamerProfileRecord>();
      const channelsToUpsert = new Map<
        string,
        { twitchChannelId: string; channelName: string; channelUrl: string }
      >();
      const channelIdsToEnable = new Set<string>();
      const newFollows: FollowedChannelRecord[] = [];

      for (const follow of chunk) {
        const existingFollow = existingFollowMap.get(follow.broadcasterId);
        if (existingFollow) {
          existingFollowMap.delete(follow.broadcasterId);
        } else {
          newFollows.push(follow);
        }

        const existingChannel = existingChannelMap.get(follow.broadcasterId);
        if (!existingChannel) {
          if (!existingStreamerMap.has(follow.broadcasterId)) {
            streamersToUpsert.set(follow.broadcasterId, {
              twitchUserId: follow.broadcasterId,
              displayName: follow.broadcasterLogin,
              avatarUrl: "",
            });
          }

          channelsToUpsert.set(follow.broadcasterId, {
            twitchChannelId: follow.broadcasterId,
            channelName: follow.broadcasterLogin,
            channelUrl: `https://www.twitch.tv/${follow.broadcasterLogin}`,
          });
        } else if (!existingChannel.isMonitored) {
          channelIdsToEnable.add(existingChannel.id);
        }
      }

      if (streamersToUpsert.size > 0) {
        try {
          const twitchIds = Array.from(streamersToUpsert.keys());
          const userMap = await fetchTwitchUserProfileMapByIds(twitchIds);
          const hydratedCount = hydrateStreamerProfileRecords(streamersToUpsert.values(), userMap);
          logger.info(
            "Jobs",
            `✅ 已抓取 ${hydratedCount}/${streamersToUpsert.size} 個新 Streamer 的完整資料`
          );
        } catch (error) {
          logger.warn("Jobs", "抓取新 Streamer 資料失敗，使用預設值", error);
        }
      }

      if (
        streamersToUpsert.size > 0 ||
        channelsToUpsert.size > 0 ||
        channelIdsToEnable.size > 0
      ) {
        await retryDatabaseOperation(
          () =>
            prisma.$transaction(async (tx: TransactionClient) => {
              const now = new Date();

              if (streamersToUpsert.size > 0) {
                const streamerRows = [...streamersToUpsert.values()].map((streamer) =>
                  Prisma.sql`(${randomUUID()}::text, ${streamer.twitchUserId}::text, ${streamer.displayName}::text, ${
                    streamer.avatarUrl ?? null
                  }::text, ${now}::timestamptz)`
                );

                await tx.$executeRaw(
                  Prisma.sql`
                    INSERT INTO streamers (id, "twitchUserId", "displayName", "avatarUrl", "updatedAt")
                    VALUES ${Prisma.join(streamerRows)}
                    ON CONFLICT("twitchUserId") DO UPDATE SET
                      "displayName" = excluded."displayName",
                      "avatarUrl" = excluded."avatarUrl",
                      "updatedAt" = excluded."updatedAt"
                  `
                );

                const upsertedStreamers = await tx.streamer.findMany({
                  where: { twitchUserId: { in: [...streamersToUpsert.keys()] } },
                  select: { id: true, twitchUserId: true, avatarUrl: true },
                });

                for (const streamer of upsertedStreamers) {
                  existingStreamerMap.set(streamer.twitchUserId, {
                    id: streamer.id,
                    twitchUserId: streamer.twitchUserId,
                    avatarUrl: streamer.avatarUrl,
                  });
                }
              }

              if (channelsToUpsert.size > 0) {
                const channelRows: ReturnType<typeof Prisma.sql>[] = [];
                for (const channelData of channelsToUpsert.values()) {
                  const streamerId = existingStreamerMap.get(channelData.twitchChannelId)?.id ?? null;
                  if (!streamerId) {
                    logger.warn("Jobs", `無法解析 streamerId for ${channelData.channelName}, 跳過此頻道`);
                    continue;
                  }

                  channelRows.push(
                    Prisma.sql`(${randomUUID()}::text, ${channelData.twitchChannelId}::text, ${channelData.channelName}::text, ${
                      channelData.channelUrl ?? null
                    }::text, ${streamerId}::text, ${"external"}::text, ${true}::boolean, ${now}::timestamptz)`
                  );
                }

                if (channelRows.length > 0) {
                  await tx.$executeRaw(
                    Prisma.sql`
                      INSERT INTO channels (id, "twitchChannelId", "channelName", "channelUrl", "streamerId", source, "isMonitored", "updatedAt")
                      VALUES ${Prisma.join(channelRows)}
                      ON CONFLICT("twitchChannelId") DO UPDATE SET
                        "channelName" = excluded."channelName",
                        "isMonitored" = true,
                        "streamerId" = excluded."streamerId",
                        "updatedAt" = excluded."updatedAt"
                    `
                  );

                  const upsertedChannels = await tx.channel.findMany({
                    where: { twitchChannelId: { in: [...channelsToUpsert.keys()] } },
                    select: { id: true, twitchChannelId: true, isMonitored: true, streamerId: true },
                  });

                  for (const channel of upsertedChannels) {
                    existingChannelMap.set(channel.twitchChannelId, {
                      id: channel.id,
                      twitchChannelId: channel.twitchChannelId,
                      isMonitored: channel.isMonitored,
                      streamerId: channel.streamerId,
                    });
                  }
                }
              }

              if (channelIdsToEnable.size > 0) {
                await tx.channel.updateMany({
                  where: { id: { in: Array.from(channelIdsToEnable) } },
                  data: { isMonitored: true },
                });
              }
            }),
          DB_RETRY_OPTIONS
        );
      }

      for (const follow of newFollows) {
        const channel = existingChannelMap.get(follow.broadcasterId);
        if (!channel) {
          logger.warn("Jobs", `找不到頻道 ${follow.broadcasterLogin}，跳過追蹤記錄建立`);
          continue;
        }

        followsToUpsert.push({
          userId: viewerId,
          userType: "viewer",
          channelId: channel.id,
          followedAt: follow.followedAt,
        });

        if (followsToUpsert.length >= 100) {
          await flushFollowUpserts();
        }
      }
    };

    let fetchedFollowCount = 0;
    let pendingChunk: FollowedChannelRecord[] = [];

    for await (const follow of twurpleHelixService.iterateFollowedChannels(
      viewer.twitchUserId,
      accessToken
    )) {
      pendingChunk.push({
        broadcasterId: follow.broadcasterId,
        broadcasterLogin: follow.broadcasterLogin,
        followedAt: follow.followedAt,
      });
      fetchedFollowCount += 1;

      if (pendingChunk.length >= FOLLOW_LOOKUP_CHUNK_SIZE) {
        const chunk = pendingChunk;
        pendingChunk = [];
        await processFollowChunk(chunk);
      }
    }

    if (pendingChunk.length > 0) {
      await processFollowChunk(pendingChunk);
    }

    await flushFollowUpserts();

    logger.info("Jobs", `📋 從 Twitch 取得 ${fetchedFollowCount} 個追蹤頻道`);

    // 批次刪除不再追蹤的記錄（修復 N+1 問題）
    const oldFollowIds = Array.from(existingFollowMap.values()).map(
      (f: TriggerExistingFollow) => f.id
    );
    if (oldFollowIds.length > 0) {
      await retryDatabaseOperation(
        () =>
          prisma.userFollow.deleteMany({
            where: { id: { in: oldFollowIds } },
          }),
        DB_RETRY_OPTIONS
      );
      removed = oldFollowIds.length;
    }

    logger.info("Jobs", `✅ 追蹤同步完成: 新增 ${created}, 移除 ${removed}`);

    scheduleSummaryRefresh(viewerId);

    // 延遲合併觸發開台狀態更新，避免大量登入造成重複壓力
    scheduleLiveStatusRefresh();
  } catch (error) {
    logger.error("Jobs", "追蹤同步失敗", error);
    throw error;
  }
}
