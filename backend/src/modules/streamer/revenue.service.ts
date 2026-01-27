import { prisma } from "../../db/prisma";
import { dynamicImport } from "../../utils/dynamic-import";
import { cacheManager, CacheKeys, CacheTTL } from "../../utils/cache-manager";
import {
  REVENUE_SHARE,
  BITS_TO_USD_RATE,
  SUBSCRIPTION_SYNC,
  QUERY_LIMITS,
} from "../../config/revenue.config";

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
      subscriptions.tier1 * REVENUE_SHARE.tier1 +
      subscriptions.tier2 * REVENUE_SHARE.tier2 +
      subscriptions.tier3 * REVENUE_SHARE.tier3;

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
    const { ApiClient } = (await dynamicImport("@twurple/api")) as typeof import("@twurple/api");
    const { RefreshingAuthProvider } = (await dynamicImport(
      "@twurple/auth"
    )) as typeof import("@twurple/auth");
    const { twurpleAuthService } = (await dynamicImport(
      process.env.TS_NODE_DEV
        ? "file:///C:/Users/Terry.Lin/Coding1/Bmad/backend/src/services/twurple-auth.service.ts"
        : "../../services/twurple-auth.service"
    )) as {
      twurpleAuthService: {
        getClientId: () => string;
        getClientSecret: () => string;
      };
    };
    const { decryptToken, encryptToken } = (await dynamicImport(
      process.env.TS_NODE_DEV
        ? "file:///C:/Users/Terry.Lin/Coding1/Bmad/backend/src/utils/crypto.utils.ts"
        : "../../utils/crypto.utils"
    )) as {
      decryptToken: (encrypted: string) => string;
      encryptToken: (token: string) => string;
    };

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

    // 設定刷新回調（含錯誤處理）
    authProvider.onRefresh(
      async (
        _userId: string,
        newTokenData: import("../../types/twitch.types").TwurpleRefreshCallbackData
      ) => {
        try {
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
          console.log(`[RevenueService] Token successfully saved to database`);
        } catch (error) {
          // Token 刷新成功但儲存失敗 - 記錄錯誤但不中斷流程
          // 因為 Twurple 已經更新了記憶體中的 token，這次請求仍可正常進行
          console.error(`[RevenueService] Failed to save refreshed token to database:`, error);
          // 可選：發送到監控系統（Sentry）
          if (process.env.SENTRY_DSN) {
            const Sentry = await import("@sentry/node");
            Sentry.captureException(error, {
              tags: { component: "token-refresh" },
              extra: { streamerId: broadcasterId, tokenId: tokenData.id },
            });
          }
        }
      }
    );

    await authProvider.addUserForToken(
      {
        accessToken,
        refreshToken,
        expiresIn: null,
        obtainmentTimestamp: 0,
      },
      ["channel:read:subscriptions"]
    );

    const apiClient = new ApiClient({ authProvider });

    // 使用 Paginator 獲取所有訂閱者
    const result = { total: 0, tier1: 0, tier2: 0, tier3: 0 };

    // 記憶體與超時保護：限制最大訂閱者數量和時間
    const startTime = Date.now();

    try {
      // 先嘗試快速方式：獲取第一頁來取得總數
      const firstPage = await apiClient.subscriptions.getSubscriptions(broadcasterId, {
        limit: 100,
      });

      // 如果訂閱者很少，直接計算第一頁
      if (firstPage.data.length < 100) {
        for (const sub of firstPage.data) {
          result.total++;
          if (sub.tier === "1000") result.tier1++;
          else if (sub.tier === "2000") result.tier2++;
          else if (sub.tier === "3000") result.tier3++;
        }
        return result;
      }

      // 訂閱者較多時，使用分頁遍歷
      const paginator = apiClient.subscriptions.getSubscriptionsPaginated(broadcasterId);

      for await (const sub of paginator) {
        result.total++;
        if (sub.tier === "1000") result.tier1++;
        else if (sub.tier === "2000") result.tier2++;
        else if (sub.tier === "3000") result.tier3++;

        // 超過上限或時間過長則停止
        if (result.total >= SUBSCRIPTION_SYNC.MAX_SUBSCRIPTIONS) {
          console.error(`[RevenueService] 訂閱者數量超過 ${SUBSCRIPTION_SYNC.MAX_SUBSCRIPTIONS}`);
          throw new Error(
            `SUBSCRIPTION_LIMIT_EXCEEDED: Channel has more than ${SUBSCRIPTION_SYNC.MAX_SUBSCRIPTIONS} subscribers. Please contact support for enterprise solutions.`
          );
        }

        if (Date.now() - startTime > SUBSCRIPTION_SYNC.MAX_TIME_MS) {
          console.error(
            `[RevenueService] 同步超時 (${SUBSCRIPTION_SYNC.MAX_TIME_MS}ms)，目前已獲取 ${result.total} 筆`
          );
          throw new Error(
            `SYNC_TIMEOUT: Subscription sync exceeded time limit. Retrieved ${result.total} subscriptions before timeout.`
          );
        }
      }
    } catch (error: unknown) {
      // 處理權限不足或 Token 無效的情況
      const apiError = error as import("../../types/twitch.types").TwitchApiError;
      if (apiError.statusCode === 401 || apiError.statusCode === 403) {
        console.error(`[RevenueService] Permission error for ${broadcasterId}:`, apiError.message);
        throw new Error("Permission denied - requires Affiliate/Partner status");
      }
      throw error;
    }

    return result;
  }

  /**
   * 獲取訂閱統計趨勢（帶快取）
   */
  async getSubscriptionStats(streamerId: string, days: number = 30): Promise<SubscriptionStats[]> {
    // 參數驗證
    if (!streamerId?.trim()) {
      throw new Error("Invalid streamerId");
    }
    if (days < QUERY_LIMITS.MIN_DAYS || days > QUERY_LIMITS.MAX_DAYS) {
      throw new Error(`Days must be between ${QUERY_LIMITS.MIN_DAYS} and ${QUERY_LIMITS.MAX_DAYS}`);
    }

    // 使用快取（5 分鐘 TTL）
    return cacheManager.getOrSet(
      CacheKeys.revenueSubscriptions(streamerId, days),
      async () => {
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
      },
      CacheTTL.MEDIUM
    );
  }

  /**
   * 獲取 Bits 統計趨勢（帶快取，優化為資料庫聚合）
   */
  async getBitsStats(streamerId: string, days: number = 30): Promise<BitsStats[]> {
    // 參數驗證
    if (!streamerId?.trim()) {
      throw new Error("Invalid streamerId");
    }
    if (days < QUERY_LIMITS.MIN_DAYS || days > QUERY_LIMITS.MAX_DAYS) {
      throw new Error(`Days must be between ${QUERY_LIMITS.MIN_DAYS} and ${QUERY_LIMITS.MAX_DAYS}`);
    }

    // 使用快取（5 分鐘 TTL）
    return cacheManager.getOrSet(
      CacheKeys.revenueBits(streamerId, days),
      async () => {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        startDate.setHours(0, 0, 0, 0);

        // 優化：使用資料庫 GROUP BY 而非記憶體聚合
        // 注意：SQLite 不直接支援按日期分組，需要使用 DATE() 函數
        const results = await prisma.$queryRaw<
          Array<{
            date: string;
            totalBits: bigint;
            eventCount: bigint;
          }>
        >`
          SELECT
            DATE(cheeredAt) as date,
            SUM(bits) as totalBits,
            COUNT(*) as eventCount
          FROM cheer_events
          WHERE streamerId = ${streamerId}
            AND cheeredAt >= ${startDate.toISOString()}
          GROUP BY DATE(cheeredAt)
          ORDER BY date ASC
        `;

        return results.map((row) => ({
          date: row.date,
          totalBits: Number(row.totalBits),
          estimatedRevenue: Number(row.totalBits) * BITS_TO_USD_RATE,
          eventCount: Number(row.eventCount),
        }));
      },
      CacheTTL.MEDIUM
    );
  }

  /**
   * 獲取收益總覽（帶快取）
   */
  async getRevenueOverview(streamerId: string): Promise<RevenueOverview> {
    // 參數驗證
    if (!streamerId?.trim()) {
      throw new Error("Invalid streamerId");
    }

    // 使用快取（1 分鐘 TTL，因為是總覽資料需要較即時）
    return cacheManager.getOrSet(
      CacheKeys.revenueOverview(streamerId),
      async () => {
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
        const bitsRevenue = totalBits * BITS_TO_USD_RATE;

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
      },
      CacheTTL.SHORT
    );
  }

  /**
   * 獲取 Top 贊助者排行榜
   */
  async getTopSupporters(
    streamerId: string,
    limit: number = 10
  ): Promise<Array<{ userName: string; totalBits: number; eventCount: number }>> {
    // 參數驗證
    if (!streamerId?.trim()) {
      throw new Error("Invalid streamerId");
    }
    if (limit < QUERY_LIMITS.MIN_LIMIT || limit > QUERY_LIMITS.MAX_LIMIT) {
      throw new Error(
        `Limit must be between ${QUERY_LIMITS.MIN_LIMIT} and ${QUERY_LIMITS.MAX_LIMIT}`
      );
    }

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
