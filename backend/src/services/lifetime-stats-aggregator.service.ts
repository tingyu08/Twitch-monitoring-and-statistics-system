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

interface DateRow {
  d: unknown;
}

interface ActivitySummaryRow {
  activeDaysLast30: number | null;
  activeDaysLast90: number | null;
  mostActiveMonth: string | null;
  mostActiveMonthCount: number | null;
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
      const persistedStats = await this.resolvePersistedStats(
        viewerId,
        channelId,
        stats,
        options?.preventDecreases ?? true
      );

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
          ...persistedStats,
        },
        update: {
          ...persistedStats,
        },
      });

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
    const persistedStats = await this.resolvePersistedStats(
      viewerId,
      channelId,
      stats,
      options?.preventDecreases ?? true
    );

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
        ...persistedStats,
      },
      update: {
        ...persistedStats,
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

  private async resolvePersistedStats(
    viewerId: string,
    channelId: string,
    stats: LifetimeStatsResult,
    preventDecreases: boolean
  ): Promise<LifetimeStatsResult> {
    if (!preventDecreases) {
      return stats;
    }

    const existing = await prisma.viewerChannelLifetimeStats.findUnique({
      where: {
        viewerId_channelId: {
          viewerId,
          channelId,
        },
      },
      select: {
        totalWatchTimeMinutes: true,
        totalSessions: true,
        totalMessages: true,
        totalChatMessages: true,
        totalSubscriptions: true,
        totalCheers: true,
        totalBits: true,
        firstWatchedAt: true,
        lastWatchedAt: true,
      },
    });

    if (!existing) {
      return stats;
    }

    const merged: LifetimeStatsResult = {
      ...stats,
      totalWatchTimeMinutes: Math.max(stats.totalWatchTimeMinutes, existing.totalWatchTimeMinutes),
      totalSessions: Math.max(stats.totalSessions, existing.totalSessions),
      totalMessages: Math.max(stats.totalMessages, existing.totalMessages),
      totalChatMessages: Math.max(stats.totalChatMessages, existing.totalChatMessages),
      totalSubscriptions: Math.max(stats.totalSubscriptions, existing.totalSubscriptions),
      totalCheers: Math.max(stats.totalCheers, existing.totalCheers),
      totalBits: Math.max(stats.totalBits, existing.totalBits),
      firstWatchedAt:
        stats.firstWatchedAt && existing.firstWatchedAt
          ? stats.firstWatchedAt < existing.firstWatchedAt
            ? stats.firstWatchedAt
            : existing.firstWatchedAt
          : stats.firstWatchedAt || existing.firstWatchedAt,
      lastWatchedAt:
        stats.lastWatchedAt && existing.lastWatchedAt
          ? stats.lastWatchedAt > existing.lastWatchedAt
            ? stats.lastWatchedAt
            : existing.lastWatchedAt
          : stats.lastWatchedAt || existing.lastWatchedAt,
    };

    const clampedFields: string[] = [];
    if (merged.totalWatchTimeMinutes !== stats.totalWatchTimeMinutes) {
      clampedFields.push("totalWatchTimeMinutes");
    }
    if (merged.totalMessages !== stats.totalMessages) {
      clampedFields.push("totalMessages");
    }

    if (clampedFields.length > 0) {
      logger.warn(
        "LifetimeStats",
        `Prevented lifetime stat decreases for viewer ${viewerId} channel ${channelId}: ${clampedFields.join(",")}`
      );
    }

    return merged;
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
    const [dailyStatsAgg, messageAggsAgg, activeDateRows, activitySummaryRows] = await Promise.all([
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
        // 只查詢日期列表用於 streak 計算（在 DB 側先做去重）
        prisma.$queryRaw<DateRow[]>(Prisma.sql`
          SELECT date AS d
          FROM viewer_channel_daily_stats
          WHERE viewerId = ${viewerId} AND channelId = ${channelId}
          UNION
          SELECT date AS d
          FROM viewer_channel_message_daily_aggs
          WHERE viewerId = ${viewerId} AND channelId = ${channelId}
          ORDER BY d ASC
        `),
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
            COALESCE(SUM(CASE WHEN d >= DATE(${thirtyDaysAgo.toISOString()}) THEN 1 ELSE 0 END), 0) AS activeDaysLast30,
            COALESCE(SUM(CASE WHEN d >= DATE(${ninetyDaysAgo.toISOString()}) THEN 1 ELSE 0 END), 0) AS activeDaysLast90,
            (SELECT month FROM best_month) AS mostActiveMonth,
            COALESCE((SELECT cnt FROM best_month), 0) AS mostActiveMonthCount
          FROM active_dates
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

    // 由資料庫去重後回傳的日期列表
    const activeDates = activeDateRows
      .map((row) => normalizeDateToDay(row.d))
      .filter((dateStr): dateStr is string => Boolean(dateStr));

    const trackingDays = activeDates.length;
    const trackingStartedAt = activeDates.length > 0 ? new Date(activeDates[0]) : new Date();

    // 計算 Streak
    let longestStreak = 0;
    let currentStreak = 0;
    let tempStreak = 0;

    // 簡單的 Streak 算法: 檢查相鄰日期是否差 1 天
    if (activeDates.length > 0) {
      tempStreak = 1;
      longestStreak = 1;

      for (let i = 1; i < activeDates.length; i++) {
        const prev = new Date(activeDates[i - 1]);
        const curr = new Date(activeDates[i]);

        const diffTime = Math.abs(curr.getTime() - prev.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays === 1) {
          tempStreak++;
        } else {
          tempStreak = 1;
        }

        if (tempStreak > longestStreak) {
          longestStreak = tempStreak;
        }
      }

      // 檢查 Last Active Date 是否是今天或昨天，決定 Current Streak
      const lastActive = new Date(activeDates[activeDates.length - 1]);
      const now = new Date();
      const diffToNow = Math.floor((now.getTime() - lastActive.getTime()) / (1000 * 60 * 60 * 24));

      if (diffToNow <= 1) {
        currentStreak = tempStreak;
      } else {
        currentStreak = 0;
      }
    }

    // ========== 活躍度 (最近 30/90 天 + 最活躍月份) ==========
    const activitySummary = activitySummaryRows[0];
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
      totals AS (
        SELECT COUNT(*) AS cnt FROM base
      ),
      changed AS (
        SELECT id, totalWatchTimeMinutes, totalMessages
        FROM viewer_channel_lifetime_stats
        WHERE channelId = ${channelId}
          AND updatedAt >= ${recentCutoff}
      ),
      ranked AS (
        SELECT
          c.id,
          CASE
            WHEN t.cnt = 0 THEN 0.0
            ELSE (
              (
                SELECT COUNT(*)
                FROM base b
                WHERE b.totalWatchTimeMinutes < c.totalWatchTimeMinutes
                  OR (
                    b.totalWatchTimeMinutes = c.totalWatchTimeMinutes
                    AND b.id <= c.id
                  )
              ) - 1
            ) * 100.0 / t.cnt
          END AS watchPercentile,
          CASE
            WHEN t.cnt = 0 THEN 0.0
            ELSE (
              (
                SELECT COUNT(*)
                FROM base b
                WHERE b.totalMessages < c.totalMessages
                  OR (
                    b.totalMessages = c.totalMessages
                    AND b.id <= c.id
                  )
              ) - 1
            ) * 100.0 / t.cnt
          END AS messagePercentile
        FROM changed c
        CROSS JOIN totals t
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
