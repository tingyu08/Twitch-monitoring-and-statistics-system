import { prisma } from "../../db/prisma";
import { cacheManager, CacheTTL, getAdaptiveTTL } from "../../utils/cache-manager";

export interface ViewerMessageStatsResult {
  channelId: string;
  timeRange: {
    startDate: string;
    endDate: string;
  };
  summary: {
    totalMessages: number;
    avgMessagesPerStream: number;
    mostActiveDate: string | null;
    mostActiveDateCount: number;
    lastMessageAt: string | null;
  };
  interactionBreakdown: {
    chatMessages: number;
    subscriptions: number;
    cheers: number;
    giftSubs: number;
    raids: number;
    totalBits: number;
  };
  dailyBreakdown: Array<{
    date: string;
    totalMessages: number;
    chatMessages: number;
    subscriptions: number;
    cheers: number;
  }>;
}

export async function getViewerMessageStats(
  viewerId: string,
  channelId: string,
  startDateStr?: string,
  endDateStr?: string
): Promise<ViewerMessageStatsResult> {
  const endDate = endDateStr ? new Date(endDateStr) : new Date();
  const startDate = startDateStr
    ? new Date(startDateStr)
    : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);

  const startKey = startDate.toISOString().split("T")[0];
  const endKey = endDate.toISOString().split("T")[0];
  const cacheKey = `viewer:${viewerId}:channel:${channelId}:msgstats:${startKey}:${endKey}`;
  const ttl = getAdaptiveTTL(CacheTTL.MEDIUM, cacheManager);

  return cacheManager.getOrSetWithTags(
    cacheKey,
    async () => {
      const aggs = await prisma.viewerChannelMessageDailyAgg.findMany({
        where: {
          viewerId,
          channelId,
          date: {
            gte: startDate,
            lte: endDate,
          },
        },
        orderBy: { date: "asc" },
      });

      const summary = {
        totalMessages: 0,
        chatMessages: 0,
        subscriptions: 0,
        cheers: 0,
        giftSubs: 0,
        raids: 0,
        totalBits: 0,
      };

      const dailyBreakdown = aggs.map((agg) => {
        summary.totalMessages += agg.totalMessages;
        summary.chatMessages += agg.chatMessages;
        summary.subscriptions += agg.subscriptions;
        summary.cheers += agg.cheers;
        summary.giftSubs += agg.giftSubs;
        summary.raids += agg.raids;
        summary.totalBits += agg.totalBits || 0;

        return {
          date: agg.date.toISOString().split("T")[0],
          totalMessages: agg.totalMessages,
          chatMessages: agg.chatMessages,
          subscriptions: agg.subscriptions,
          cheers: agg.cheers,
        };
      });

      const activeDays = aggs.length;
      const avgMessagesPerStream =
        activeDays > 0 ? Math.round(summary.totalMessages / activeDays) : 0;

      const mostActive = aggs.reduce<{ date: Date | null; count: number }>(
        (best, curr) => {
          if (curr.totalMessages > best.count) {
            return { date: curr.date, count: curr.totalMessages };
          }
          return best;
        },
        { date: null, count: 0 }
      );

      const lastAggregate = aggs.length > 0 ? aggs[aggs.length - 1] : null;
      const mostActiveDateStr = mostActive.date ? mostActive.date.toISOString().split("T")[0] : null;

      return {
        channelId,
        timeRange: {
          startDate: startDate.toISOString().split("T")[0],
          endDate: endDate.toISOString().split("T")[0],
        },
        summary: {
          totalMessages: summary.totalMessages,
          avgMessagesPerStream,
          mostActiveDate: mostActiveDateStr,
          mostActiveDateCount: mostActive.count,
          lastMessageAt: lastAggregate ? lastAggregate.date.toISOString().split("T")[0] : null,
        },
        interactionBreakdown: {
          chatMessages: summary.chatMessages,
          subscriptions: summary.subscriptions,
          cheers: summary.cheers,
          giftSubs: summary.giftSubs,
          raids: summary.raids,
          totalBits: summary.totalBits,
        },
        dailyBreakdown,
      };
    },
    ttl,
    [`viewer:${viewerId}`, `channel:${channelId}`, "viewer:message-stats"]
  );
}
