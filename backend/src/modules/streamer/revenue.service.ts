import { prisma } from "../../db/prisma";
import { dynamicImport } from "../../utils/dynamic-import";


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

    const tokenData = streamer.twitchTokens[0];
    const broadcasterId = streamer.twitchUserId;

    // 呼叫 Twitch API 獲取訂閱資料 (使用 Twurple 自動刷新)
    const subscriptions = await this.fetchSubscriptionsWithTwurple(broadcasterId, tokenData);

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
   * 使用 Twurple 獲取訂閱資料 (支援自動刷新)
   */
  private async fetchSubscriptionsWithTwurple(
    broadcasterId: string,
    tokenData: import("../../types/twitch.types").TwitchTokenData
  ): Promise<{ total: number; tier1: number; tier2: number; tier3: number }> {
    // 使用 dynamicImport 來載入 ES Module，避免被 TypeScript 轉換為 require()
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { ApiClient } = (await dynamicImport("@twurple/api")) as { ApiClient: any };
    const { RefreshingAuthProvider } = (await dynamicImport("@twurple/auth")) as { RefreshingAuthProvider: any };
    const { twurpleAuthService } = (await dynamicImport("../../services/twurple-auth.service")) as { twurpleAuthService: any };
    const { decryptToken, encryptToken } = (await dynamicImport("../../utils/crypto.utils")) as { decryptToken: any; encryptToken: any };
    /* eslint-enable @typescript-eslint/no-explicit-any */

    const clientId = twurpleAuthService.getClientId();
    const clientSecret = twurpleAuthService.getClientSecret();

    // 解密 Token
    const accessToken = decryptToken(tokenData.accessToken);
    const refreshToken = tokenData.refreshToken ? decryptToken(tokenData.refreshToken) : null;

    if (!refreshToken) {
      throw new Error("No refresh token available for revenue sync");
    }

    const authProvider = new RefreshingAuthProvider({
      clientId,
      clientSecret,
    });

    // 設定刷新回調
    authProvider.onRefresh(async (_userId: string, newTokenData: import("../../types/twitch.types").TwurpleRefreshCallbackData) => {
      console.log(`[RevenueService] Token refreshed for streamer ${broadcasterId}`);
      await prisma.twitchToken.update({
        where: { id: tokenData.id },
        data: {
          accessToken: encryptToken(newTokenData.accessToken),
          refreshToken: newTokenData.refreshToken
            ? encryptToken(newTokenData.refreshToken)
            : undefined,
          expiresAt: newTokenData.expiresIn
            ? new Date(Date.now() + newTokenData.expiresIn * 1000)
            : null,
          lastValidatedAt: new Date(),
        },
      });
    });

    await authProvider.addUserForToken({
      accessToken,
      refreshToken,
      expiresIn: null,
      obtainmentTimestamp: 0,
    }, ["channel:read:subscriptions"]);

    const apiClient = new ApiClient({ authProvider });

    // 使用 Paginator 獲取所有訂閱者
    const result = { total: 0, tier1: 0, tier2: 0, tier3: 0 };

    // 記憶體與超時保護：限制最大訂閱者數量
    const MAX_SUBSCRIPTIONS = 10000;

    try {
      const paginator = apiClient.subscriptions.getSubscriptionsPaginated(broadcasterId);

      for await (const sub of paginator) {
        result.total++;
        if (sub.tier === "1000") result.tier1++;
        else if (sub.tier === "2000") result.tier2++;
        else if (sub.tier === "3000") result.tier3++;

        // 超過上限則停止（極少數大型頻道可能超過）
        if (result.total >= MAX_SUBSCRIPTIONS) {
          console.warn(`[RevenueService] 訂閱者數量超過 ${MAX_SUBSCRIPTIONS}，已截斷`);
          break;
        }
      }
    } catch (error: unknown) {
      // 處理權限不足或 Token 無效的情況
      const apiError = error as import("../../types/twitch.types").TwitchApiError;
      if (apiError.statusCode === 401 || apiError.statusCode === 403) {
        console.error(`[RevenueService] Permission error for ${broadcasterId}:`, apiError.message);
        // 標記 Token 為失效? 暫時不這麼做，以免誤判
      }
      throw error;
    }

    return result;
  }

  /**
   * 獲取訂閱統計趨勢
   */
  async getSubscriptionStats(streamerId: string, days: number = 30): Promise<SubscriptionStats[]> {
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
  async getBitsStats(streamerId: string, days: number = 30): Promise<BitsStats[]> {
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
    const dailyMap = new Map<string, { totalBits: number; eventCount: number }>();

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
  ): Promise<Array<{ userName: string; totalBits: number; eventCount: number }>> {
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
