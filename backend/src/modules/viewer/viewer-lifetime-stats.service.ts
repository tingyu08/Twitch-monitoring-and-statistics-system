import { prisma } from "../../db/prisma";
import { badgeService } from "../../services/badge.service";
import { lifetimeStatsAggregator } from "../../services/lifetime-stats-aggregator.service";
import type { ViewerChannelLifetimeStats } from "@prisma/client";

export class ViewerLifetimeStatsService {
  async getStats(viewerId: string, channelId: string) {
    // 1. 先查詢已彙總的 lifetime stats
    let stat = await prisma.viewerChannelLifetimeStats.findUnique({
      where: { viewerId_channelId: { viewerId, channelId } },
      include: {
        channel: {
          select: {
            channelName: true,
          },
        },
      },
    });

    // 2. 如果沒有資料，首次訪問時即時觸發彙總
    if (!stat) {
      stat = await lifetimeStatsAggregator.aggregateStatsWithChannel(viewerId, channelId);
    }

    if (!stat) {
      // 仍然沒有資料代表該 viewer 與 channel 尚未建立有效統計，
      // 直接回傳 null，交由上層決定顯示空狀態。
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

  private calculateRadarScores(stats: ViewerChannelLifetimeStats) {
    // 1. 觀看時長（滿分 500 小時）
    const watchTimeScore = Math.min(100, (stats.totalWatchTimeMinutes / 60 / 500) * 100);

    // 2. 互動頻率（滿分 2000 則留言）
    const interactionScore = Math.min(100, (stats.totalMessages / 2000) * 100);

    // 3. 忠誠度（滿分 365 天）
    const loyaltyScore = Math.min(100, (stats.trackingDays / 365) * 100);

    // 4. 活躍度（最近 30 天活躍天數 / 30）
    const activityScore = Math.min(100, (stats.activeDaysLast30 / 30) * 100);

    // 5. 贊助貢獻（滿分 10000 Bits）
    const contributionScore = Math.min(100, (stats.totalBits / 10000) * 100);

    // 6. 社群參與（以總訂閱次數近似 months / 12 的概念）
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
