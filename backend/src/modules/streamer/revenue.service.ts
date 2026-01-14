import { prisma } from "../../db/prisma";
import { env } from "../../config/env";

/**
 * 訂閱層級收益預估 (USD)
 * 標準分潤比例：50%
 */
const REVENUE_PER_SUB = {
  tier1: 4.99 * 0.5, // $2.495
  tier2: 9.99 * 0.5, // $4.995
  tier3: 24.99 * 0.5, // $12.495
};

export interface SubscriptionStats {
  date: string;
  tier1Count: number;
  tier2Count: number;
  tier3Count: number;
  totalSubscribers: number;
  estimatedRevenue: number;
}

export interface BitsStats {
  date: string;
  totalBits: number;
  estimatedRevenue: number;
  eventCount: number;
}

export interface RevenueOverview {
  subscriptions: {
    current: number;
    estimatedMonthlyRevenue: number;
    tier1: number;
    tier2: number;
    tier3: number;
  };
  bits: {
    totalBits: number;
    estimatedRevenue: number;
    eventCount: number;
  };
  totalEstimatedRevenue: number;
}

export class RevenueService {
  /**
   * 同步訂閱快照到資料庫
   */
  async syncSubscriptionSnapshot(streamerId: string): Promise<void> {
    const streamer = await prisma.streamer.findUnique({
      where: { id: streamerId },
      include: {
        twitchTokens: {
          where: { ownerType: "streamer", status: "active" },
          orderBy: { updatedAt: "desc" },
          take: 1,
        },
      },
    });

    if (!streamer || streamer.twitchTokens.length === 0) {
      throw new Error("Streamer not found or no valid token");
    }

    const accessToken = streamer.twitchTokens[0].accessToken;
    const broadcasterId = streamer.twitchUserId;

    // 呼叫 Twitch API 獲取訂閱資料
    const subscriptions = await this.fetchSubscriptionsFromTwitch(
      broadcasterId,
      accessToken
    );

    // 計算預估收益
    const estimatedRevenue =
      subscriptions.tier1 * REVENUE_PER_SUB.tier1 +
      subscriptions.tier2 * REVENUE_PER_SUB.tier2 +
      subscriptions.tier3 * REVENUE_PER_SUB.tier3;

    // 儲存或更新今日快照
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    await prisma.subscriptionSnapshot.upsert({
      where: {
        streamerId_snapshotDate: {
          streamerId,
          snapshotDate: today,
        },
      },
      create: {
        streamerId,
        snapshotDate: today,
        tier1Count: subscriptions.tier1,
        tier2Count: subscriptions.tier2,
        tier3Count: subscriptions.tier3,
        totalSubscribers: subscriptions.total,
        estimatedRevenue,
      },
      update: {
        tier1Count: subscriptions.tier1,
        tier2Count: subscriptions.tier2,
        tier3Count: subscriptions.tier3,
        totalSubscribers: subscriptions.total,
        estimatedRevenue,
      },
    });
  }

  /**
   * 從 Twitch API 獲取訂閱資料
   */
  private async fetchSubscriptionsFromTwitch(
    broadcasterId: string,
    accessToken: string
  ): Promise<{ total: number; tier1: number; tier2: number; tier3: number }> {
    const result = { total: 0, tier1: 0, tier2: 0, tier3: 0 };
    let cursor: string | undefined;

    try {
      do {
        const url = new URL("https://api.twitch.tv/helix/subscriptions");
        url.searchParams.append("broadcaster_id", broadcasterId);
        url.searchParams.append("first", "100");
        if (cursor) url.searchParams.append("after", cursor);

        const response = await fetch(url.toString(), {
          headers: {
            "Client-Id": env.twitchClientId,
            Authorization: `Bearer ${accessToken}`,
          },
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error("[RevenueService] Twitch API error:", errorText);
          throw new Error(`Twitch API error: ${response.status}`);
        }

        const data = await response.json();
        const subs = data.data || [];

        for (const sub of subs) {
          result.total++;
          switch (sub.tier) {
            case "1000":
              result.tier1++;
              break;
            case "2000":
              result.tier2++;
              break;
            case "3000":
              result.tier3++;
              break;
          }
        }

        cursor = data.pagination?.cursor;
      } while (cursor);
    } catch (error) {
      console.error(
        "[RevenueService] fetchSubscriptionsFromTwitch error:",
        error
      );
      throw error;
    }

    return result;
  }

  /**
   * 獲取訂閱統計趨勢
   */
  async getSubscriptionStats(
    streamerId: string,
    days: number = 30
  ): Promise<SubscriptionStats[]> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    const snapshots = await prisma.subscriptionSnapshot.findMany({
      where: {
        streamerId,
        snapshotDate: { gte: startDate },
      },
      orderBy: { snapshotDate: "asc" },
    });

    return snapshots.map((snap) => ({
      date: snap.snapshotDate.toISOString().split("T")[0],
      tier1Count: snap.tier1Count,
      tier2Count: snap.tier2Count,
      tier3Count: snap.tier3Count,
      totalSubscribers: snap.totalSubscribers,
      estimatedRevenue: snap.estimatedRevenue || 0,
    }));
  }

  /**
   * 獲取 Bits 統計趨勢
   */
  async getBitsStats(
    streamerId: string,
    days: number = 30
  ): Promise<BitsStats[]> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    // 按日期聚合 Bits 事件
    const events = await prisma.cheerEvent.findMany({
      where: {
        streamerId,
        cheeredAt: { gte: startDate },
      },
      orderBy: { cheeredAt: "asc" },
    });

    // 按日期分組
    const dailyMap = new Map<
      string,
      { totalBits: number; eventCount: number }
    >();

    for (const event of events) {
      const dateKey = event.cheeredAt.toISOString().split("T")[0];
      const existing = dailyMap.get(dateKey) || { totalBits: 0, eventCount: 0 };
      existing.totalBits += event.bits;
      existing.eventCount++;
      dailyMap.set(dateKey, existing);
    }

    // 轉換為陣列
    return Array.from(dailyMap.entries()).map(([date, data]) => ({
      date,
      totalBits: data.totalBits,
      estimatedRevenue: data.totalBits * 0.01, // 100 Bits = $1 USD
      eventCount: data.eventCount,
    }));
  }

  /**
   * 獲取收益總覽
   */
  async getRevenueOverview(streamerId: string): Promise<RevenueOverview> {
    // 獲取最新訂閱快照
    const latestSnapshot = await prisma.subscriptionSnapshot.findFirst({
      where: { streamerId },
      orderBy: { snapshotDate: "desc" },
    });

    // 獲取本月 Bits 統計
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const bitsAgg = await prisma.cheerEvent.aggregate({
      where: {
        streamerId,
        cheeredAt: { gte: startOfMonth },
      },
      _sum: { bits: true },
      _count: true,
    });

    const totalBits = bitsAgg._sum.bits || 0;
    const bitsRevenue = totalBits * 0.01;

    const subRevenue = latestSnapshot?.estimatedRevenue || 0;

    return {
      subscriptions: {
        current: latestSnapshot?.totalSubscribers || 0,
        estimatedMonthlyRevenue: subRevenue,
        tier1: latestSnapshot?.tier1Count || 0,
        tier2: latestSnapshot?.tier2Count || 0,
        tier3: latestSnapshot?.tier3Count || 0,
      },
      bits: {
        totalBits,
        estimatedRevenue: bitsRevenue,
        eventCount: bitsAgg._count,
      },
      totalEstimatedRevenue: subRevenue + bitsRevenue,
    };
  }

  /**
   * 獲取 Top 贊助者排行榜
   */
  async getTopSupporters(
    streamerId: string,
    limit: number = 10
  ): Promise<
    Array<{ userName: string; totalBits: number; eventCount: number }>
  > {
    const supporters = await prisma.cheerEvent.groupBy({
      by: ["userName"],
      where: {
        streamerId,
        isAnonymous: false,
        userName: { not: null },
      },
      _sum: { bits: true },
      _count: true,
      orderBy: { _sum: { bits: "desc" } },
      take: limit,
    });

    return supporters.map((s) => ({
      userName: s.userName || "Unknown",
      totalBits: s._sum.bits || 0,
      eventCount: s._count,
    }));
  }
}

export const revenueService = new RevenueService();
