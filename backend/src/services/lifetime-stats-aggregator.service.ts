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

  /**
   * 內部計算邏輯
   */
  private async calculateStats(viewerId: string, channelId: string): Promise<LifetimeStatsResult> {
    // 1. 獲取所有日誌統計
    const dailyStats = await prisma.viewerChannelDailyStat.findMany({
      where: { viewerId, channelId },
      orderBy: { date: "asc" },
    });

    // 2. 獲取所有訊息聚合
    const messageAggs = await prisma.viewerChannelMessageDailyAgg.findMany({
      where: { viewerId, channelId },
      orderBy: { date: "asc" },
    });

    // ========== 基礎統計 ==========

    const totalWatchTimeSeconds = dailyStats.reduce((sum, stat) => sum + stat.watchSeconds, 0);
    const totalWatchTimeMinutes = Math.floor(totalWatchTimeSeconds / 60);
    // 我們可以用 dailyStats 的數量作為 "totalSessions" 的近似值 (活躍天數)
    // 或者如果有 streamSessions 關聯會更準確，但那是 next level
    const totalSessions = dailyStats.length;
    const avgSessionMinutes =
      totalSessions > 0 ? Math.floor(totalWatchTimeMinutes / totalSessions) : 0;

    const firstWatchedAt = dailyStats.length > 0 ? dailyStats[0].date : null;
    const lastWatchedAt = dailyStats.length > 0 ? dailyStats[dailyStats.length - 1].date : null;

    // ========== 訊息統計 ==========

    let totalMessages = 0;
    let totalChatMessages = 0;
    let totalSubscriptions = 0;
    let totalCheers = 0;
    let totalBits = 0;

    for (const agg of messageAggs) {
      totalMessages += agg.totalMessages;
      totalChatMessages += agg.chatMessages;
      totalSubscriptions += agg.subscriptions;
      totalCheers += agg.cheers;
      totalBits += agg.totalBits || 0;
    }

    // ========== 忠誠度與連續簽到 ==========

    // 合併兩個來源的日期，找出所有活躍日期 (去重並排序)
    const activeDatesSet = new Set<string>();
    dailyStats.forEach((d) => activeDatesSet.add(d.date.toISOString().split("T")[0]));
    messageAggs.forEach((m) => activeDatesSet.add(m.date.toISOString().split("T")[0]));

    const activeDates = Array.from(activeDatesSet).sort();

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

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    const activeDaysLast30 = activeDates.filter((d) => new Date(d) >= thirtyDaysAgo).length;
    const activeDaysLast90 = activeDates.filter((d) => new Date(d) >= ninetyDaysAgo).length;

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
   * 這是批次操作，計算所有觀眾的相對排名
   *
   * Optimized: Uses Map for O(1) rank lookup instead of O(n) findIndex
   * Total complexity: O(n log n) for sorting + O(n) for Map building + O(n) for updates = O(n log n)
   * Previously: O(n log n) + O(n²) = O(n²)
   */
  public async updatePercentileRankings(channelId: string): Promise<void> {
    const allStats = await prisma.viewerChannelLifetimeStats.findMany({
      where: { channelId },
      select: {
        id: true,
        totalWatchTimeMinutes: true,
        totalMessages: true,
      },
    });

    if (allStats.length === 0) return;

    // Sort arrays - O(n log n)
    const sortedByWatchTime = [...allStats].sort(
      (a, b) => a.totalWatchTimeMinutes - b.totalWatchTimeMinutes
    );
    const sortedByMessages = [...allStats].sort((a, b) => a.totalMessages - b.totalMessages);

    // Build rank Maps for O(1) lookup - O(n)
    const watchRankMap = new Map<string, number>();
    const msgRankMap = new Map<string, number>();

    for (let i = 0; i < sortedByWatchTime.length; i++) {
      watchRankMap.set(sortedByWatchTime[i].id, i);
    }

    for (let i = 0; i < sortedByMessages.length; i++) {
      msgRankMap.set(sortedByMessages[i].id, i);
    }

    const updates = [];
    const statsCount = allStats.length;

    // Build updates using Map lookup - O(n)
    for (const stat of allStats) {
      const watchRank = watchRankMap.get(stat.id)!;
      const msgRank = msgRankMap.get(stat.id)!;

      const watchTimePercentile = (watchRank / statsCount) * 100;
      const messagePercentile = (msgRank / statsCount) * 100;

      updates.push(
        prisma.viewerChannelLifetimeStats.update({
          where: { id: stat.id },
          data: {
            watchTimePercentile,
            messagePercentile,
          },
        })
      );
    }

    // 批量執行更新 (Prisma $transaction 限制較多，這裡我們分批或直接 Promise.all)
    // 考慮到數量可能很大，分批執行比較安全
    const BATCH_SIZE = 50;
    for (let i = 0; i < updates.length; i += BATCH_SIZE) {
      await prisma.$transaction(updates.slice(i, i + BATCH_SIZE));
    }

    logger.info("LifetimeStats", `Updated rankings for channel ${channelId}`);
  }
}

export const lifetimeStatsAggregator = new LifetimeStatsAggregatorService();
