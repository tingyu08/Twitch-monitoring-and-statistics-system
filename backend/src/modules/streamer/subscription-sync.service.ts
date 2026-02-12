import { prisma } from "../../db/prisma";
import { TwitchOAuthClient } from "../auth/twitch-oauth.client";
import { streamerLogger } from "../../utils/logger";
import { decryptToken } from "../../utils/crypto.utils";

const twitchClient = new TwitchOAuthClient();

export interface SubscriptionDataPoint {
  date: string; // ISO date string (YYYY-MM-DD)
  subsTotal: number | null;
  subsDelta: number | null;
}

export interface SubscriptionTrendResponse {
  range: string;
  data: SubscriptionDataPoint[];
  hasExactData: boolean;
  isEstimated: boolean;
  estimateSource: string;
  minDataDays: number;
  currentDataDays: number;
  availableDays: number;
}

/**
 * 同步實況主訂閱數據快照
 * 獲取當前訂閱數並儲存到 ChannelDailyStat
 * @param streamerId - 實況主 ID
 */
export async function syncSubscriptionSnapshot(streamerId: string): Promise<void> {
  try {
    // 1. 取得實況主的頻道
    const channel = await prisma.channel.findFirst({
      where: { streamerId },
      include: { streamer: true },
    });

    if (!channel) {
      throw new Error(`No channel found for streamer ID: ${streamerId}`);
    }

    // 2. 取得實況主的 Twitch access token
    const token = await prisma.twitchToken.findFirst({
      where: {
        ownerType: "streamer",
        streamerId,
      },
    });

    if (!token) {
      throw new Error(`No Twitch token found for streamer ID: ${streamerId}`);
    }

    // 3. 呼叫 Twitch API 獲取訂閱數
    let accessToken = token.accessToken;
    try {
      accessToken = decryptToken(token.accessToken);
    } catch {
      // backward compatibility: historical plain text token records
    }
    const { total: currentSubsTotal } = await twitchClient.getBroadcasterSubscriptions(
      channel.twitchChannelId,
      accessToken
    );

    // 4. 取得今天的日期 (YYYY-MM-DD)
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 5. 取得昨天的 ChannelDailyStat 以計算 delta
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const yesterdayStats = await prisma.channelDailyStat.findUnique({
      where: {
        channelId_date: {
          channelId: channel.id,
          date: yesterday,
        },
      },
    });

    const subsDelta = yesterdayStats?.subsTotal
      ? currentSubsTotal - yesterdayStats.subsTotal
      : null; // 如果沒有昨天的資料，delta 為 null

    // 6. Upsert 今天的 ChannelDailyStat
    await prisma.channelDailyStat.upsert({
      where: {
        channelId_date: {
          channelId: channel.id,
          date: today,
        },
      },
      update: {
        subsTotal: currentSubsTotal,
        subsDelta,
        updatedAt: new Date(),
      },
      create: {
        channelId: channel.id,
        date: today,
        streamSeconds: 0,
        streamCount: 0,
        subsTotal: currentSubsTotal,
        subsDelta,
      },
    });

    streamerLogger.info(`Subscription snapshot synced for streamer ${streamerId}`, {
      subsTotal: currentSubsTotal,
      subsDelta,
      date: today.toISOString().split("T")[0],
    });
  } catch (error) {
    streamerLogger.error("Failed to sync subscription snapshot:", error);
    throw error;
  }
}

/**
 * 取得實況主訂閱趨勢資料
 * @param streamerId - 實況主 ID
 * @param range - 時間範圍 ('7d' | '30d' | '90d')
 * @returns 訂閱趨勢資料
 */
export async function getSubscriptionTrend(
  streamerId: string,
  range: string = "30d"
): Promise<SubscriptionTrendResponse> {
  // 1. 解析時間範圍
  const now = new Date();
  let days = 30;
  if (range === "7d") days = 7;
  if (range === "90d") days = 90;

  const cutoffDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  cutoffDate.setHours(0, 0, 0, 0);

  // 2. 取得實況主的頻道 ID
  const channel = await prisma.channel.findFirst({
    where: { streamerId },
  });

  if (!channel) {
    return {
      range,
      data: [],
      hasExactData: false,
      isEstimated: true,
      estimateSource: "daily_snapshot",
      minDataDays: 7,
      currentDataDays: 0,
      availableDays: 0,
    };
  }

  // 3. 查詢指定期間的 ChannelDailyStat (只取有訂閱資料的記錄)
  const stats = await prisma.channelDailyStat.findMany({
    where: {
      channelId: channel.id,
      date: {
        gte: cutoffDate,
      },
      subsTotal: {
        not: null, // 只取有訂閱資料的記錄
      },
    },
    select: {
      date: true,
      subsTotal: true,
      subsDelta: true,
    },
    orderBy: {
      date: "asc",
    },
  });

  // 4. 將資料轉換為 SubscriptionDataPoint[]
  const dataPoints: SubscriptionDataPoint[] = stats.map((stat) => ({
    date: stat.date.toISOString().split("T")[0], // YYYY-MM-DD
    subsTotal: stat.subsTotal,
    subsDelta: stat.subsDelta,
  }));

  // 5. 計算實際可用天數
  const availableDays = stats.length;

  return {
    range,
    data: dataPoints,
    hasExactData: false, // 永遠是 false，因為是每日快照
    isEstimated: true, // 永遠是 true
    estimateSource: "daily_snapshot",
    minDataDays: 7, // 建議至少 7 天資料
    currentDataDays: availableDays,
    availableDays,
  };
}
