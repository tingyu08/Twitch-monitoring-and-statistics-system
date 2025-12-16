import type { Response } from "express";
import { prisma } from "../../db/prisma";
import type { AuthRequest } from "../auth/auth.middleware";
import type { ViewerChannelMessageDailyAgg } from "@prisma/client";

export class ViewerMessageStatsController {
  public getMessageStats = async (req: AuthRequest, res: Response) => {
    // 權限檢查
    if (!req.user || !req.user.viewerId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const { channelId } = req.params;
    if (!channelId) {
      return res.status(400).json({ error: "Channel ID is required" });
    }

    // 檢查目標 Viewer 是否與當前 User 一致 (只能看自己的數據)
    // 路由參數可能是 /api/viewer/:viewerId/channels/:channelId...
    // 但我們的 AuthMiddleware 已經把 viewerId 放在 req.user 裡了。
    // 如果路由中有 :viewerId，我們應該檢查它是否匹配 req.user.viewerId

    // 這裡我們直接使用 req.user.viewerId，忽略路由中的 viewerId 參數(如果有)，或者校驗之。
    // 假設路由是 /api/viewer/stats/:channelId/messages (類似 Story 2.2) 或者是 /api/viewer/:viewerId/channels/:channelId/message-stats
    // AC 6: GET /api/viewer/{viewerId}/channels/{channelId}/message-stats

    if (req.params.viewerId && req.params.viewerId !== req.user.viewerId) {
      return res
        .status(403)
        .json({ error: "Forbidden: Cannot access other viewer stats" });
    }

    // 解析時間範圍參數
    let startDate: Date;
    let endDate: Date;

    if (req.query.startDate && req.query.endDate) {
      startDate = new Date(req.query.startDate as string);
      endDate = new Date(req.query.endDate as string);
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        return res.status(400).json({ error: "Invalid date format" });
      }
    } else {
      // 默認 30 天
      endDate = new Date();
      startDate = new Date();
      startDate.setDate(endDate.getDate() - 30);
    }

    try {
      const stats = await this.getStats(
        req.user.viewerId,
        channelId,
        startDate,
        endDate
      );
      return res.json(stats);
    } catch (error) {
      console.error("Error fetching message stats:", error);
      return res.status(500).json({ error: "Internal Server Error" });
    }
  };

  private async getStats(
    viewerId: string,
    channelId: string,
    startDate: Date,
    endDate: Date
  ) {
    // 1. 查詢聚合數據
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

    // 2. 查詢詳細交互類型 (如果聚合表不夠詳細，例如需要 specific badges stats，但目前聚合表有基本的)
    // AC要求 Interaction Breakdown: chat, sub, cheer, gift, raid, bits.
    // 我們的聚合表已經有了這些。

    // 3. 計算 Summary
    interface MessageSummary {
      totalMessages: number;
      chatMessages: number;
      subscriptions: number;
      cheers: number;
      giftSubs: number;
      raids: number;
      totalBits: number;
    }

    const summary = aggs.reduce<MessageSummary>(
      (acc, curr) => ({
        totalMessages: acc.totalMessages + curr.totalMessages,
        chatMessages: acc.chatMessages + curr.chatMessages,
        subscriptions: acc.subscriptions + curr.subscriptions,
        cheers: acc.cheers + curr.cheers,
        giftSubs: acc.giftSubs + curr.giftSubs,
        raids: acc.raids + curr.raids,
        totalBits: (acc.totalBits || 0) + (curr.totalBits || 0),
      }),
      {
        totalMessages: 0,
        chatMessages: 0,
        subscriptions: 0,
        cheers: 0,
        giftSubs: 0,
        raids: 0,
        totalBits: 0,
      }
    );

    // 計算平均 (這裡用總天數還是有數據的天數? AC說 'avgMessagesPerStream', 假設每一天有數據的一天算一次 Stream)
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

    // 最近留言時間 (需要查詳細表)
    const lastMessage = await prisma.viewerChannelMessage.findFirst({
      where: { viewerId, channelId },
      orderBy: { timestamp: "desc" },
      select: { timestamp: true },
    });

    // 格式化最活躍日期
    const mostActiveDateStr = mostActive.date
      ? mostActive.date.toISOString().split("T")[0]
      : null;

    // 4. 構建響應
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
        lastMessageAt: lastMessage?.timestamp.toISOString() || null,
      },
      interactionBreakdown: {
        chatMessages: summary.chatMessages,
        subscriptions: summary.subscriptions,
        cheers: summary.cheers,
        giftSubs: summary.giftSubs,
        raids: summary.raids,
        totalBits: summary.totalBits,
      },
      dailyBreakdown: aggs.map((a: ViewerChannelMessageDailyAgg) => ({
        date: a.date.toISOString().split("T")[0],
        totalMessages: a.totalMessages,
        chatMessages: a.chatMessages,
        cheers: a.cheers,
        subscriptions: a.subscriptions,
      })),
    };
  }
}
