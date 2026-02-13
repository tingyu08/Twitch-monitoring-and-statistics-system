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
  /**
   * 計算並更新特定觀眾在特定頻道的全時段統計
   */
  public async aggregateStats(viewerId: string, channelId: string): Promise<void> {
    try {
      const stats = await this.calculateStats(viewerId, channelId);

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

      logger.info("LifetimeStats", `Aggregated stats for viewer ${viewerId} channel ${channelId}`);
    } catch (error) {
      logger.error("LifetimeStats", `Error aggregating stats for viewer ${viewerId}: ${error}`);
      throw error;
    }
  }

  public async aggregateStatsWithChannel(viewerId: string, channelId: string) {
    const stats = await this.calculateStats(viewerId, channelId);

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

  /**
   * 內部計算邏輯
   * P1 Fix: 使用資料庫聚合函數減少資料傳輸量
   */
  private async calculateStats(viewerId: string, channelId: string): Promise<LifetimeStatsResult> {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    // P1 Fix: 使用資料庫聚合函數計算總和，避免載入所有記錄到記憶體
    const [dailyStatsAgg, messageAggsAgg, activeDateRows] = await Promise.all([
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

    // ========== 活躍度 (最近 30/90 天) ==========
    const activeDaysLast30 = activeDates.filter((dateStr) => new Date(dateStr) >= thirtyDaysAgo).length;
    const activeDaysLast90 = activeDates.filter((dateStr) => new Date(dateStr) >= ninetyDaysAgo).length;

    // 最活躍月份
    const monthCounts = new Map<string, number>();
    for (const dateStr of activeDates) {
      const month = dateStr.substring(0, 7); // "YYYY-MM"
      monthCounts.set(month, (monthCounts.get(month) || 0) + 1);
    }

    let mostActiveMonth = null;
    let mostActiveMonthCount = 0;

    for (const [month, count] of monthCounts.entries()) {
      if (count > mostActiveMonthCount) {
        mostActiveMonthCount = count;
        mostActiveMonth = month;
      }
    }

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

    await prisma.$executeRaw(Prisma.sql`
      WITH ranked AS (
        SELECT
          id,
          CASE
            WHEN cnt = 0 THEN 0.0
            ELSE ((watchRank - 1) * 100.0 / cnt)
          END AS watchPercentile,
          CASE
            WHEN cnt = 0 THEN 0.0
            ELSE ((messageRank - 1) * 100.0 / cnt)
          END AS messagePercentile
        FROM (
          SELECT
            id,
            ROW_NUMBER() OVER (ORDER BY totalWatchTimeMinutes ASC, id ASC) AS watchRank,
            ROW_NUMBER() OVER (ORDER BY totalMessages ASC, id ASC) AS messageRank,
            COUNT(*) OVER () AS cnt
          FROM viewer_channel_lifetime_stats
          WHERE channelId = ${channelId}
        ) base
      )
      UPDATE viewer_channel_lifetime_stats
      SET
        watchTimePercentile = (SELECT ranked.watchPercentile FROM ranked WHERE ranked.id = viewer_channel_lifetime_stats.id),
        messagePercentile = (SELECT ranked.messagePercentile FROM ranked WHERE ranked.id = viewer_channel_lifetime_stats.id),
        updatedAt = CURRENT_TIMESTAMP
      WHERE channelId = ${channelId}
    `);

    logger.info("LifetimeStats", `Updated rankings for channel ${channelId}`);
  }
}

export const lifetimeStatsAggregator = new LifetimeStatsAggregatorService();
