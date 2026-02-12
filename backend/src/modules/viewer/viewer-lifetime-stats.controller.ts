import type { Response } from "express";
import { viewerLifetimeStatsService } from "./viewer-lifetime-stats.service";
import { logger } from "../../utils/logger";
import type { AuthRequest } from "../auth/auth.middleware";

export class ViewerLifetimeStatsController {
  public getLifetimeStats = async (req: AuthRequest, res: Response) => {
    try {
      const { channelId } = req.params;
      const viewerId = req.user?.viewerId;

      if (!viewerId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const result = await viewerLifetimeStatsService.getStats(viewerId, channelId);

      if (!result) {
        // 返回一個空的預設結構，方便前端渲染 "無數據" 狀態
        return res.json({
          channelId,
          channelName: "",
          channelDisplayName: "",
          lifetimeStats: {
            watchTime: {
              totalMinutes: 0,
              totalHours: 0,
              avgSessionMinutes: 0,
              firstWatchedAt: null,
              lastWatchedAt: null,
            },
            messages: {
              totalMessages: 0,
              chatMessages: 0,
              subscriptions: 0,
              cheers: 0,
              totalBits: 0,
            },
            loyalty: {
              trackingDays: 0,
              longestStreakDays: 0,
              currentStreakDays: 0,
            },
            activity: {
              activeDaysLast30: 0,
              activeDaysLast90: 0,
              mostActiveMonth: null,
              mostActiveMonthCount: 0,
            },
            rankings: { watchTimePercentile: 0, messagePercentile: 0 },
          },
          badges: [],
          radarScores: {
            watchTime: 0,
            interaction: 0,
            loyalty: 0,
            activity: 0,
            contribution: 0,
            community: 0,
          },
        });
      }

      res.json(result);
    } catch (error) {
      logger.error("ViewerLifetimeStats", "Error getting lifetime stats", error);
      res.status(500).json({ error: "Internal server error" });
    }
  };
}

export const viewerLifetimeStatsController = new ViewerLifetimeStatsController();
