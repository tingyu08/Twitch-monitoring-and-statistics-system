import { prisma } from "../../db/prisma";
import { importTwurpleApi, importTwurpleAuth } from "../../utils/dynamic-import";
import { decryptToken, encryptToken } from "../../utils/crypto.utils";
import { cacheManager, CacheKeys, CacheTTL } from "../../utils/cache-manager";
import { logger } from "../../utils/logger";
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

const BITS_DAILY_AGG_REFRESH_TTL_SECONDS = 120;
const BITS_DAILY_AGG_BOOTSTRAP_TTL_SECONDS = 24 * 60 * 60;
const BITS_DAILY_AGG_RECENT_REFRESH_DAYS = 3;
const BITS_DAILY_AGG_MAX_RETRIES = 3;
const BITS_DAILY_AGG_RETRY_BASE_MS = 250;

export class RevenueService {
  private bitsDailyAggRefreshLocks = new Map<string, Promise<void>>();

  private toDateKey(date: Date): string {
    return date.toISOString().split("T")[0];
  }

  private addDays(date: Date, days: number): Date {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
  }

  private maxDateKey(a: string, b: string): string {
    return a > b ? a : b;
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async runBitsDailyAggWithRetry(operationName: string, operation: () => Promise<void>): Promise<void> {
    for (let attempt = 1; attempt <= BITS_DAILY_AGG_MAX_RETRIES; attempt += 1) {
      try {
        await operation();
        return;
      } catch (error) {
        if (attempt >= BITS_DAILY_AGG_MAX_RETRIES) {
          throw error;
        }

        const backoffMs = BITS_DAILY_AGG_RETRY_BASE_MS * 2 ** (attempt - 1);
        logger.warn(
          "RevenueService",
          `${operationName} failed (attempt ${attempt}/${BITS_DAILY_AGG_MAX_RETRIES}), retrying in ${backoffMs}ms`,
          error
        );
        await this.sleep(backoffMs);
      }
    }
  }

  private async withBitsDailyAggRefreshLock(lockKey: string, operation: () => Promise<void>): Promise<void> {
    const previous = this.bitsDailyAggRefreshLocks.get(lockKey) || Promise.resolve();

    let releaseCurrent: (() => void) | null = null;
    const current = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });

    this.bitsDailyAggRefreshLocks.set(lockKey, current);

    await previous;

    try {
      await operation();
    } finally {
      releaseCurrent?.();
      if (this.bitsDailyAggRefreshLocks.get(lockKey) === current) {
        this.bitsDailyAggRefreshLocks.delete(lockKey);
      }
    }
  }

  private async refreshBitsDailyAgg(streamerId: string, startDateKey: string): Promise<void> {
    await this.runBitsDailyAggWithRetry("refreshBitsDailyAgg", async () => {
      await prisma.$executeRaw`
        INSERT INTO cheer_daily_agg (streamerId, date, totalBits, eventCount, updatedAt)
        SELECT
          streamerId,
          date(cheeredDate) as date,
          COALESCE(SUM(bits), 0) as totalBits,
          COUNT(*) as eventCount,
          CURRENT_TIMESTAMP as updatedAt
        FROM cheer_events
        WHERE streamerId = ${streamerId}
          AND cheeredDate IS NOT NULL
          AND date(cheeredDate) >= ${startDateKey}
        GROUP BY streamerId, date(cheeredDate)
        ON CONFLICT(streamerId, date) DO UPDATE SET
          totalBits = excluded.totalBits,
          eventCount = excluded.eventCount,
          updatedAt = CURRENT_TIMESTAMP
      `;
    });
  }

  private async hasBitsDailyAggData(streamerId: string, startDateKey: string): Promise<boolean> {
    const rows = await prisma.$queryRaw<Array<{ count: bigint | number }>>`
      SELECT COUNT(1) as count
      FROM cheer_daily_agg
      WHERE streamerId = ${streamerId}
        AND date >= ${startDateKey}
    `;

    return Number(rows[0]?.count || 0) > 0;
  }

  private async ensureBitsDailyAggFresh(streamerId: string, startDateKey: string): Promise<void> {
    const bootstrapKey = `revenue:${streamerId}:bits_daily_agg_bootstrap:${startDateKey}`;

    await cacheManager.getOrSet(
      bootstrapKey,
      async () => {
        await this.withBitsDailyAggRefreshLock(`bootstrap:${streamerId}:${startDateKey}`, async () => {
          const hasData = await this.hasBitsDailyAggData(streamerId, startDateKey);
          if (!hasData) {
            await this.refreshBitsDailyAgg(streamerId, startDateKey);
          }
        });
        return true;
      },
      BITS_DAILY_AGG_BOOTSTRAP_TTL_SECONDS
    );

    const recentStartDate = this.addDays(new Date(), -BITS_DAILY_AGG_RECENT_REFRESH_DAYS);
    recentStartDate.setHours(0, 0, 0, 0);
    const recentStartKey = this.maxDateKey(startDateKey, this.toDateKey(recentStartDate));
    const refreshKey = `revenue:${streamerId}:bits_daily_agg_recent_refresh:${recentStartKey}`;

    await cacheManager.getOrSet(
      refreshKey,
      async () => {
        await this.withBitsDailyAggRefreshLock(`recent:${streamerId}:${recentStartKey}`, async () => {
          await this.refreshBitsDailyAgg(streamerId, recentStartKey);
        });
        return true;
      },
      BITS_DAILY_AGG_REFRESH_TTL_SECONDS
    );
  }

  async prewarmRevenueCache(streamerId: string): Promise<void> {
    await Promise.allSettled([
      this.getRevenueOverview(streamerId),
      this.getSubscriptionStats(streamerId, 30),
      this.getBitsStats(streamerId, 30),
    ]);
  }

  /**
   * 同步訂閱快照到資料庫
   */
  /**
   * 同步訂閱快照到資料庫
   */
  private readonly SYNC_TIMEOUT_MS = 60000; // 60 seconds overall timeout

  async syncSubscriptionSnapshot(streamerId: string): Promise<void> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("SYNC_OVERALL_TIMEOUT")), this.SYNC_TIMEOUT_MS);
    });

    try {
      await Promise.race([
        this._syncSubscriptionSnapshotInner(streamerId),
        timeoutPromise,
      ]);
    } catch (error) {
      if (error instanceof Error && error.message === "SYNC_OVERALL_TIMEOUT") {
        logger.error("RevenueService", `syncSubscriptionSnapshot overall timeout (${this.SYNC_TIMEOUT_MS}ms) for streamer ${streamerId}`);
        throw new Error(`Subscription sync timed out after ${this.SYNC_TIMEOUT_MS}ms`);
      }
      throw error;
    }
  }

  private async _syncSubscriptionSnapshotInner(streamerId: string): Promise<void> {
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
    // 使用型別安全的動態 import 載入 ES Module
    const { ApiClient } = await importTwurpleApi();
    const { RefreshingAuthProvider } = await importTwurpleAuth();

    // 直接從環境變數獲取 Twitch 憑證（避免動態載入模組的問題）
    const clientId = process.env.TWITCH_CLIENT_ID;
    const clientSecret = process.env.TWITCH_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error("Missing TWITCH_CLIENT_ID or TWITCH_CLIENT_SECRET environment variables");
    }

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
          logger.info("RevenueService", `Token refreshed for streamer ${broadcasterId}`);
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
          logger.info("RevenueService", "Token successfully saved to database");
        } catch (error) {
          // Token 刷新成功但儲存失敗 - 記錄錯誤但不中斷流程
          logger.error("RevenueService", "Failed to save refreshed token to database:", error);
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

      const paginator = apiClient.subscriptions.getSubscriptionsPaginated(broadcasterId);

      const timer = setTimeout(() => {
        // Timer 作為安全網，主迴圈中已有時間檢查
      }, SUBSCRIPTION_SYNC.MAX_TIME_MS);

      try {
        for await (const sub of paginator) {
          result.total++;
          if (sub.tier === "1000") result.tier1++;
          else if (sub.tier === "2000") result.tier2++;
          else if (sub.tier === "3000") result.tier3++;

          if (result.total >= SUBSCRIPTION_SYNC.MAX_SUBSCRIPTIONS) {
            logger.error("RevenueService", `訂閱者數量超過 ${SUBSCRIPTION_SYNC.MAX_SUBSCRIPTIONS}`);
            throw new Error(
              `SUBSCRIPTION_LIMIT_EXCEEDED: Channel has more than ${SUBSCRIPTION_SYNC.MAX_SUBSCRIPTIONS} subscribers. Please contact support for enterprise solutions.`
            );
          }

          if (Date.now() - startTime > SUBSCRIPTION_SYNC.MAX_TIME_MS) {
            logger.error(
              "RevenueService",
              `同步超時 (${SUBSCRIPTION_SYNC.MAX_TIME_MS}ms)，目前已獲取 ${result.total} 筆`
            );
            throw new Error(
              `SYNC_TIMEOUT: Subscription sync exceeded time limit. Retrieved ${result.total} subscriptions before timeout.`
            );
          }
        }
      } finally {
        clearTimeout(timer);
      }
    } catch (error: unknown) {
      // 處理權限不足或 Token 無效的情況
      const apiError = error as import("../../types/twitch.types").TwitchApiError;
      if (apiError.statusCode === 401 || apiError.statusCode === 403) {
        logger.error(
          "RevenueService",
          `Permission error for ${broadcasterId}: ${apiError.message}`
        );
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

    const effectiveDays = Math.min(days, 90);

    // 使用快取（5 分鐘 TTL）
    return cacheManager.getOrSet(
      CacheKeys.revenueSubscriptions(streamerId, effectiveDays),
      async () => {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - effectiveDays);
        startDate.setHours(0, 0, 0, 0);

        // Zeabur 免費層: 查詢超時保護（20 秒）
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("DB_QUERY_TIMEOUT")), 20000);
        });

        try {
          const snapshots = await Promise.race([
            prisma.$queryRaw<
              Array<{
                snapshotDate: string;
                tier1Count: number;
                tier2Count: number;
                tier3Count: number;
                totalSubscribers: number;
                estimatedRevenue: number | null;
              }>
            >`
              SELECT
                snapshotDate,
                tier1Count,
                tier2Count,
                tier3Count,
                totalSubscribers,
                estimatedRevenue
              FROM subscription_snapshots
              WHERE streamerId = ${streamerId}
                AND snapshotDate >= ${startDate.toISOString()}
              ORDER BY snapshotDate ASC
              LIMIT 90
            `,
            timeoutPromise,
          ]);

          return snapshots.map((snap) => ({
            date: new Date(snap.snapshotDate).toISOString().split("T")[0],
            tier1Count: snap.tier1Count,
            tier2Count: snap.tier2Count,
            tier3Count: snap.tier3Count,
            totalSubscribers: snap.totalSubscribers,
            estimatedRevenue: snap.estimatedRevenue || 0,
          }));
        } catch (error) {
          const err = error as Error;
          if (err.message === "DB_QUERY_TIMEOUT") {
            logger.error(
              "RevenueService",
              `getSubscriptionStats query timeout for streamer ${streamerId}`
            );
            // 超時時返回空陣列
            return [];
          }
          throw error;
        }
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

    const effectiveDays = Math.min(days, 90);

    // 使用快取（5 分鐘 TTL）
    return cacheManager.getOrSet(
      CacheKeys.revenueBits(streamerId, effectiveDays),
      async () => {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - effectiveDays);
        startDate.setHours(0, 0, 0, 0);
        const startDateKey = this.toDateKey(startDate);

        // Zeabur 免費層: 查詢超時保護（20 秒）
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("DB_QUERY_TIMEOUT")), 20000);
        });

        try {
          // 先刷新日聚合表，再從聚合表讀取，避免每次掃描 cheer_events
          await this.ensureBitsDailyAggFresh(streamerId, startDateKey);

          const results = await Promise.race([
            prisma.$queryRaw<
              Array<{
                date: string | Date;
                totalBits: bigint | number;
                eventCount: bigint | number;
              }>
            >`
              SELECT
                date,
                totalBits,
                eventCount
              FROM cheer_daily_agg
              WHERE streamerId = ${streamerId}
                AND date >= ${startDateKey}
              ORDER BY date ASC
              LIMIT 90
            `,
            timeoutPromise,
          ]);

          return results.map((row) => ({
            date:
              row.date instanceof Date
                ? row.date.toISOString().split("T")[0]
                : String(row.date).split("T")[0],
            totalBits: Number(row.totalBits),
            estimatedRevenue: Number(row.totalBits) * BITS_TO_USD_RATE,
            eventCount: Number(row.eventCount),
          }));
        } catch (error) {
          const err = error as Error;
          if (err.message === "DB_QUERY_TIMEOUT") {
            logger.error("RevenueService", `getBitsStats query timeout for streamer ${streamerId}`);
            // 超時時返回空陣列，避免拖垮整個系統
            return [];
          }
          throw error;
        }
      },
      CacheTTL.MEDIUM
    );
  }

  /**
   * 獲取收益總覽（帶快取）
   * 優化：使用 $transaction 合併多次查詢
   */
  async getRevenueOverview(streamerId: string): Promise<RevenueOverview> {
    // 參數驗證
    if (!streamerId?.trim()) {
      throw new Error("Invalid streamerId");
    }

    // 使用快取（1 分鐘 TTL，因為是總覽資料需要較即時）
    const cacheKey = CacheKeys.revenueOverview(streamerId);
    const staleKey = `${cacheKey}:stale`;

    return cacheManager.getOrSet(
      cacheKey,
      async () => {
        // 獲取本月 Bits 統計的起始時間
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);
        const startOfMonthKey = this.toDateKey(startOfMonth);

        // Zeabur 免費層: 查詢超時保護（20 秒）
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("DB_QUERY_TIMEOUT")), 20000);
        });

        try {
          await this.ensureBitsDailyAggFresh(streamerId, startOfMonthKey);

          // 使用 Promise.all 平行查詢，避免 SQLite 事務鎖定
          const [latestSnapshot, bitsRows] = await Promise.race([
            Promise.all([
              prisma.subscriptionSnapshot.findFirst({
                where: { streamerId },
                orderBy: { snapshotDate: "desc" },
              }),
              prisma.$queryRaw<Array<{ totalBits: bigint | number | null; eventCount: bigint | number }>>`
                SELECT
                  COALESCE(SUM(totalBits), 0) as totalBits,
                  COALESCE(SUM(eventCount), 0) as eventCount
                FROM cheer_daily_agg
                WHERE streamerId = ${streamerId}
                  AND date >= ${startOfMonthKey}
              `,
            ]),
            timeoutPromise,
          ]);

          const totalBits = Number(bitsRows[0]?.totalBits || 0);
          const bitsEventCount = Number(bitsRows[0]?.eventCount || 0);
          const bitsRevenue = totalBits * BITS_TO_USD_RATE;

          const subRevenue = latestSnapshot?.estimatedRevenue || 0;

          const payload = {
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
              eventCount: bitsEventCount,
            },
            totalEstimatedRevenue: subRevenue + bitsRevenue,
          };

          cacheManager.set(staleKey, payload, CacheTTL.MEDIUM);
          return payload;
        } catch (error) {
          const err = error as Error;
          if (err.message === "DB_QUERY_TIMEOUT") {
            logger.error(
              "RevenueService",
              `getRevenueOverview query timeout for streamer ${streamerId}`
            );
            // 超時時返回空數據
            const stale = cacheManager.get<RevenueOverview>(staleKey);
            if (stale) {
              return stale;
            }

            const fallback = {
              subscriptions: {
                current: 0,
                estimatedMonthlyRevenue: 0,
                tier1: 0,
                tier2: 0,
                tier3: 0,
              },
              bits: { totalBits: 0, estimatedRevenue: 0, eventCount: 0 },
              totalEstimatedRevenue: 0,
            };

            cacheManager.set(staleKey, fallback, CacheTTL.MEDIUM);
            return fallback;
          }
          throw error;
        }
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
