import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { logger } from "../utils/logger";

interface LifetimeStatsResult {
  totalWatchTimeMinutes: number;
  totalSessions: number; // For daily stats, this might be days watched roughly
  avgSessionMinutes: number;
  firstWatchedAt: Date | null;
  lastWatchedAt: Date | null;

  totalMessages: number;
  totalChatMessages: number;
  totalSubscriptions: number;
  totalCheers: number;
  totalBits: number;

  trackingStartedAt: Date;
  trackingDays: number;
  longestStreakDays: number;
  currentStreakDays: number;

  activeDaysLast30: number;
  activeDaysLast90: number;
  mostActiveMonth: string | null;
  mostActiveMonthCount: number;
}

interface ActivitySummaryRow {
  trackingStartedAt: string | null;
  trackingDays: number | null;
  activeDaysLast30: number | null;
  activeDaysLast90: number | null;
  mostActiveMonth: string | null;
  mostActiveMonthCount: number | null;
}

interface StreakSummaryRow {
  longestStreakDays: number | null;
  currentStreakDays: number | null;
}

interface AggregateStatsOptions {
  preventDecreases?: boolean;
}

function normalizeDateToDay(value: unknown): string | null {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return value.slice(0, 10);
  }

  if (typeof value === "number") {
    const fromNumber = new Date(value);
    if (!Number.isNaN(fromNumber.getTime())) {
      return fromNumber.toISOString().split("T")[0];
    }
    return null;
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().split("T")[0];
  }

  if (typeof value === "string") {
    const fromString = new Date(value);
    if (!Number.isNaN(fromString.getTime())) {
      return fromString.toISOString().split("T")[0];
    }
  }

  return null;
}

export class LifetimeStatsAggregatorService {
  private readonly percentileRecomputeWindowHours = Math.max(
    1,
    Number(process.env.LIFETIME_PERCENTILE_RECOMPUTE_WINDOW_HOURS || 24)
  );
  /**
   * 計算並更新特定觀眾在特定頻道的全時段統計
   */
  public async aggregateStats(
    viewerId: string,
    channelId: string,
    options?: AggregateStatsOptions
  ): Promise<void> {
    try {
      const stats = await this.calculateStats(viewerId, channelId);
      const preventDecreases = options?.preventDecreases ?? true;

      if (preventDecreases) {
        await this.upsertStatsPreventDecrease(viewerId, channelId, stats);
      } else {
        await prisma.viewerChannelLifetimeStats.upsert({
          where: {
            viewerId_channelId: {
              viewerId,
              channelId,
            },
          },
          create: {
            viewerId,
            channelId,
            ...stats,
          },
          update: {
            ...stats,
          },
        });
      }

      logger.info("LifetimeStats", `Aggregated stats for viewer ${viewerId} channel ${channelId}`);
    } catch (error) {
      logger.error("LifetimeStats", `Error aggregating stats for viewer ${viewerId}: ${error}`);
      throw error;
    }
  }

  public async aggregateStatsWithChannel(
    viewerId: string,
    channelId: string,
    options?: AggregateStatsOptions
  ) {
    const stats = await this.calculateStats(viewerId, channelId);
    const preventDecreases = options?.preventDecreases ?? true;

    if (preventDecreases) {
      await this.upsertStatsPreventDecrease(viewerId, channelId, stats);
      return prisma.viewerChannelLifetimeStats.findUnique({
        where: {
          viewerId_channelId: {
            viewerId,
            channelId,
          },
        },
        include: {
          channel: {
            select: {
              channelName: true,
            },
          },
        },
      });
    }

    return prisma.viewerChannelLifetimeStats.upsert({
      where: {
        viewerId_channelId: {
          viewerId,
          channelId,
        },
      },
      create: {
        viewerId,
        channelId,
        ...stats,
      },
      update: {
        ...stats,
      },
      include: {
        channel: {
          select: {
            channelName: true,
          },
        },
      },
    });
  }

  private async upsertStatsPreventDecrease(
    viewerId: string,
    channelId: string,
    stats: LifetimeStatsResult
  ): Promise<void> {
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO viewer_channel_lifetime_stats (
        id,
        viewerId,
        channelId,
        totalWatchTimeMinutes,
        totalSessions,
        avgSessionMinutes,
        firstWatchedAt,
        lastWatchedAt,
        totalMessages,
        totalChatMessages,
        totalSubscriptions,
        totalCheers,
        totalBits,
        trackingStartedAt,
        trackingDays,
        longestStreakDays,
        currentStreakDays,
        activeDaysLast30,
        activeDaysLast90,
        mostActiveMonthCount,
        createdAt,
        updatedAt
      ) VALUES (
        lower(hex(randomblob(16))),
        ${viewerId},
        ${channelId},
        ${stats.totalWatchTimeMinutes},
        ${stats.totalSessions},
        ${stats.avgSessionMinutes},
        ${stats.firstWatchedAt},
        ${stats.lastWatchedAt},
        ${stats.totalMessages},
        ${stats.totalChatMessages},
        ${stats.totalSubscriptions},
        ${stats.totalCheers},
        ${stats.totalBits},
        ${stats.trackingStartedAt},
        ${stats.trackingDays},
        ${stats.longestStreakDays},
        ${stats.currentStreakDays},
        ${stats.activeDaysLast30},
        ${stats.activeDaysLast90},
        ${stats.mostActiveMonthCount},
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
      ON CONFLICT(viewerId, channelId) DO UPDATE SET
        totalWatchTimeMinutes = CASE
          WHEN viewer_channel_lifetime_stats.totalWatchTimeMinutes > excluded.totalWatchTimeMinutes
            THEN viewer_channel_lifetime_stats.totalWatchTimeMinutes
          ELSE excluded.totalWatchTimeMinutes
        END,
        totalSessions = CASE
          WHEN viewer_channel_lifetime_stats.totalSessions > excluded.totalSessions
            THEN viewer_channel_lifetime_stats.totalSessions
          ELSE excluded.totalSessions
        END,
        avgSessionMinutes = excluded.avgSessionMinutes,
        firstWatchedAt = CASE
          WHEN viewer_channel_lifetime_stats.firstWatchedAt IS NULL THEN excluded.firstWatchedAt
          WHEN excluded.firstWatchedAt IS NULL THEN viewer_channel_lifetime_stats.firstWatchedAt
          WHEN viewer_channel_lifetime_stats.firstWatchedAt <= excluded.firstWatchedAt
            THEN viewer_channel_lifetime_stats.firstWatchedAt
          ELSE excluded.firstWatchedAt
        END,
        lastWatchedAt = CASE
          WHEN viewer_channel_lifetime_stats.lastWatchedAt IS NULL THEN excluded.lastWatchedAt
          WHEN excluded.lastWatchedAt IS NULL THEN viewer_channel_lifetime_stats.lastWatchedAt
          WHEN viewer_channel_lifetime_stats.lastWatchedAt >= excluded.lastWatchedAt
            THEN viewer_channel_lifetime_stats.lastWatchedAt
          ELSE excluded.lastWatchedAt
        END,
        totalMessages = CASE
          WHEN viewer_channel_lifetime_stats.totalMessages > excluded.totalMessages
            THEN viewer_channel_lifetime_stats.totalMessages
          ELSE excluded.totalMessages
        END,
        totalChatMessages = CASE
          WHEN viewer_channel_lifetime_stats.totalChatMessages > excluded.totalChatMessages
            THEN viewer_channel_lifetime_stats.totalChatMessages
          ELSE excluded.totalChatMessages
        END,
        totalSubscriptions = CASE
          WHEN viewer_channel_lifetime_stats.totalSubscriptions > excluded.totalSubscriptions
            THEN viewer_channel_lifetime_stats.totalSubscriptions
          ELSE excluded.totalSubscriptions
        END,
        totalCheers = CASE
          WHEN viewer_channel_lifetime_stats.totalCheers > excluded.totalCheers
            THEN viewer_channel_lifetime_stats.totalCheers
          ELSE excluded.totalCheers
        END,
        totalBits = CASE
          WHEN viewer_channel_lifetime_stats.totalBits > excluded.totalBits
            THEN viewer_channel_lifetime_stats.totalBits
          ELSE excluded.totalBits
        END,
        trackingStartedAt = excluded.trackingStartedAt,
        trackingDays = excluded.trackingDays,
        longestStreakDays = excluded.longestStreakDays,
        currentStreakDays = excluded.currentStreakDays,
        activeDaysLast30 = excluded.activeDaysLast30,
        activeDaysLast90 = excluded.activeDaysLast90,
        mostActiveMonthCount = excluded.mostActiveMonthCount,
        updatedAt = CURRENT_TIMESTAMP
    `);
  }

  /**
   * 內部計算邏輯
   * P1 Fix: 使用資料庫聚合函數減少資料傳輸量
   */
  private async calculateStats(viewerId: string, channelId: string): Promise<LifetimeStatsResult> {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    // P1 Fix: 使用資料庫聚合函數計算總和，避免載入所有記錄到記憶體
    const [dailyStatsAgg, messageAggsAgg, activitySummaryRows, streakSummaryRows] = await Promise.all([
        // 聚合觀看時間統計
        prisma.viewerChannelDailyStat.aggregate({
          where: { viewerId, channelId },
          _sum: { watchSeconds: true },
          _count: true,
          _min: { date: true },
          _max: { date: true },
        }),
        // 聚合訊息統計
        prisma.viewerChannelMessageDailyAgg.aggregate({
          where: { viewerId, channelId },
          _sum: {
            totalMessages: true,
            chatMessages: true,
            subscriptions: true,
            cheers: true,
            totalBits: true,
          },
        }),
        prisma.$queryRaw<ActivitySummaryRow[]>(Prisma.sql`
          WITH active_dates AS (
            SELECT date AS d
            FROM viewer_channel_daily_stats
            WHERE viewerId = ${viewerId} AND channelId = ${channelId}
            UNION
            SELECT date AS d
            FROM viewer_channel_message_daily_aggs
            WHERE viewerId = ${viewerId} AND channelId = ${channelId}
          ),
          month_counts AS (
            SELECT SUBSTR(d, 1, 7) AS month, COUNT(*) AS cnt
            FROM active_dates
            GROUP BY month
          ),
          best_month AS (
            SELECT month, cnt
            FROM month_counts
            ORDER BY cnt DESC, month DESC
            LIMIT 1
          )
          SELECT
            MIN(d) AS trackingStartedAt,
            COUNT(*) AS trackingDays,
            COALESCE(SUM(CASE WHEN d >= DATE(${thirtyDaysAgo.toISOString()}) THEN 1 ELSE 0 END), 0) AS activeDaysLast30,
            COALESCE(SUM(CASE WHEN d >= DATE(${ninetyDaysAgo.toISOString()}) THEN 1 ELSE 0 END), 0) AS activeDaysLast90,
            (SELECT month FROM best_month) AS mostActiveMonth,
            COALESCE((SELECT cnt FROM best_month), 0) AS mostActiveMonthCount
          FROM active_dates
        `),
        prisma.$queryRaw<StreakSummaryRow[]>(Prisma.sql`
          WITH active_dates AS (
            SELECT date AS d
            FROM viewer_channel_daily_stats
            WHERE viewerId = ${viewerId} AND channelId = ${channelId}
            UNION
            SELECT date AS d
            FROM viewer_channel_message_daily_aggs
            WHERE viewerId = ${viewerId} AND channelId = ${channelId}
          ),
          ordered AS (
            SELECT d, LAG(d) OVER (ORDER BY d) AS prev_d
            FROM active_dates
          ),
          boundaries AS (
            SELECT
              d,
              CASE
                WHEN prev_d IS NULL THEN 1
                WHEN CAST(julianday(d) - julianday(prev_d) AS INTEGER) = 1 THEN 0
                ELSE 1
              END AS is_new_group
            FROM ordered
          ),
          grouped AS (
            SELECT
              d,
              SUM(is_new_group) OVER (ORDER BY d ROWS UNBOUNDED PRECEDING) AS grp
            FROM boundaries
          ),
          streaks AS (
            SELECT
              grp,
              COUNT(*) AS streak_len,
              MAX(d) AS streak_end
            FROM grouped
            GROUP BY grp
          ),
          latest AS (
            SELECT MAX(d) AS last_d
            FROM active_dates
          )
          SELECT
            COALESCE((SELECT MAX(streak_len) FROM streaks), 0) AS longestStreakDays,
            CASE
              WHEN (SELECT last_d FROM latest) IS NULL THEN 0
              WHEN CAST(julianday(DATE('now')) - julianday((SELECT last_d FROM latest)) AS INTEGER) <= 1
                THEN COALESCE(
                  (
                    SELECT streak_len
                    FROM streaks
                    WHERE streak_end = (SELECT last_d FROM latest)
                    ORDER BY grp DESC
                    LIMIT 1
                  ),
                  0
                )
              ELSE 0
            END AS currentStreakDays
        `),
      ]);

    // ========== 基礎統計 ==========

    const totalWatchTimeSeconds = dailyStatsAgg._sum.watchSeconds || 0;
    const totalWatchTimeMinutes = Math.floor(totalWatchTimeSeconds / 60);
    const totalSessions = dailyStatsAgg._count || 0;
    const avgSessionMinutes =
      totalSessions > 0 ? Math.floor(totalWatchTimeMinutes / totalSessions) : 0;

    const firstWatchedAt = dailyStatsAgg._min.date || null;
    const lastWatchedAt = dailyStatsAgg._max.date || null;

    // ========== 訊息統計 ==========

    const totalMessages = messageAggsAgg._sum.totalMessages || 0;
    const totalChatMessages = messageAggsAgg._sum.chatMessages || 0;
    const totalSubscriptions = messageAggsAgg._sum.subscriptions || 0;
    const totalCheers = messageAggsAgg._sum.cheers || 0;
    const totalBits = messageAggsAgg._sum.totalBits || 0;

    // ========== 忠誠度與連續簽到 ==========
    const activitySummary = activitySummaryRows[0];
    const streakSummary = streakSummaryRows[0];
    const trackingStartedAt = normalizeDateToDay(activitySummary?.trackingStartedAt)
      ? new Date(normalizeDateToDay(activitySummary?.trackingStartedAt) as string)
      : new Date();
    const trackingDays = Number(activitySummary?.trackingDays || 0);
    const longestStreak = Number(streakSummary?.longestStreakDays || 0);
    const currentStreak = Number(streakSummary?.currentStreakDays || 0);

    // ========== 活躍度 (最近 30/90 天 + 最活躍月份) ==========
    const activeDaysLast30 = Number(activitySummary?.activeDaysLast30 || 0);
    const activeDaysLast90 = Number(activitySummary?.activeDaysLast90 || 0);
    const mostActiveMonth = activitySummary?.mostActiveMonth || null;
    const mostActiveMonthCount = Number(activitySummary?.mostActiveMonthCount || 0);

    return {
      totalWatchTimeMinutes,
      totalSessions,
      avgSessionMinutes,
      firstWatchedAt,
      lastWatchedAt,
      totalMessages,
      totalChatMessages,
      totalSubscriptions,
      totalCheers,
      totalBits,
      trackingStartedAt,
      trackingDays,
      longestStreakDays: longestStreak,
      currentStreakDays: currentStreak,
      activeDaysLast30,
      activeDaysLast90,
      mostActiveMonth,
      mostActiveMonthCount,
    };
  }

  /**
   * 更新頻道的排名 (Percentile Ranking)
   * 使用批量 SQL 寫入，降低逐筆 UPDATE 造成的寫入鎖競爭
   */
  public async updatePercentileRankings(channelId: string): Promise<void> {
    const statsCount = await prisma.viewerChannelLifetimeStats.count({
      where: { channelId },
    });

    if (statsCount === 0) return;

    const recentCutoff = new Date(Date.now() - this.percentileRecomputeWindowHours * 60 * 60 * 1000);
    const recentChangeCount = await prisma.viewerChannelLifetimeStats.count({
      where: {
        channelId,
        updatedAt: {
          gte: recentCutoff,
        },
      },
    });

    if (recentChangeCount === 0) {
      return;
    }

    await prisma.$executeRaw(Prisma.sql`
      WITH base AS (
        SELECT id, totalWatchTimeMinutes, totalMessages
        FROM viewer_channel_lifetime_stats
        WHERE channelId = ${channelId}
      ),
      changed AS (
        SELECT id
        FROM viewer_channel_lifetime_stats
        WHERE channelId = ${channelId}
          AND updatedAt >= ${recentCutoff}
      ),
      ranked AS (
        SELECT
          id,
          PERCENT_RANK() OVER (ORDER BY totalWatchTimeMinutes, id) * 100.0 AS watchPercentile,
          PERCENT_RANK() OVER (ORDER BY totalMessages, id) * 100.0 AS messagePercentile
        FROM base
      )
      UPDATE viewer_channel_lifetime_stats
      SET
        watchTimePercentile = (SELECT ranked.watchPercentile FROM ranked WHERE ranked.id = viewer_channel_lifetime_stats.id),
        messagePercentile = (SELECT ranked.messagePercentile FROM ranked WHERE ranked.id = viewer_channel_lifetime_stats.id),
        updatedAt = CURRENT_TIMESTAMP
      WHERE channelId = ${channelId}
        AND id IN (SELECT id FROM changed)
    `);

    logger.info(
      "LifetimeStats",
      `Updated rankings for channel ${channelId} (${recentChangeCount}/${statsCount} recent records)`
    );
  }
}

export const lifetimeStatsAggregator = new LifetimeStatsAggregatorService();
