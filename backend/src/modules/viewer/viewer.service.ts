import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { logger } from "../../utils/logger";
import { twurpleHelixService } from "../../services/twitch-helix.service";

async function getOrSetWithOptionalTags<T>(
  key: string,
  factory: () => Promise<T>,
  ttl: number,
  tags: string[]
): Promise<T> {
  const tagged = (cacheManager as unknown as {
    getOrSetWithTags?: (
      cacheKey: string,
      cacheFactory: () => Promise<T>,
      cacheTtl?: number,
      cacheTags?: string[]
    ) => Promise<T>;
  }).getOrSetWithTags;

  if (typeof tagged === "function") {
    return tagged.call(cacheManager, key, factory, ttl, tags);
  }

  return cacheManager.getOrSet(key, factory, ttl);
}
import { cacheManager, CacheTTL, getAdaptiveTTL } from "../../utils/cache-manager";

// P2 Note: GroupByStatResult 保留供未來 groupBy 查詢使用
// interface GroupByStatResult {
//   channelId: string;
//   _sum: { watchSeconds: number | null; messageCount: number | null };
//   _max: { date: Date | null };
// }

interface FollowedChannelResult {
  id: string;
  channelName: string;
  displayName: string;
  avatarUrl: string;
  category: string;
  isLive: boolean;
  viewerCount: number | null;
  streamStartedAt: string | null;
  followedAt: string | null;
  tags: string[];
  lastWatched: string | null;
  totalWatchMinutes: number;
  messageCount: number;
  isExternal: boolean;
}

interface ViewerChannelSummaryRow {
  viewerId: string;
  channelId: string;
  twitchChannelId: string | null;
  channelName: string;
  displayName: string;
  avatarUrl: string;
  category: string | null;
  isLive: number | boolean;
  viewerCount: number | null;
  streamStartedAt: string | Date | null;
  lastWatched: string | Date | null;
  totalWatchMin: number;
  messageCount: number;
  isExternal: number | boolean;
  followedAt: string | Date | null;
  updatedAt: string | Date;
}

interface SummaryChannelSnapshot {
  channelId: string;
  isLive: boolean;
  viewerCount: number;
  streamStartedAt: Date | null;
  category: string;
}

const SQLITE_IN_CHUNK_SIZE = 100;
const SQLITE_SUMMARY_WRITE_CHUNK_SIZE = 50;

interface PersistableSummaryRow {
  channelId: string;
  channelName: string;
  displayName: string;
  avatarUrl: string;
  category: string | null;
  isLive: boolean;
  viewerCount: number | null;
  streamStartedAt: string | Date | null;
  lastWatched: string | Date | null;
  totalWatchMin: number;
  messageCount: number;
  isExternal: boolean;
  followedAt: string | Date | null;
}

export interface ViewerDailyStat {
  date: string;
  watchHours: number;
  messageCount: number;
  emoteCount: number;
}

export interface ViewerChannelInfo {
  id: string;
  name: string;
  displayName: string;
  avatarUrl: string;
  isLive: boolean;
  totalWatchHours: number;
  totalMessages: number;
  lastWatched: string;
}

export interface FollowedChannel {
  id: string;
  channelName: string;
  displayName: string;
  avatarUrl: string;
  category: string;
  isLive: boolean;
  viewerCount: number | null;
  streamStartedAt: string | null;
  followedAt: string | null;
  tags: string[];
  lastWatched: string | null;
  totalWatchMinutes: number;
  messageCount: number;
  isExternal: boolean;
}

export interface ViewerChannelStatsResponse {
  dailyStats: ViewerDailyStat[];
  timeRange: {
    startDate: string;
    endDate: string;
    days: number;
  };
  channel?: ViewerChannelInfo | null;
}

/**
 * 記錄觀看者同意條款
 */
export async function recordConsent(viewerId: string, version: number = 1) {
  return await prisma.viewer.update({
    where: { id: viewerId },
    data: {
      consentedAt: new Date(),
      consentVersion: version,
    },
  });
}

/**
 * 獲取觀看者對特定頻道的統計數據（帶快取）
 */
export async function getChannelStats(
  viewerId: string,
  channelId: string,
  days: number = 30,
  customStartDate?: Date,
  customEndDate?: Date
): Promise<ViewerChannelStatsResponse> {
  const queryEndDate = customEndDate || new Date();
  const queryStartDate =
    customStartDate || new Date(new Date().setDate(queryEndDate.getDate() - days));

  // 計算實際天數差異
  const actualDays = Math.ceil(
    (queryEndDate.getTime() - queryStartDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  // 快取鍵（包含 viewerId, channelId, days）
  const cacheKey = `viewer:${viewerId}:channel:${channelId}:stats:${actualDays}d`;

  // 使用適應性 TTL 快取
  const ttl = getAdaptiveTTL(CacheTTL.SHORT, cacheManager);
  return getOrSetWithOptionalTags(
    cacheKey,
    async () => {
      // 1. 併發查詢: 統計數據 + 頻道資訊
      const [stats, channelInfo] = await Promise.all([
        prisma.viewerChannelDailyStat.findMany({
          where: {
            viewerId,
            channelId,
            date: {
              gte: queryStartDate,
              lte: queryEndDate,
            },
          },
          orderBy: {
            date: "asc",
          },
        }),
        prisma.channel.findUnique({
          where: { id: channelId },
          include: {
            streamer: {
              select: {
                displayName: true,
                avatarUrl: true,
              },
            },
          },
        }),
      ]);

      // 轉換為前端友好的格式
      const dailyStats = stats.map((stat: { date: Date; watchSeconds: number; messageCount: number; emoteCount: number }) => ({
        date: stat.date.toISOString().split("T")[0],
        watchHours: Math.round((stat.watchSeconds / 3600) * 10) / 10,
        messageCount: stat.messageCount,
        emoteCount: stat.emoteCount,
      }));

      // 構建頻道基本資訊
      const totalWatchHours = dailyStats.reduce((sum: number, s: { watchHours: number }) => sum + s.watchHours, 0);
      const totalMessages = dailyStats.reduce((sum: number, s: { messageCount: number }) => sum + s.messageCount, 0);

      // 如果找不到頻道，使用 fallback
      const channelDisplay: ViewerChannelInfo | null = channelInfo
        ? {
            id: channelInfo.id,
            name: channelInfo.channelName,
            displayName: channelInfo.streamer?.displayName || channelInfo.channelName,
            avatarUrl: channelInfo.streamer?.avatarUrl || "",
            isLive: channelInfo.isLive,
            totalWatchHours,
            totalMessages,
            lastWatched:
              stats.length > 0 ? stats[stats.length - 1].date.toISOString().split("T")[0] : "",
          }
        : null;

      return {
        dailyStats,
        timeRange: {
          startDate: queryStartDate.toISOString().split("T")[0],
          endDate: queryEndDate.toISOString().split("T")[0],
          days: actualDays,
        },
        channel: channelDisplay,
      };
    },
    ttl,
    [`viewer:${viewerId}`, `channel:${channelId}`, "viewer:stats"]
  );
}

/**
 * 獲取觀看者追蹤的所有頻道 (合併自 Twitch Follows 和 觀看歷史)
 */
export async function getFollowedChannels(viewerId: string): Promise<FollowedChannel[]> {
  const cacheKey = `viewer:${viewerId}:channels_list`;

  // P1 Fix: 使用後端快取 + 物化摘要表避免昂貴查詢
  const ttl = getAdaptiveTTL(CacheTTL.MEDIUM, cacheManager);
  return getOrSetWithOptionalTags(
    cacheKey,
    async () => {
      const startTime = Date.now();

      try {
        const summaryRows = await fetchSummaryRows(viewerId);

        if (summaryRows.length > 0) {
          const reconciledRows = await reconcileLiveStatus(summaryRows);
          const mapped = mapSummaryRowsToFollowedChannels(reconciledRows);
          const sorted = sortFollowedChannels(mapped);

          // 背景同步 summary 表的 messageCount/totalWatchMin，避免 LEFT JOIN 失效時顯示舊值
          void syncSummaryStatsFromLifetime(viewerId);

          const totalTime = Date.now() - startTime;
          logger.debug(
            "ViewerService",
            `getFollowedChannels served from summary in ${totalTime}ms (${sorted.length} channels)`
          );
          return sorted;
        }

        const computed = await buildFollowedChannelsFromSource(viewerId);
        await persistSummaryRows(viewerId, computed);

        const sorted = sortFollowedChannels(computed);
        const totalTime = Date.now() - startTime;
        logger.debug(
          "ViewerService",
          `getFollowedChannels rebuilt summary in ${totalTime}ms (${sorted.length} channels)`
        );
        return sorted;
      } catch (error) {
        logger.error("ViewerService", "getFollowedChannels failed", error);
        throw error;
      }
    },
    ttl, // 適應性 TTL（根據記憶體壓力從 30 秒到 3 分鐘）
    [`viewer:${viewerId}`, "viewer:channels"]
  );
}

function sortFollowedChannels(channels: FollowedChannel[]): FollowedChannel[] {
  return [...channels].sort((a, b) => {
    if (a.isLive !== b.isLive) return a.isLive ? -1 : 1;

    const messageDiff = (b.messageCount || 0) - (a.messageCount || 0);
    if (messageDiff !== 0) {
      return messageDiff;
    }

    if (a.isLive && b.isLive) {
      const aStarted = a.streamStartedAt ? new Date(a.streamStartedAt).getTime() : 0;
      const bStarted = b.streamStartedAt ? new Date(b.streamStartedAt).getTime() : 0;
      if (aStarted !== bStarted) {
        return bStarted - aStarted;
      }

      const aFollowed = a.followedAt ? new Date(a.followedAt).getTime() : 0;
      const bFollowed = b.followedAt ? new Date(b.followedAt).getTime() : 0;
      if (aFollowed !== bFollowed) {
        return bFollowed - aFollowed;
      }

      const displayCompare = a.displayName.localeCompare(b.displayName, "zh-Hant");
      if (displayCompare !== 0) {
        return displayCompare;
      }

      return a.id.localeCompare(b.id);
    }

    const aLast = a.lastWatched ? new Date(a.lastWatched).getTime() : null;
    const bLast = b.lastWatched ? new Date(b.lastWatched).getTime() : null;

    if (aLast !== null && bLast !== null) return bLast - aLast;
    if (aLast !== null && bLast === null) return -1;
    if (aLast === null && bLast !== null) return 1;

    const aFollowed = a.followedAt ? new Date(a.followedAt).getTime() : 0;
    const bFollowed = b.followedAt ? new Date(b.followedAt).getTime() : 0;
    if (aFollowed !== bFollowed) {
      return bFollowed - aFollowed;
    }

    const displayCompare = a.displayName.localeCompare(b.displayName, "zh-Hant");
    if (displayCompare !== 0) {
      return displayCompare;
    }

    return a.id.localeCompare(b.id);
  });
}

function mapSummaryRowsToFollowedChannels(rows: ViewerChannelSummaryRow[]): FollowedChannel[] {
  return rows.map((row) => ({
    id: row.channelId,
    channelName: row.channelName,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    category: row.category || "Just Chatting",
    isLive: Boolean(row.isLive),
    viewerCount: row.viewerCount,
    streamStartedAt:
      row.streamStartedAt instanceof Date
        ? row.streamStartedAt.toISOString()
        : row.streamStartedAt || null,
    followedAt:
      row.followedAt instanceof Date ? row.followedAt.toISOString() : row.followedAt || null,
    tags: ["中文", "遊戲"],
    lastWatched:
      row.lastWatched instanceof Date ? row.lastWatched.toISOString() : row.lastWatched || null,
    totalWatchMinutes: row.totalWatchMin,
    messageCount: row.messageCount,
    isExternal: Boolean(row.isExternal),
  }));
}

async function fetchSummaryRows(viewerId: string): Promise<ViewerChannelSummaryRow[]> {
  try {
    return await prisma.$queryRaw<ViewerChannelSummaryRow[]>(Prisma.sql`
      WITH daily_watch AS (
        SELECT viewerId, channelId, SUM(watchSeconds) / 60 AS dailyWatchMin
        FROM viewer_channel_daily_stats
        WHERE viewerId = ${viewerId}
        GROUP BY viewerId, channelId
      )
      SELECT
        vcs.viewerId,
        vcs.channelId,
        c.twitchChannelId,
        COALESCE(c.channelName, vcs.channelName) AS channelName,
        COALESCE(s.displayName, vcs.displayName) AS displayName,
        COALESCE(s.avatarUrl, vcs.avatarUrl) AS avatarUrl,
        COALESCE(c.currentGameName, vcs.category) AS category,
        COALESCE(c.isLive, vcs.isLive) AS isLive,
        COALESCE(c.currentViewerCount, vcs.viewerCount) AS viewerCount,
        COALESCE(c.currentStreamStartedAt, vcs.streamStartedAt) AS streamStartedAt,
        vcs.lastWatched,
        MAX(
          COALESCE(l.totalWatchTimeMinutes, 0),
          COALESCE(dw.dailyWatchMin, 0),
          COALESCE(vcs.totalWatchMin, 0)
        ) AS totalWatchMin,
        COALESCE(l.totalMessages, vcs.messageCount) AS messageCount,
        vcs.isExternal,
        vcs.followedAt,
        vcs.updatedAt
      FROM viewer_channel_summary vcs
      LEFT JOIN channels c ON c.id = vcs.channelId
      LEFT JOIN streamers s ON s.id = c.streamerId
      LEFT JOIN viewer_channel_lifetime_stats l ON l.viewerId = vcs.viewerId AND l.channelId = vcs.channelId
      LEFT JOIN daily_watch dw ON dw.viewerId = vcs.viewerId AND dw.channelId = vcs.channelId
      WHERE vcs.viewerId = ${viewerId}
    `);
  } catch (error) {
    logger.debug("ViewerService", "viewer_channel_summary table not ready, fallback to source queries", error);
    return [];
  }
}

async function reconcileLiveStatus(rows: ViewerChannelSummaryRow[]): Promise<ViewerChannelSummaryRow[]> {
  const twitchIds = Array.from(
    new Set(rows.map((row) => row.twitchChannelId).filter((id): id is string => Boolean(id)))
  );

  if (twitchIds.length === 0) {
    return rows;
  }

  try {
    const streams = await twurpleHelixService.getStreamsByUserIds(twitchIds);
    const existingLiveCount = rows.reduce((count, row) => count + (Boolean(row.isLive) ? 1 : 0), 0);

    // 若 Twitch 回傳空清單但目前有既有直播中資料，視為暫時不一致，避免整批誤判為關台
    if (streams.length === 0 && existingLiveCount > 0) {
      logger.warn(
        "ViewerService",
        "Skip live-status reconciliation due to empty Twitch stream response while local rows contain live channels"
      );
      return rows;
    }

    const streamMap = new Map(streams.map((stream) => [stream.userId, stream]));

    const changedRows: Array<{
      channelId: string;
      isLive: boolean;
      viewerCount: number;
      streamStartedAt: Date | null;
      category: string;
    }> = [];

    const reconciled = rows.map((row) => {
      const stream = row.twitchChannelId ? streamMap.get(row.twitchChannelId) : undefined;
      const nextIsLive = Boolean(stream);
      const nextViewerCount = stream?.viewerCount ?? 0;
      const nextStartedAt = stream?.startedAt ?? null;
      const nextCategory = stream?.gameName || "Just Chatting";

      const currentIsLive = Boolean(row.isLive);
      const currentViewerCount = row.viewerCount ?? 0;
      const currentStartedAt = normalizeComparableDate(row.streamStartedAt);
      const nextStartedTs = normalizeComparableDate(nextStartedAt);

      if (
        currentIsLive !== nextIsLive ||
        currentViewerCount !== nextViewerCount ||
        currentStartedAt !== nextStartedTs
      ) {
        changedRows.push({
          channelId: row.channelId,
          isLive: nextIsLive,
          viewerCount: nextViewerCount,
          streamStartedAt: nextStartedAt,
          category: nextCategory,
        });
      }

      return {
        ...row,
        isLive: nextIsLive,
        viewerCount: nextIsLive ? nextViewerCount : 0,
        streamStartedAt: nextStartedAt,
        category: nextCategory,
      };
    });

    if (changedRows.length > 0) {
      await refreshViewerChannelSummaryForChannels(changedRows);
    }

    return reconciled;
  } catch (error) {
    logger.warn("ViewerService", "Failed to reconcile followed channel live status", error);
    return rows;
  }
}

async function persistSummaryRows(viewerId: string, rows: FollowedChannelResult[]): Promise<void> {
  try {
    if (rows.length === 0) {
      await prisma.$executeRaw(Prisma.sql`
        DELETE FROM viewer_channel_summary
        WHERE viewerId = ${viewerId}
      `);
      return;
    }

    const nextRows = new Map<string, PersistableSummaryRow>();
    for (const row of rows) {
      nextRows.set(row.id, {
        channelId: row.id,
        channelName: row.channelName,
        displayName: row.displayName,
        avatarUrl: row.avatarUrl,
        category: row.category,
        isLive: row.isLive,
        viewerCount: row.viewerCount,
        streamStartedAt: row.streamStartedAt,
        lastWatched: row.lastWatched,
        totalWatchMin: row.totalWatchMinutes,
        messageCount: row.messageCount,
        isExternal: row.isExternal,
        followedAt: row.followedAt,
      });
    }

    const existingRows = await prisma.viewerChannelSummary.findMany({
      where: { viewerId },
      select: {
        channelId: true,
        channelName: true,
        displayName: true,
        avatarUrl: true,
        category: true,
        isLive: true,
        viewerCount: true,
        streamStartedAt: true,
        lastWatched: true,
        totalWatchMin: true,
        messageCount: true,
        isExternal: true,
        followedAt: true,
      },
    });

    const existingByChannelId = new Map(existingRows.map((row) => [row.channelId, row]));
    const deletes: string[] = [];
    const inserts: PersistableSummaryRow[] = [];
    const updates: PersistableSummaryRow[] = [];

    for (const existing of existingRows) {
      if (!nextRows.has(existing.channelId)) {
        deletes.push(existing.channelId);
      }
    }

    for (const nextRow of nextRows.values()) {
      const existing = existingByChannelId.get(nextRow.channelId);

      if (!existing) {
        inserts.push(nextRow);
        continue;
      }

      if (hasSummaryRowChanges(existing, nextRow)) {
        updates.push(nextRow);
      }
    }

    for (let i = 0; i < deletes.length; i += SQLITE_IN_CHUNK_SIZE) {
      const deleteChunk = deletes.slice(i, i + SQLITE_IN_CHUNK_SIZE);
      await prisma.$executeRaw(Prisma.sql`
        DELETE FROM viewer_channel_summary
        WHERE viewerId = ${viewerId}
          AND channelId IN (${Prisma.join(deleteChunk)})
      `);
    }

    for (let i = 0; i < inserts.length; i += SQLITE_SUMMARY_WRITE_CHUNK_SIZE) {
      const insertChunk = inserts.slice(i, i + SQLITE_SUMMARY_WRITE_CHUNK_SIZE);
      const values = insertChunk.map((row) =>
        Prisma.sql`(
          ${viewerId},
          ${row.channelId},
          ${row.channelName},
          ${row.displayName},
          ${row.avatarUrl},
          ${row.category},
          ${row.isLive ? 1 : 0},
          ${row.viewerCount},
          ${row.streamStartedAt},
          ${row.lastWatched},
          ${row.totalWatchMin},
          ${row.messageCount},
          ${row.isExternal ? 1 : 0},
          ${row.followedAt},
          CURRENT_TIMESTAMP
        )`
      );

      await prisma.$executeRaw(Prisma.sql`
        INSERT INTO viewer_channel_summary (
          viewerId,
          channelId,
          channelName,
          displayName,
          avatarUrl,
          category,
          isLive,
          viewerCount,
          streamStartedAt,
          lastWatched,
          totalWatchMin,
          messageCount,
          isExternal,
          followedAt,
          updatedAt
        )
        VALUES ${Prisma.join(values)}
      `);
    }

    for (let i = 0; i < updates.length; i += SQLITE_SUMMARY_WRITE_CHUNK_SIZE) {
      const updateChunk = updates.slice(i, i + SQLITE_SUMMARY_WRITE_CHUNK_SIZE);
      const values = updateChunk.map((row) =>
        Prisma.sql`(
          ${row.channelId},
          ${row.channelName},
          ${row.displayName},
          ${row.avatarUrl},
          ${row.category},
          ${row.isLive ? 1 : 0},
          ${row.viewerCount},
          ${row.streamStartedAt},
          ${row.lastWatched},
          ${row.totalWatchMin},
          ${row.messageCount},
          ${row.isExternal ? 1 : 0},
          ${row.followedAt}
        )`
      );

      await prisma.$executeRaw(Prisma.sql`
        WITH updates(
          channelId,
          channelName,
          displayName,
          avatarUrl,
          category,
          isLive,
          viewerCount,
          streamStartedAt,
          lastWatched,
          totalWatchMin,
          messageCount,
          isExternal,
          followedAt
        ) AS (
          VALUES ${Prisma.join(values)}
        )
        UPDATE viewer_channel_summary
        SET
          channelName = (SELECT updates.channelName FROM updates WHERE updates.channelId = viewer_channel_summary.channelId),
          displayName = (SELECT updates.displayName FROM updates WHERE updates.channelId = viewer_channel_summary.channelId),
          avatarUrl = (SELECT updates.avatarUrl FROM updates WHERE updates.channelId = viewer_channel_summary.channelId),
          category = (SELECT updates.category FROM updates WHERE updates.channelId = viewer_channel_summary.channelId),
          isLive = (SELECT updates.isLive FROM updates WHERE updates.channelId = viewer_channel_summary.channelId),
          viewerCount = (SELECT updates.viewerCount FROM updates WHERE updates.channelId = viewer_channel_summary.channelId),
          streamStartedAt = (SELECT updates.streamStartedAt FROM updates WHERE updates.channelId = viewer_channel_summary.channelId),
          lastWatched = (SELECT updates.lastWatched FROM updates WHERE updates.channelId = viewer_channel_summary.channelId),
          totalWatchMin = (SELECT updates.totalWatchMin FROM updates WHERE updates.channelId = viewer_channel_summary.channelId),
          messageCount = (SELECT updates.messageCount FROM updates WHERE updates.channelId = viewer_channel_summary.channelId),
          isExternal = (SELECT updates.isExternal FROM updates WHERE updates.channelId = viewer_channel_summary.channelId),
          followedAt = (SELECT updates.followedAt FROM updates WHERE updates.channelId = viewer_channel_summary.channelId),
          updatedAt = CURRENT_TIMESTAMP
        WHERE viewerId = ${viewerId}
          AND channelId IN (SELECT channelId FROM updates)
      `);
    }
  } catch (error) {
    logger.warn("ViewerService", "Failed to persist viewer_channel_summary", error);
  }
}

function hasSummaryRowChanges(
  existing: {
    channelName: string;
    displayName: string;
    avatarUrl: string;
    category: string | null;
    isLive: boolean;
    viewerCount: number | null;
    streamStartedAt: Date | null;
    lastWatched: Date | null;
    totalWatchMin: number;
    messageCount: number;
    isExternal: boolean;
    followedAt: Date | null;
  },
  next: PersistableSummaryRow
): boolean {
  return (
    existing.channelName !== next.channelName ||
    existing.displayName !== next.displayName ||
    existing.avatarUrl !== next.avatarUrl ||
    existing.category !== next.category ||
    existing.isLive !== next.isLive ||
    existing.viewerCount !== next.viewerCount ||
    normalizeComparableDate(existing.streamStartedAt) !==
      normalizeComparableDate(next.streamStartedAt) ||
    normalizeComparableDate(existing.lastWatched) !== normalizeComparableDate(next.lastWatched) ||
    existing.totalWatchMin !== next.totalWatchMin ||
    existing.messageCount !== next.messageCount ||
    existing.isExternal !== next.isExternal ||
    normalizeComparableDate(existing.followedAt) !== normalizeComparableDate(next.followedAt)
  );
}

function normalizeComparableDate(value: Date | string | null): number | null {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  const timestamp = date.getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

function toIsoStringOrNull(value: Date | string | null): string | null {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

async function buildFollowedChannelsFromSource(viewerId: string): Promise<FollowedChannelResult[]> {
  type SourceRow = {
    id: string;
    channelName: string;
    isLive: number | boolean;
    hasActiveSession: number | boolean;
    currentViewerCount: number | null;
    currentStreamStartedAt: Date | string | null;
    currentGameName: string | null;
    source: string;
    displayName: string | null;
    avatarUrl: string | null;
    totalWatchTimeMinutes: number | null;
    totalMessages: number | null;
    lastWatchedAt: Date | string | null;
    followedAt: Date | string | null;
  };

  const rows = await prisma.$queryRaw<SourceRow[]>(Prisma.sql`
    WITH stat_rows AS (
      SELECT channelId, totalWatchTimeMinutes, totalMessages, lastWatchedAt
      FROM viewer_channel_lifetime_stats
      WHERE viewerId = ${viewerId}
    ),
    daily_watch AS (
      SELECT channelId, SUM(watchSeconds) / 60 AS dailyWatchMin
      FROM viewer_channel_daily_stats
      WHERE viewerId = ${viewerId}
      GROUP BY channelId
    ),
    follow_rows AS (
      SELECT channelId, followedAt
      FROM user_follows
      WHERE userId = ${viewerId} AND userType = 'viewer'
    ),
    merged_channels AS (
      SELECT channelId FROM stat_rows
      UNION
      SELECT channelId FROM daily_watch
      UNION
      SELECT channelId FROM follow_rows
    ),
    active_sessions AS (
      SELECT channelId, 1 AS hasActiveSession
      FROM stream_sessions
      WHERE endedAt IS NULL
        AND channelId IN (SELECT channelId FROM merged_channels)
      GROUP BY channelId
    )
    SELECT
      c.id,
      c.channelName,
      c.isLive,
      COALESCE(a.hasActiveSession, 0) AS hasActiveSession,
      c.currentViewerCount,
      c.currentStreamStartedAt,
      c.currentGameName,
      c.source,
      s.displayName,
      s.avatarUrl,
      MAX(COALESCE(st.totalWatchTimeMinutes, 0), COALESCE(dw.dailyWatchMin, 0)) AS totalWatchTimeMinutes,
      st.totalMessages,
      st.lastWatchedAt,
      f.followedAt
    FROM merged_channels mc
    JOIN channels c ON c.id = mc.channelId
    LEFT JOIN streamers s ON s.id = c.streamerId
    LEFT JOIN stat_rows st ON st.channelId = c.id
    LEFT JOIN daily_watch dw ON dw.channelId = c.id
    LEFT JOIN follow_rows f ON f.channelId = c.id
    LEFT JOIN active_sessions a ON a.channelId = c.id
    ORDER BY COALESCE(st.lastWatchedAt, f.followedAt, c.updatedAt) DESC
  `);

  return rows.map((row) => {
    const displayName = row.displayName || row.channelName;
    const avatarUrl =
      row.avatarUrl ||
      `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=6366f1&color=fff&size=150`;

    return {
      id: row.id,
      channelName: row.channelName,
      displayName,
      avatarUrl,
      category: row.currentGameName || "Just Chatting",
      isLive: Boolean(row.isLive) || Boolean(row.hasActiveSession),
      viewerCount: row.currentViewerCount ?? null,
      streamStartedAt: toIsoStringOrNull(row.currentStreamStartedAt),
      followedAt: toIsoStringOrNull(row.followedAt),
      tags: ["中文", "遊戲"],
      lastWatched: toIsoStringOrNull(row.lastWatchedAt),
      totalWatchMinutes: row.totalWatchTimeMinutes ?? 0,
      messageCount: row.totalMessages ?? 0,
      isExternal: row.source === "external",
    };
  });
}

export async function refreshViewerChannelSummaryForViewer(viewerId: string): Promise<void> {
  const rows = await buildFollowedChannelsFromSource(viewerId);
  await persistSummaryRows(viewerId, rows);
  cacheManager.delete(`viewer:${viewerId}:channels_list`);
}

/**
 * 從 lifetime_stats 同步 messageCount 和 totalWatchMin 到 summary 表
 * 確保即使 LEFT JOIN 失效，summary 表也有合理的最新值
 */
export async function syncSummaryStatsFromLifetime(viewerId: string): Promise<void> {
  try {
    await prisma.$executeRaw(Prisma.sql`
      UPDATE viewer_channel_summary
      SET
        messageCount = COALESCE(
          (SELECT l.totalMessages
           FROM viewer_channel_lifetime_stats l
           WHERE l.viewerId = viewer_channel_summary.viewerId
             AND l.channelId = viewer_channel_summary.channelId),
          messageCount
        ),
        totalWatchMin = MAX(
          totalWatchMin,
          COALESCE(
            (SELECT l.totalWatchTimeMinutes
             FROM viewer_channel_lifetime_stats l
             WHERE l.viewerId = viewer_channel_summary.viewerId
               AND l.channelId = viewer_channel_summary.channelId),
            0
          ),
          COALESCE(
            (SELECT SUM(d.watchSeconds) / 60
             FROM viewer_channel_daily_stats d
             WHERE d.viewerId = viewer_channel_summary.viewerId
               AND d.channelId = viewer_channel_summary.channelId),
            0
          )
        ),
        updatedAt = CURRENT_TIMESTAMP
      WHERE viewerId = ${viewerId}
    `);
  } catch (error) {
    logger.debug("ViewerService", "Failed to sync summary stats from lifetime_stats", error);
  }
}

export async function refreshViewerChannelSummaryForChannels(
  snapshots: SummaryChannelSnapshot[]
): Promise<void> {
  if (snapshots.length === 0) {
    return;
  }

  try {
    const deduped = Array.from(
      snapshots.reduce((map, snapshot) => map.set(snapshot.channelId, snapshot), new Map<string, SummaryChannelSnapshot>()).values()
    );

    const CHUNK_SIZE = 120;
    for (let i = 0; i < deduped.length; i += CHUNK_SIZE) {
      const chunk = deduped.slice(i, i + CHUNK_SIZE);
      const values = chunk.map((snapshot) =>
        Prisma.sql`(${snapshot.channelId}, ${snapshot.isLive ? 1 : 0}, ${snapshot.viewerCount}, ${
          snapshot.streamStartedAt
        }, ${snapshot.category})`
      );

      await prisma.$executeRaw(Prisma.sql`
        WITH updates(channelId, isLive, viewerCount, streamStartedAt, category) AS (
          VALUES ${Prisma.join(values)}
        )
        UPDATE viewer_channel_summary
        SET
          isLive = (SELECT updates.isLive FROM updates WHERE updates.channelId = viewer_channel_summary.channelId),
          viewerCount = (SELECT updates.viewerCount FROM updates WHERE updates.channelId = viewer_channel_summary.channelId),
          streamStartedAt = (SELECT updates.streamStartedAt FROM updates WHERE updates.channelId = viewer_channel_summary.channelId),
          category = (SELECT updates.category FROM updates WHERE updates.channelId = viewer_channel_summary.channelId),
          updatedAt = CURRENT_TIMESTAMP
        WHERE channelId IN (SELECT channelId FROM updates)
          AND (
            isLive != (SELECT updates.isLive FROM updates WHERE updates.channelId = viewer_channel_summary.channelId)
            OR COALESCE(viewerCount, -1) != COALESCE((SELECT updates.viewerCount FROM updates WHERE updates.channelId = viewer_channel_summary.channelId), -1)
            OR COALESCE(streamStartedAt, '1970-01-01 00:00:00') != COALESCE((SELECT updates.streamStartedAt FROM updates WHERE updates.channelId = viewer_channel_summary.channelId), '1970-01-01 00:00:00')
            OR COALESCE(category, '') != COALESCE((SELECT updates.category FROM updates WHERE updates.channelId = viewer_channel_summary.channelId), '')
          )
      `);
    }
  } catch (error) {
    logger.warn("ViewerService", "Failed to refresh channel live snapshot in summary table", error);
  }
}

export async function warmViewerChannelsCache(limit = 100): Promise<void> {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const active = await prisma.viewerChannelLifetimeStats.findMany({
    where: {
      lastWatchedAt: {
        gte: oneDayAgo,
      },
    },
    select: {
      viewerId: true,
    },
    distinct: ["viewerId"],
    take: limit,
  });

  const viewerIds = active.map((row) => row.viewerId);
  if (viewerIds.length === 0) {
    return;
  }

  const CONCURRENCY = 8;
  for (let i = 0; i < viewerIds.length; i += CONCURRENCY) {
    const batch = viewerIds.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(batch.map((viewerId) => getFollowedChannels(viewerId)));

    results.forEach((result, index) => {
      if (result.status === "rejected") {
        logger.warn("ViewerService", `Cache warmup failed for viewer ${batch[index]}`, result.reason);
      }
    });
  }
}
