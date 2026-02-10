import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { logger } from "../../utils/logger";
import { cacheManager, CacheTTL, getAdaptiveTTL } from "../../utils/cache-manager";

// Type definitions for query results
interface LifetimeStatResult {
  channelId: string;
  totalWatchTimeMinutes: number;
  totalMessages: number;
  lastWatchedAt: Date | null;
}

interface FollowResult {
  channelId: string;
  followedAt: Date;
}

// P2 Note: GroupByStatResult 保留供未來 groupBy 查詢使用
// interface GroupByStatResult {
//   channelId: string;
//   _sum: { watchSeconds: number | null; messageCount: number | null };
//   _max: { date: Date | null };
// }

interface ChannelWithRelations {
  id: string;
  channelName: string;
  isLive: boolean;
  currentViewerCount: number | null;
  currentStreamStartedAt: Date | null;
  currentGameName: string | null;
  source: string;
  streamer: { displayName: string; avatarUrl: string | null } | null;
}

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

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
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
  const ttl = getAdaptiveTTL(CacheTTL.MEDIUM, cacheManager);
  return cacheManager.getOrSet(
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
    ttl
  );
}

/**
 * 獲取觀看者追蹤的所有頻道 (合併自 Twitch Follows 和 觀看歷史)
 */
export async function getFollowedChannels(viewerId: string): Promise<FollowedChannel[]> {
  const cacheKey = `viewer:${viewerId}:channels_list`;

  // P1 Fix: 使用後端快取 + 物化摘要表避免昂貴查詢
  const ttl = getAdaptiveTTL(CacheTTL.MEDIUM, cacheManager);
  return cacheManager.getOrSet(
    cacheKey,
    async () => {
      const startTime = Date.now();

      try {
        const summaryRows = await fetchSummaryRows(viewerId);

        if (summaryRows.length > 0) {
          const mapped = mapSummaryRowsToFollowedChannels(summaryRows);
          const sorted = sortFollowedChannels(mapped);

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
    ttl // 適應性 TTL（根據記憶體壓力從 30 秒到 3 分鐘）
  );
}

function sortFollowedChannels(channels: FollowedChannel[]): FollowedChannel[] {
  return [...channels].sort((a, b) => {
    if (a.isLive !== b.isLive) return a.isLive ? -1 : 1;

    const aLast = a.lastWatched ? new Date(a.lastWatched).getTime() : null;
    const bLast = b.lastWatched ? new Date(b.lastWatched).getTime() : null;

    if (aLast !== null && bLast !== null) return bLast - aLast;
    if (aLast !== null && bLast === null) return -1;
    if (aLast === null && bLast !== null) return 1;

    return 0;
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
      SELECT
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
      FROM viewer_channel_summary
      WHERE viewerId = ${viewerId}
    `);
  } catch (error) {
    logger.debug("ViewerService", "viewer_channel_summary table not ready, fallback to source queries", error);
    return [];
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

    const channelIds = rows.map((row) => row.id);

    await prisma.$executeRaw(Prisma.sql`
      DELETE FROM viewer_channel_summary
      WHERE viewerId = ${viewerId}
        AND channelId NOT IN (${Prisma.join(channelIds)})
    `);

    const values = rows.map((row) =>
      Prisma.sql`(
        ${viewerId},
        ${row.id},
        ${row.channelName},
        ${row.displayName},
        ${row.avatarUrl},
        ${row.category},
        ${row.isLive ? 1 : 0},
        ${row.viewerCount},
        ${row.streamStartedAt},
        ${row.lastWatched},
        ${row.totalWatchMinutes},
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
      ON CONFLICT(viewerId, channelId) DO UPDATE SET
        channelName = excluded.channelName,
        displayName = excluded.displayName,
        avatarUrl = excluded.avatarUrl,
        category = excluded.category,
        isLive = excluded.isLive,
        viewerCount = excluded.viewerCount,
        streamStartedAt = excluded.streamStartedAt,
        lastWatched = excluded.lastWatched,
        totalWatchMin = excluded.totalWatchMin,
        messageCount = excluded.messageCount,
        isExternal = excluded.isExternal,
        followedAt = excluded.followedAt,
        updatedAt = CURRENT_TIMESTAMP
    `);
  } catch (error) {
    logger.warn("ViewerService", "Failed to persist viewer_channel_summary", error);
  }
}

async function buildFollowedChannelsFromSource(viewerId: string): Promise<FollowedChannelResult[]> {
  const lifetimeStats = await prisma.viewerChannelLifetimeStats.findMany({
    where: { viewerId },
    select: {
      channelId: true,
      totalWatchTimeMinutes: true,
      totalMessages: true,
      lastWatchedAt: true,
    },
    orderBy: {
      lastWatchedAt: "desc",
    },
  });

  const follows = await prisma.userFollow.findMany({
    where: {
      userId: viewerId,
      userType: "viewer",
    },
    select: {
      channelId: true,
      followedAt: true,
    },
  });

  const statsChannelIds = new Set(lifetimeStats.map((s: LifetimeStatResult) => s.channelId));
  const followChannelIds = new Set(follows.map((f: FollowResult) => f.channelId));
  const allChannelIds = Array.from(new Set([...statsChannelIds, ...followChannelIds]));

  if (allChannelIds.length === 0) {
    return [];
  }

  const channelIdChunks = chunkArray(allChannelIds, SQLITE_IN_CHUNK_SIZE);

  const [channelChunkResults, activeSessionChunkResults] = await Promise.all([
    Promise.all(
      channelIdChunks.map((chunk) =>
        prisma.channel.findMany({
          where: {
            id: { in: chunk },
          },
          select: {
            id: true,
            channelName: true,
            isLive: true,
            currentViewerCount: true,
            currentStreamStartedAt: true,
            currentGameName: true,
            source: true,
            streamer: {
              select: {
                displayName: true,
                avatarUrl: true,
              },
            },
          },
        })
      )
    ),
    Promise.all(
      channelIdChunks.map((chunk) =>
        prisma.streamSession.findMany({
          where: {
            channelId: { in: chunk },
            endedAt: null,
          },
          select: {
            channelId: true,
          },
          distinct: ["channelId"],
        })
      )
    ),
  ]);

  const channels = channelChunkResults.flat();
  const activeSessions = activeSessionChunkResults.flat();

  const activeSessionChannelIds = new Set(activeSessions.map((session) => session.channelId));
  const statsMap = new Map<string, LifetimeStatResult>(
    lifetimeStats.map((s: LifetimeStatResult) => [s.channelId, s])
  );
  const followsMap = new Map<string, Date>(
    follows.map((f: FollowResult) => [f.channelId, f.followedAt])
  );

  return channels.map((channel: ChannelWithRelations) => {
    const stat = statsMap.get(channel.id);
    const followedAt = followsMap.get(channel.id);

    const hasActiveSession = activeSessionChannelIds.has(channel.id);
    const isLive = channel.isLive || hasActiveSession;

    const displayName = channel.streamer?.displayName || channel.channelName;
    const avatarUrl =
      channel.streamer?.avatarUrl ||
      `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=6366f1&color=fff&size=150`;

    return {
      id: channel.id,
      channelName: channel.channelName,
      displayName,
      avatarUrl,
      category: channel.currentGameName || "Just Chatting",
      isLive,
      viewerCount: channel.currentViewerCount ?? null,
      streamStartedAt: channel.currentStreamStartedAt?.toISOString() ?? null,
      followedAt: followedAt?.toISOString() ?? null,
      tags: ["中文", "遊戲"],
      lastWatched: stat?.lastWatchedAt?.toISOString() ?? null,
      totalWatchMinutes: stat?.totalWatchTimeMinutes ?? 0,
      messageCount: stat?.totalMessages ?? 0,
      isExternal: channel.source === "external",
    };
  });
}

export async function refreshViewerChannelSummaryForViewer(viewerId: string): Promise<void> {
  const rows = await buildFollowedChannelsFromSource(viewerId);
  await persistSummaryRows(viewerId, rows);
  cacheManager.delete(`viewer:${viewerId}:channels_list`);
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

  for (const viewerId of viewerIds) {
    try {
      await getFollowedChannels(viewerId);
    } catch (error) {
      logger.warn("ViewerService", `Cache warmup failed for viewer ${viewerId}`, error);
    }
  }
}
