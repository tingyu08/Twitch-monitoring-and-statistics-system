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
  streamer: { displayName: string; avatarUrl: string } | null;
  streamSessions: unknown[];
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

  // P1 Fix: 使用後端快取避免昂貴的查詢（適應性 TTL，根據記憶體壓力調整）
  const ttl = getAdaptiveTTL(CacheTTL.MEDIUM, cacheManager);
  return cacheManager.getOrSet(
    cacheKey,
    async () => {
      const startTime = Date.now();

      try {
        // 1. 優先使用預先聚合的 LifetimeStats 表（快速），如果為空則 fallback 到 groupBy（慢但完整）

        let lifetimeStats = await prisma.viewerChannelLifetimeStats.findMany({
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

        // P0 Optimization: 移除昂貴的 groupBy fallback
        // 如果 LifetimeStats 為空，只返回追蹤的頻道（無統計資料）
        // Lifetime Stats Job 會在背景定期更新，首次查詢可能為空屬於正常現象
        if (lifetimeStats.length === 0) {
          logger.debug(
            "ViewerService",
            "LifetimeStats empty for new viewer, will be populated by update-lifetime-stats job"
          );
          // 保持 lifetimeStats 為空陣列，後續只顯示追蹤的頻道
        }

        // 2. 獲取外部追蹤
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

        // 3. 合併頻道 ID 列表
        const statsChannelIds = new Set(lifetimeStats.map((s: LifetimeStatResult) => s.channelId));
        const followChannelIds = new Set(follows.map((f: FollowResult) => f.channelId));
        const allChannelIds = Array.from(new Set([...statsChannelIds, ...followChannelIds]));

        if (allChannelIds.length === 0) {
          return [];
        }

        // 4. 批量查詢頻道詳細資訊

        const channels = await prisma.channel.findMany({
          where: {
            id: { in: allChannelIds },
          },
          include: {
            streamer: true,
            streamSessions: {
              where: { endedAt: null },
              take: 1,
            },
          },
        });

        // 建立 Stats Map 以便快速查找
        const statsMap = new Map<string, LifetimeStatResult>(lifetimeStats.map((s: LifetimeStatResult) => [s.channelId, s]));
        const followsMap = new Map<string, Date>(follows.map((f: FollowResult) => [f.channelId, f.followedAt]));

        // 6. 轉換為前端格式
        const results: FollowedChannelResult[] = channels.map((channel: ChannelWithRelations) => {
          const stat = statsMap.get(channel.id);
          const followedAt = followsMap.get(channel.id);

          const hasActiveSession = channel.streamSessions && channel.streamSessions.length > 0;
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

        // 排序
          const sorted = results.sort((a: FollowedChannelResult, b: FollowedChannelResult) => {
            // 1. Live first
            if (a.isLive !== b.isLive) return a.isLive ? -1 : 1;

            // 2. Last Watched desc (treat missing lastWatched as older)
            const aLast = a.lastWatched ? new Date(a.lastWatched).getTime() : null;
            const bLast = b.lastWatched ? new Date(b.lastWatched).getTime() : null;

            if (aLast !== null && bLast !== null) return bLast - aLast;
            if (aLast !== null && bLast === null) return -1;
            if (aLast === null && bLast !== null) return 1;

            return 0;
          });

        const totalTime = Date.now() - startTime;
        logger.debug("ViewerService", `getFollowedChannels completed in ${totalTime}ms (${sorted.length} channels)`);
        return sorted;
      } catch (error) {
        logger.error("ViewerService", "getFollowedChannels failed", error);
        throw error;
      }
    },
    ttl // 適應性 TTL（根據記憶體壓力從 30 秒到 3 分鐘）
  );
}
