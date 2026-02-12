import type { Response } from "express";
import type { AuthRequest } from "../auth/auth.middleware";
import { logger } from "../../utils/logger";
import { getViewerMessageStats } from "./viewer-message-stats.service";

export class ViewerMessageStatsController {
  public getMessageStats = async (req: AuthRequest, res: Response) => {
    const { viewerId, channelId } = req.params;
    const { startDate: startDateStr, endDate: endDateStr } = req.query as {
      startDate?: string;
      endDate?: string;
    };

    const startTime = Date.now();

    try {
      if (req.user?.role === "viewer" && req.user.viewerId !== viewerId) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const result = await getViewerMessageStats(viewerId, channelId, startDateStr, endDateStr);

      const totalTime = Date.now() - startTime;
      logger.debug("ViewerMessageStats", `Stats retrieved in ${totalTime}ms for viewer ${viewerId}, channel ${channelId}`);

      return res.json(result);
    } catch (error) {
      logger.error("ViewerMessageStats", "Error getting stats", error);
      return res.status(500).json({ error: "Internal Server Error" });
    }
  };
}
