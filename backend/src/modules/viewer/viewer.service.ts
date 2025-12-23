import { prisma } from "../../db/prisma";
import { twurpleHelixService } from "../../services/twitch-helix.service";

export async function recordConsent(viewerId: string, consentVersion = 1) {
  return prisma.viewer.update({
    where: { id: viewerId },
    data: {
      consentedAt: new Date(),
      consentVersion,
    },
  });
}

export interface ViewerDailyStat {
  date: string; // ISO Date string (YYYY-MM-DD)
  watchHours: number;
  messageCount: number;
  emoteCount: number;
}

export interface ViewerChannelStatsResponse {
  dailyStats: ViewerDailyStat[];
  timeRange: {
    startDate: string;
    endDate: string;
    days: number;
  };
}

/**
 * 獲取觀眾在特定頻道的每日統計數據
 * @param viewerId 觀眾 ID
 * @param channelId 頻道 ID
 * @param days 天數 (可選，與 startDate/endDate 二選一)
 * @param startDate 開始日期 (可選)
 * @param endDate 結束日期 (可選)
 */
export async function getChannelStats(
  viewerId: string,
  channelId: string,
  days?: number,
  startDate?: Date,
  endDate?: Date
): Promise<ViewerChannelStatsResponse> {
  // 計算日期範圍
  let queryStartDate: Date;
  let queryEndDate: Date;
  let actualDays: number;

  if (startDate && endDate) {
    queryStartDate = startDate;
    queryEndDate = endDate;
    actualDays =
      Math.ceil(
        (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
      ) + 1;
  } else {
    const daysToQuery = days ?? 30;
    queryEndDate = new Date();
    queryStartDate = new Date();
    queryStartDate.setDate(queryEndDate.getDate() - daysToQuery);
    actualDays = daysToQuery;
  }

  const stats = await prisma.viewerChannelDailyStat.findMany({
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
  });

  // 轉換為前端友好的格式
  const dailyStats = stats.map((stat) => ({
    date: stat.date.toISOString().split("T")[0],
    watchHours: Math.round((stat.watchSeconds / 3600) * 10) / 10,
    messageCount: stat.messageCount,
    emoteCount: stat.emoteCount,
  }));

  return {
    dailyStats,
    timeRange: {
      startDate: queryStartDate.toISOString().split("T")[0],
      endDate: queryEndDate.toISOString().split("T")[0],
      days: actualDays,
    },
  };
}

/**
 * 獲取觀眾有互動紀錄的所有頻道列表 (用於首頁)
 */
export async function getFollowedChannels(viewerId: string) {
  // 1. 聚合查詢：找出該 Viewer 在所有頻道的總數據
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

  // 2. 獲取 Story 3.6 同步的外部追蹤頻道
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

  // 3. 合併頻道 ID 列表 (去重)
  const statsChannelIds = new Set(stats.map((s) => s.channelId));
  const followChannelIds = new Set(follows.map((f) => f.channelId));
  const allChannelIds = Array.from(
    new Set([...statsChannelIds, ...followChannelIds])
  );

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
      // 檢查是否有進行中的實況 (endedAt 為 null)
      streamSessions: {
        where: {
          endedAt: null,
        },
        take: 1,
      },
    },
  });

  // 建立 Stats Map 以便快速查找
  const statsMap = new Map(stats.map((s) => [s.channelId, s]));

  // 5. 從 Twitch API 獲取所有開台頻道的即時資訊（觀眾數、開台時間）
  // 注意: Twitch API 一次最多查詢 100 個，需要分批處理
  const twitchChannelIds = channels.map((ch) => ch.twitchChannelId);
  let liveStreamsMap = new Map<
    string,
    { viewerCount: number; startedAt: Date; gameName: string }
  >();

  try {
    // 分批處理（每批最多 100 個）
    const BATCH_SIZE = 100;
    const allLiveStreams: Awaited<
      ReturnType<typeof twurpleHelixService.getStreamsByUserIds>
    > = [];

    for (let i = 0; i < twitchChannelIds.length; i += BATCH_SIZE) {
      const batch = twitchChannelIds.slice(i, i + BATCH_SIZE);
      const batchStreams = await twurpleHelixService.getStreamsByUserIds(batch);
      allLiveStreams.push(...batchStreams);
    }

    liveStreamsMap = new Map(
      allLiveStreams.map((s) => [
        s.userId,
        {
          viewerCount: s.viewerCount,
          startedAt: s.startedAt,
          gameName: s.gameName,
        },
      ])
    );
  } catch {
    // 如果 API 失敗，繼續使用 DB 資料
  }

  // 建立 Follows Map 以便查找追蹤時間
  const followsMap = new Map(follows.map((f) => [f.channelId, f.followedAt]));

  // 6. 轉換為前端格式
  const results = channels.map((channel) => {
    const stat = statsMap.get(channel.id);
    const liveInfo = liveStreamsMap.get(channel.twitchChannelId);
    const followedAt = followsMap.get(channel.id);

    // 使用 Twitch API 的即時狀態
    const isLive = !!liveInfo;

    return {
      id: channel.id,
      channelName: channel.channelName,
      displayName: channel.streamer?.displayName || channel.channelName,
      avatarUrl: channel.streamer?.avatarUrl || "",
      category: liveInfo?.gameName || "Just Chatting",
      isLive,
      viewerCount: liveInfo?.viewerCount ?? null,
      streamStartedAt: liveInfo?.startedAt?.toISOString() ?? null,
      followedAt: followedAt?.toISOString() ?? null,
      tags: ["中文", "遊戲"],
      // 如果有統計數據則顯示最後觀看時間，否則顯示 null
      lastWatched: stat?._max.date?.toISOString() ?? null,
      totalWatchMinutes: Math.floor((stat?._sum.watchSeconds || 0) / 60),
      messageCount: stat?._sum.messageCount ?? 0,
      isExternal: channel.source === "external", // Optional: 標記來源
    };
  });

  // 排序優先順序：
  // 1. 開台中 (isLive) 的頻道優先
  // 2. 有看過的排前面 (依最後觀看時間)
  // 3. 沒看過的排後面 (依名稱)
  return results.sort((a, b) => {
    // 優先顯示開台中的頻道
    if (a.isLive && !b.isLive) return -1;
    if (!a.isLive && b.isLive) return 1;

    // 都開台或都沒開台時，依最後觀看時間排序
    if (a.lastWatched && b.lastWatched) {
      return (
        new Date(b.lastWatched).getTime() - new Date(a.lastWatched).getTime()
      );
    }
    if (a.lastWatched) return -1;
    if (b.lastWatched) return 1;

    // 都沒看過時，依名稱排序
    return a.displayName.localeCompare(b.displayName);
  });
}
