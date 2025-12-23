import { prisma } from "../../db/prisma";
import { badgeService } from "../../services/badge.service";
import { lifetimeStatsAggregator } from "../../services/lifetime-stats-aggregator.service";
import type { ViewerChannelLifetimeStats } from "@prisma/client";

export class ViewerLifetimeStatsService {
  async getStats(viewerId: string, channelId: string) {
    // 1. 嘗試查詢現有聚合數據
    let stat = await prisma.viewerChannelLifetimeStats.findUnique({
      where: { viewerId_channelId: { viewerId, channelId } },
      include: { channel: { include: { streamer: true } } },
    });

    // 2. 如果沒有，嘗試即時計算 (On-demand aggregation for first visit)
    if (!stat) {
      await lifetimeStatsAggregator.aggregateStats(viewerId, channelId);
      stat = await prisma.viewerChannelLifetimeStats.findUnique({
        where: { viewerId_channelId: { viewerId, channelId } },
        include: { channel: { include: { streamer: true } } },
      });
    }

    if (!stat) {
      // 如果還是沒有，可能因為完全沒資料，需返回默認空結構，以免前端炸裂
      // 或者返回 null 讓前端顯示 "無資料"
      return null;
    }

    // 3. 計算徽章
    const badges = badgeService.checkBadges(stat);

    // 4. 計算雷達圖分數
    const radarScores = this.calculateRadarScores(stat);

    return {
      channelId: stat.channelId,
      channelName: stat.channel.channelName,
      // channel model has no displayName, using channelName or need to join Streamer
      // Schema: Channel has streamerId. We can include streamer to get displayName.
      // Let's modify include above.

      lifetimeStats: {
        watchTime: {
          totalMinutes: stat.totalWatchTimeMinutes,
          totalHours: Math.floor(stat.totalWatchTimeMinutes / 60),
          avgSessionMinutes: stat.avgSessionMinutes,
          firstWatchedAt: stat.firstWatchedAt,
          lastWatchedAt: stat.lastWatchedAt,
        },
        messages: {
          totalMessages: stat.totalMessages,
          chatMessages: stat.totalChatMessages,
          subscriptions: stat.totalSubscriptions,
          cheers: stat.totalCheers,
          totalBits: stat.totalBits,
        },
        loyalty: {
          trackingDays: stat.trackingDays,
          longestStreakDays: stat.longestStreakDays,
          currentStreakDays: stat.currentStreakDays,
        },
        activity: {
          activeDaysLast30: stat.activeDaysLast30,
          activeDaysLast90: stat.activeDaysLast90,
          mostActiveMonth: stat.mostActiveMonth,
          mostActiveMonthCount: stat.mostActiveMonthCount,
        },
        rankings: {
          watchTimePercentile: stat.watchTimePercentile || 0,
          messagePercentile: stat.messagePercentile || 0,
        },
      },
      badges,
      radarScores,
    };
  }

  // 為了獲取 displayName，我需要一個更新後的 getStats 方法，但我不能在這裡直接改。
  // 所以我會讓 getStats 內部再查詢一次，或者修改上面的 include。
  // 但為了避免 type error (因為 stat type inference)，我會在下一步 Controller 中處理，或者這裡用 any or cast.
  // 正確做法：修改 include。

  private calculateRadarScores(stats: ViewerChannelLifetimeStats) {
    // 1. 觀看時長（滿分 500 小時）
    const watchTimeScore = Math.min(
      100,
      (stats.totalWatchTimeMinutes / 60 / 500) * 100
    );

    // 2. 互動頻率（滿分 2000 則留言）
    const interactionScore = Math.min(100, (stats.totalMessages / 2000) * 100);

    // 3. 忠誠度（滿分 365 天）
    const loyaltyScore = Math.min(100, (stats.trackingDays / 365) * 100);

    // 4. 活躍度（最近 30 天活躍天數 / 30）
    const activityScore = Math.min(100, (stats.activeDaysLast30 / 30) * 100);

    // 5. 贊助貢獻（滿分 10000 Bits）
    const contributionScore = Math.min(100, (stats.totalBits / 10000) * 100);

    // 6. 社群參與（訂閱次數? AC says months/12, we have totalSubscriptions）
    const communityScore = Math.min(100, (stats.totalSubscriptions / 12) * 100);

    return {
      watchTime: Math.round(watchTimeScore),
      interaction: Math.round(interactionScore),
      loyalty: Math.round(loyaltyScore),
      activity: Math.round(activityScore),
      contribution: Math.round(contributionScore),
      community: Math.round(communityScore),
    };
  }
}

export const viewerLifetimeStatsService = new ViewerLifetimeStatsService();
