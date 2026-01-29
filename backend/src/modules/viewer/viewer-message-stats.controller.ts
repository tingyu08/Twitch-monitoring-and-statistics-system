import type { Response } from "express";
import { prisma } from "../../db/prisma";
import type { AuthRequest } from "../auth/auth.middleware";
import { logger } from "../../utils/logger";
import { cacheManager, CacheTTL, getAdaptiveTTL } from "../../utils/cache-manager";

export class ViewerMessageStatsController {
  public getMessageStats = async (req: AuthRequest, res: Response) => {
    const { viewerId, channelId } = req.params;
    const { startDate: startDateStr, endDate: endDateStr } = req.query as {
      startDate?: string;
      endDate?: string;
    };

    // Debug Timer
    const label = `MsgStats-${viewerId}-${channelId}`;
    console.time(label);

    try {
      // 1. 處理日期範圍
      const endDate = endDateStr ? new Date(endDateStr) : new Date();
      const startDate = startDateStr
        ? new Date(startDateStr) // Start date from query
        : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000); // Default 30 days

      console.timeLog(label, "Dates parsed");

      // 計算天數差異用於快取鍵
      const days = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      const cacheKey = `viewer:${viewerId}:channel:${channelId}:msgstats:${days}d`;
      const ttl = getAdaptiveTTL(CacheTTL.MEDIUM, cacheManager);

      // 使用快取包裝查詢
      const result = await cacheManager.getOrSet(
        cacheKey,
        async () => {
          // 2. 查詢聚合數據 (已優化：只查 DailyAggs)
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

          console.timeLog(label, `Aggs fetched: ${aggs.length} rows`);

          // 3. 計算統計數據
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
            // 累加匯總
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

          console.timeLog(label, "Summary calculated");

          // 計算平均值
          const activeDays = aggs.length;
          const avgMessagesPerStream =
            activeDays > 0 ? Math.round(summary.totalMessages / activeDays) : 0;

          // 找出最活躍日期
          const mostActive = aggs.reduce<{ date: Date | null; count: number }>(
            (best, curr) => {
              if (curr.totalMessages > best.count) {
                return { date: curr.date, count: curr.totalMessages };
              }
              return best;
            },
            { date: null, count: 0 }
          );

          // 性能優化：避免查詢 viewer_channel_messages 大表
          // 直接使用聚合數據中的最後一天作為近似值
          const lastAggregate = aggs.length > 0 ? aggs[aggs.length - 1] : null;

          // 格式化最活躍日期
          const mostActiveDateStr = mostActive.date
            ? mostActive.date.toISOString().split("T")[0]
            : null;

          console.timeEnd(label);

          // 4. 構建響應數據
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
        ttl
      );

      return res.json(result);
    } catch (error) {
      console.timeEnd(label);
      logger.error("ViewerMessageStats", "Error getting stats", error);
      return res.status(500).json({ error: "Internal Server Error" });
    }
  };
}
