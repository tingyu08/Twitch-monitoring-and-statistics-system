import { prisma } from "../../db/prisma";

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

// 開發用 Mock 資料映射，確保與前端一致
const MOCK_CHANNEL_MAP: Record<
  string,
  { name: string; display: string; avatarUrl: string; isLive: boolean }
> = {
  ch_1: {
    name: "shroud",
    display: "Shroud",
    avatarUrl: "https://ui-avatars.com/api/?name=Shroud&background=random",
    isLive: true,
  },
  ch_2: {
    name: "pokimane",
    display: "Pokimane",
    avatarUrl: "https://ui-avatars.com/api/?name=Pokimane&background=random",
    isLive: false,
  },
  ch_3: {
    name: "xqcow",
    display: "xQc",
    avatarUrl: "https://ui-avatars.com/api/?name=xQc&background=random",
    isLive: true,
  },
  ch_4: {
    name: "lilypichu",
    display: "LilyPichu",
    avatarUrl: "https://ui-avatars.com/api/?name=LilyPichu&background=random",
    isLive: false,
  },
  ch_5: {
    name: "disguisedtoast",
    display: "DisguisedToast",
    avatarUrl:
      "https://ui-avatars.com/api/?name=DisguisedToast&background=random",
    isLive: false,
  },
};

/**
 * 確保頻道存在 (Helper for seeding)
 * 如果頻道不存在，會嘗試建立它；如果存在，更新其資訊以匹配 Mock Map
 */
async function ensureChannelExists(channelId: string) {
  const mockInfo = MOCK_CHANNEL_MAP[channelId] || {
    name: `mock_channel_${channelId}`,
    display: `Mock Channel ${channelId}`,
    avatarUrl: `https://ui-avatars.com/api/?name=Mock&background=random`,
    isLive: false, // Default for non-mapped channels
  };

  // 1. 確保 Streamer 存在並更新資訊
  // 為了簡化，我們為每個 mock channel 創建一個專屬 streamer，或者重用已有的
  // 這裡我們假設每個 channelId 對應一個 Unique Streamer (為了名稱正確)
  const twitchUserId = `mock_streamer_${channelId}`; // Unique ID per channel

  const streamer = await prisma.streamer.upsert({
    where: { twitchUserId },
    update: {
      displayName: mockInfo.display,
      // 強制更新頭像，確保舊資料也能獲得新頭像
      avatarUrl: mockInfo.avatarUrl,
    },
    create: {
      twitchUserId,
      displayName: mockInfo.display,
      email: `${mockInfo.name}@example.com`,
      avatarUrl: mockInfo.avatarUrl,
    },
  });

  // 2. 確保 Channel 存在並更新
  await prisma.channel.upsert({
    where: { id: channelId },
    update: {
      channelName: mockInfo.name,
      streamerId: streamer.id, // 確保關聯到正確的 named streamer
    },
    create: {
      id: channelId,
      streamerId: streamer.id,
      twitchChannelId: `mock_twitch_${channelId}`,
      channelName: mockInfo.name,
      channelUrl: `https://twitch.tv/${mockInfo.name}`,
    },
  });
}

/**
 * [DEBUG ONLY] 為特定頻道的觀眾生成測試用種子數據
 * 這樣我們在沒有真實 Worker 的情況下也能展示 Story 2.2 的圖表
 */
export async function seedChannelStats(viewerId: string, channelId: string) {
  // 0. 重要：確保 DB 中有這個 Channel，否則會報 Foreign Key Error
  await ensureChannelExists(channelId);

  const daysToSeed = 30;
  const now = new Date();

  // 檢查 Story 2.2 數據
  const stats = await prisma.viewerChannelDailyStat.findMany({
    where: { viewerId, channelId },
    select: { watchSeconds: true },
  });

  const hasValidData =
    stats.length >= 10 && stats.reduce((sum, s) => sum + s.watchSeconds, 0) > 0;

  // 只有當完全沒有數據時才重新 Seed，或者如果我們想強制添加 Message Stats，可以檢查 Message Agg
  const messageAggs = await prisma.viewerChannelMessageDailyAgg.findMany({
    where: { viewerId, channelId },
  });

  if (hasValidData && messageAggs.length > 0) {
    return;
  }

  const promises = [];
  for (let i = 0; i < daysToSeed; i++) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    date.setHours(0, 0, 0, 0);

    // 隨機生成一些合理的數據
    // Story 2.2 Stats
    const hasData = Math.random() > 0.2; // 80% 機率有數據
    const watchSeconds = hasData
      ? Math.floor(Math.random() * 4 * 3600) + 300
      : 0; // 至少 5 分鐘
    const messageCount = hasData
      ? Math.floor((watchSeconds / 60) * (Math.random() * 2))
      : 0; // 每分鐘約 0-2 則留言
    const emoteCount = hasData ? Math.floor(messageCount * 0.4) : 0;

    // Story 2.2
    promises.push(
      prisma.viewerChannelDailyStat.upsert({
        where: {
          viewerId_channelId_date: {
            viewerId,
            channelId,
            date,
          },
        },
        update: {
          watchSeconds,
          messageCount,
          emoteCount,
        },
        create: {
          viewerId,
          channelId,
          date,
          watchSeconds,
          messageCount,
          emoteCount,
        },
      })
    );

    // Story 2.3: Message Agg Stats
    // 生成更詳細的互動數據
    const chatMessages = Math.floor(messageCount * 0.8);
    const cheers = Math.random() > 0.9 ? Math.floor(Math.random() * 5) : 0;
    const subscriptions = Math.random() > 0.95 ? 1 : 0;
    const raids = Math.random() > 0.98 ? 1 : 0;
    const totalBits = cheers * 100;

    promises.push(
      prisma.viewerChannelMessageDailyAgg.upsert({
        where: {
          viewerId_channelId_date: {
            viewerId,
            channelId,
            date,
          },
        },
        update: {
          totalMessages: messageCount, // 保持與 DailyStat 一致
          chatMessages,
          cheers,
          subscriptions,
          raids,
          totalBits,
        },
        create: {
          viewerId,
          channelId,
          date,
          totalMessages: messageCount,
          chatMessages,
          cheers,
          subscriptions,
          raids,
          totalBits,
        },
      })
    );
  }

  await Promise.all(promises);
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

  // 2. 填充頻道詳細資訊
  const results = await Promise.all(
    stats.map(async (stat) => {
      const channel = await prisma.channel.findUnique({
        where: { id: stat.channelId },
        include: { streamer: true },
      });

      if (!channel) return null;

      // 使用 Mock Map 中的固定 Live 狀態，保持前後端一致
      const mockInfo = MOCK_CHANNEL_MAP[stat.channelId];
      const isLive = mockInfo ? mockInfo.isLive : false;

      return {
        id: channel.id,
        channelName: channel.channelName, // Username (e.g. "shroud")
        displayName: channel.streamer?.displayName || channel.channelName, // Display Name (e.g. "Shroud")
        avatarUrl: channel.streamer?.avatarUrl || "",
        category: "Just Chatting",
        isLive,
        tags: ["中文", "遊戲"],
        lastWatched: stat._max.date?.toISOString() ?? null,
        totalWatchMinutes: Math.floor((stat._sum.watchSeconds || 0) / 60),
        messageCount: stat._sum.messageCount ?? 0, // 新增
      };
    })
  );

  return results.filter((r) => r !== null);
}
