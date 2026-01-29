import { prisma } from "../../db/prisma";
import { logger } from "../../utils/logger";
import { cacheManager } from "../../utils/cache-manager";

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
 * 獲取觀看者對特定頻道的統計數據
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
  const dailyStats = stats.map((stat) => ({
    date: stat.date.toISOString().split("T")[0],
    watchHours: Math.round((stat.watchSeconds / 3600) * 10) / 10,
    messageCount: stat.messageCount,
    emoteCount: stat.emoteCount,
  }));

  // 構建頻道基本資訊
  const totalWatchHours = dailyStats.reduce((sum, s) => sum + s.watchHours, 0);
  const totalMessages = dailyStats.reduce((sum, s) => sum + s.messageCount, 0);

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
}

/**
 * 獲取觀看者追蹤的所有頻道 (合併自 Twitch Follows 和 觀看歷史)
 */
export async function getFollowedChannels(viewerId: string): Promise<FollowedChannel[]> {
  const cacheKey = `viewer:${viewerId}:channels_list`;

  // P1 Fix: 使用後端快取避免昂貴的 groupBy 聚合查詢 (TTL 5分鐘)
  // 這解決了 Turso 遠端連線下聚合查詢導致的 60s 超時問題
  return cacheManager.getOrSet(
    cacheKey,
    async () => {
      const label = `GetChannels-${viewerId}`;
      console.time(label);

      try {
        // 1. 聚合查詢：找出該 Viewer 在所有頻道的總數據
        console.timeLog(label, "Start Aggregation");

        // Opt: 減少聚合欄位，只取最後觀看日期，如果不需要總時數排序的話
        const stats = await prisma.viewerChannelDailyStat.groupBy({
          by: ["channelId"],
          where: { viewerId },
          _sum: {
            watchSeconds: true,
            messageCount: true,
          },
          _max: {
            date: true,
          },
          orderBy: {
            _max: {
              date: "desc",
            },
          },
        });
        console.timeLog(label, `Aggregation Done: ${stats.length} channels`);

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
        console.timeLog(label, `Follows Fetched: ${follows.length}`);

        // 3. 合併頻道 ID 列表
        const statsChannelIds = new Set(stats.map((s) => s.channelId));
        const followChannelIds = new Set(follows.map((f) => f.channelId));
        const allChannelIds = Array.from(new Set([...statsChannelIds, ...followChannelIds]));

        if (allChannelIds.length === 0) {
          console.timeEnd(label);
          return [];
        }

        // 4. 批量查詢頻道詳細資訊
        console.timeLog(label, `Fetching details for ${allChannelIds.length} channels`);

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
        console.timeLog(label, "Details Fetched");

        // 建立 Stats Map 以便快速查找
        const statsMap = new Map(stats.map((s) => [s.channelId, s]));
        const followsMap = new Map(follows.map((f) => [f.channelId, f.followedAt]));

        // 6. 轉換為前端格式
        const results = channels.map((channel) => {
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
            lastWatched: stat?._max.date?.toISOString() ?? null,
            totalWatchMinutes: Math.floor((stat?._sum.watchSeconds || 0) / 60),
            messageCount: stat?._sum.messageCount ?? 0,
            isExternal: channel.source === "external",
          };
        });

        console.timeLog(label, "Mapping Done");

        // 排序
        const sorted = results.sort((a, b) => {
          // 1. Live first
          if (a.isLive !== b.isLive) return a.isLive ? -1 : 1;
          // 2. Last Watched desc
          if (a.lastWatched && b.lastWatched) {
            return new Date(b.lastWatched).getTime() - new Date(a.lastWatched).getTime();
          }
          return 0;
        });

        console.timeEnd(label);
        return sorted;
      } catch (error) {
        console.timeEnd(label);
        logger.error("ViewerService", "getFollowedChannels failed", error);
        throw error;
      }
    },
    300 // Cache for 5 minutes
  );
}
