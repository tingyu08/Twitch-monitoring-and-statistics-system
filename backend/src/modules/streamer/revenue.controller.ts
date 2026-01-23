import type { Response } from "express";
import type { AuthRequest } from "../auth/auth.middleware";
import { revenueService } from "./revenue.service";

export class RevenueController {
  /**
   * GET /api/streamer/revenue/overview - 收益總覽
   */
  async getOverview(req: AuthRequest, res: Response) {
    try {
      const streamerId = req.user?.streamerId;
      if (!streamerId) {
        return res.status(403).json({ error: "Not a streamer" });
      }

      const overview = await revenueService.getRevenueOverview(streamerId);
      return res.json(overview);
    } catch (error) {
      console.error("Get revenue overview error:", error);
      return res.status(500).json({ error: "Failed to get revenue overview" });
    }
  }

  /**
   * GET /api/streamer/revenue/subscriptions?days=30 - 訂閱統計趨勢
   */
  async getSubscriptionStats(req: AuthRequest, res: Response) {
    try {
      const streamerId = req.user?.streamerId;
      if (!streamerId) {
        return res.status(403).json({ error: "Not a streamer" });
      }

      const days = parseInt(req.query.days as string) || 30;
      const stats = await revenueService.getSubscriptionStats(streamerId, days);
      return res.json(stats);
    } catch (error) {
      console.error("Get subscription stats error:", error);
      return res.status(500).json({ error: "Failed to get subscription stats" });
    }
  }

  /**
   * GET /api/streamer/revenue/bits?days=30 - Bits 統計趨勢
   */
  async getBitsStats(req: AuthRequest, res: Response) {
    try {
      const streamerId = req.user?.streamerId;
      if (!streamerId) {
        return res.status(403).json({ error: "Not a streamer" });
      }

      const days = parseInt(req.query.days as string) || 30;
      const stats = await revenueService.getBitsStats(streamerId, days);
      return res.json(stats);
    } catch (error) {
      console.error("Get bits stats error:", error);
      return res.status(500).json({ error: "Failed to get bits stats" });
    }
  }

  /**
   * GET /api/streamer/revenue/top-supporters?limit=10 - Top 贊助者
   */
  async getTopSupporters(req: AuthRequest, res: Response) {
    try {
      const streamerId = req.user?.streamerId;
      if (!streamerId) {
        return res.status(403).json({ error: "Not a streamer" });
      }

      const limit = parseInt(req.query.limit as string) || 10;
      const supporters = await revenueService.getTopSupporters(streamerId, limit);
      return res.json(supporters);
    } catch (error) {
      console.error("Get top supporters error:", error);
      return res.status(500).json({ error: "Failed to get top supporters" });
    }
  }

  /**
   * POST /api/streamer/revenue/sync - 手動同步訂閱
   */
  async syncSubscriptions(req: AuthRequest, res: Response) {
    try {
      const streamerId = req.user?.streamerId;
      if (!streamerId) {
        return res.status(403).json({ error: "Not a streamer" });
      }

      await revenueService.syncSubscriptionSnapshot(streamerId);
      return res.json({ success: true, message: "Subscription data synced" });
    } catch (error) {
      console.error("Sync subscriptions error:", error);
      return res.status(500).json({ error: "Failed to sync subscriptions" });
    }
  }

  /**
   * GET /api/streamer/revenue/export?format=csv&days=30 - 匯出報表
   */
  async exportReport(req: AuthRequest, res: Response) {
    try {
      const streamerId = req.user?.streamerId;
      if (!streamerId) {
        return res.status(403).json({ error: "Not a streamer" });
      }

      const days = parseInt(req.query.days as string) || 30;
      const format = (req.query.format as string) || "csv";

      if (format !== "csv") {
        return res.status(400).json({ error: "Only CSV format is supported" });
      }

      // 獲取數據
      const [subscriptionStats, bitsStats] = await Promise.all([
        revenueService.getSubscriptionStats(streamerId, days),
        revenueService.getBitsStats(streamerId, days),
      ]);

      // 構建 CSV
      const headers = [
        "Date",
        "Tier1 Subscribers",
        "Tier2 Subscribers",
        "Tier3 Subscribers",
        "Total Subscribers",
        "Subscription Revenue (USD)",
        "Bits Received",
        "Bits Revenue (USD)",
      ];

      const rows: string[][] = [];

      // 合併訂閱和 Bits 數據
      const allDates = new Set([
        ...subscriptionStats.map((s) => s.date),
        ...bitsStats.map((b) => b.date),
      ]);

      for (const date of Array.from(allDates).sort()) {
        const sub = subscriptionStats.find((s) => s.date === date);
        const bits = bitsStats.find((b) => b.date === date);

        rows.push([
          date,
          String(sub?.tier1Count || 0),
          String(sub?.tier2Count || 0),
          String(sub?.tier3Count || 0),
          String(sub?.totalSubscribers || 0),
          String((sub?.estimatedRevenue || 0).toFixed(2)),
          String(bits?.totalBits || 0),
          String((bits?.estimatedRevenue || 0).toFixed(2)),
        ]);
      }

      const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="revenue-report-${days}days.csv"`);
      return res.send(csv);
    } catch (error) {
      console.error("Export report error:", error);
      return res.status(500).json({ error: "Failed to export report" });
    }
  }
}

export const revenueController = new RevenueController();
