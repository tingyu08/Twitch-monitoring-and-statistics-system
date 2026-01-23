import { Request, Response } from "express";
import { dashboardLayoutService } from "./dashboard-layout.service";
import { logger } from "../../utils/logger";

interface AuthenticatedRequest extends Request {
  user?: {
    viewerId: string;
    [key: string]: unknown;
  };
}

export class DashboardLayoutController {
  public getLayout = async (req: Request, res: Response) => {
    try {
      const { channelId } = req.params;
      const viewerId = (req as AuthenticatedRequest).user?.viewerId;

      if (!viewerId) return res.status(401).json({ error: "Unauthorized" });

      const layout = await dashboardLayoutService.getLayout(viewerId, channelId);

      res.json({ layout }); // Returns null or layout object
    } catch (error) {
      logger.error("DashboardLayout", "Error getting layout", error);
      res.status(500).json({ error: "Internal server error" });
    }
  };

  public saveLayout = async (req: Request, res: Response) => {
    try {
      // AC 5.1: POST /api/viewer/:viewerId/dashboard-layout
      // Body: { channelId, layout }
      // But route will likely be /api/viewer/dashboard/layout (without viewerId in path, derived from token)
      // Or /api/viewer/stats/:channelId/layout
      // Let's stick to using token for viewerId.

      const { channelId, layout } = req.body;
      const viewerId = (req as AuthenticatedRequest).user?.viewerId;

      if (!viewerId) return res.status(401).json({ error: "Unauthorized" });
      if (!channelId || !layout)
        return res.status(400).json({ error: "Missing channelId or layout" });

      await dashboardLayoutService.saveLayout(viewerId, channelId, layout);
      res.json({ success: true });
    } catch (error) {
      logger.error("DashboardLayout", "Error saving layout", error);
      res.status(500).json({ error: "Internal server error" });
    }
  };

  public resetLayout = async (req: Request, res: Response) => {
    try {
      const { channelId } = req.params;
      const viewerId = (req as AuthenticatedRequest).user?.viewerId;

      if (!viewerId) return res.status(401).json({ error: "Unauthorized" });

      await dashboardLayoutService.resetLayout(viewerId, channelId);
      res.json({ success: true, message: "Layout reset to default" });
    } catch (error) {
      logger.error("DashboardLayout", "Error resetting layout", error);
      res.status(500).json({ error: "Internal server error" });
    }
  };
}

export const dashboardLayoutController = new DashboardLayoutController();
