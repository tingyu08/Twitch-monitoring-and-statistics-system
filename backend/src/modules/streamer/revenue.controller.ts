import type { Response } from "express";
import { revenueService } from "./revenue.service";
import type { AuthRequest } from "../auth/auth.middleware";

export class RevenueController {
  /**
   * GET /api/streamer/revenue/overview
   * ?²å??¶ç?ç¸½è¦½
   */
  async getOverview(req: AuthRequest, res: Response) {
    try {
      const streamerId = req.user?.streamerId;
      if (!streamerId) {
        return res.status(403).json({ error: "Streamer access required" });
      }

      const overview = await revenueService.getRevenueOverview(streamerId);
      return res.json(overview);
    } catch (error) {
      console.error("[RevenueController] getOverview error:", error);
      return res.status(500).json({ error: "Failed to get revenue overview" });
    }
  }

  /**
   * GET /api/streamer/revenue/subscriptions?days=30
   * ?²å?è¨‚é–±çµ±è?è¶¨å‹¢
   */
  async getSubscriptionStats(req: AuthRequest, res: Response) {
    try {
      const streamerId = req.user?.streamerId;
      if (!streamerId) {
        return res.status(403).json({ error: "Streamer access required" });
      }

      const days = parseInt(req.query.days as string) || 30;
      const stats = await revenueService.getSubscriptionStats(streamerId, days);
      return res.json(stats);
    } catch (error) {
      console.error("[RevenueController] getSubscriptionStats error:", error);
      return res
        .status(500)
        .json({ error: "Failed to get subscription stats" });
    }
  }

  /**
   * GET /api/streamer/revenue/bits?days=30
   * ?²å? Bits çµ±è?è¶¨å‹¢
   */
  async getBitsStats(req: AuthRequest, res: Response) {
    try {
      const streamerId = req.user?.streamerId;
      if (!streamerId) {
        return res.status(403).json({ error: "Streamer access required" });
      }

      const days = parseInt(req.query.days as string) || 30;
      const stats = await revenueService.getBitsStats(streamerId, days);
      return res.json(stats);
    } catch (error) {
      console.error("[RevenueController] getBitsStats error:", error);
      return res.status(500).json({ error: "Failed to get bits stats" });
    }
  }

  /**
   * GET /api/streamer/revenue/top-supporters?limit=10
   * ?²å? Top è´ŠåŠ©?…æ?è¡Œæ?
   */
  async getTopSupporters(req: AuthRequest, res: Response) {
    try {
      const streamerId = req.user?.streamerId;
      if (!streamerId) {
        return res.status(403).json({ error: "Streamer access required" });
      }

      const limit = parseInt(req.query.limit as string) || 10;
      const supporters = await revenueService.getTopSupporters(
        streamerId,
        limit
      );
      return res.json(supporters);
    } catch (error) {
      console.error("[RevenueController] getTopSupporters error:", error);
      return res.status(500).json({ error: "Failed to get top supporters" });
    }
  }

  /**
   * POST /api/streamer/revenue/sync
   * ?‹å??Œæ­¥è¨‚é–±?¸æ?
   */
  async syncSubscriptions(req: AuthRequest, res: Response) {
    try {
      const streamerId = req.user?.streamerId;
      if (!streamerId) {
        return res.status(403).json({ error: "Streamer access required" });
      }

      await revenueService.syncSubscriptionSnapshot(streamerId);
      return res.json({ success: true, message: "Subscription data synced" });
    } catch (error) {
      console.error("[RevenueController] syncSubscriptions error:", error);
      return res.status(500).json({ error: "Failed to sync subscriptions" });
    }
  }

  /**
   * GET /api/streamer/revenue/export?format=csv
   * ?¯å‡º?¶ç??±è¡¨
   */
  async exportReport(req: AuthRequest, res: Response) {
    try {
      const streamerId = req.user?.streamerId;
      if (!streamerId) {
        return res.status(403).json({ error: "Streamer access required" });
      }

      const format = (req.query.format as string) || "csv";
      const days = parseInt(req.query.days as string) || 30;

      // ?²å??¸æ?
      const [subStats, bitsStats, overview] = await Promise.all([
        revenueService.getSubscriptionStats(streamerId, days),
        revenueService.getBitsStats(streamerId, days),
        revenueService.getRevenueOverview(streamerId),
      ]);

      if (format === "csv") {
        // ?Ÿæ? CSV
        const lines = [
          "Date,Tier1,Tier2,Tier3,TotalSubs,SubRevenue,Bits,BitsRevenue",
        ];

        // ?ˆä½µè¨‚é–±??Bits è³‡æ?
        const allDates = new Set([
          ...subStats.map((s) => s.date),
          ...bitsStats.map((b) => b.date),
        ]);

        for (const date of Array.from(allDates).sort()) {
          const sub = subStats.find((s) => s.date === date);
          const bits = bitsStats.find((b) => b.date === date);
          lines.push(
            [
              date,
              sub?.tier1Count || 0,
              sub?.tier2Count || 0,
              sub?.tier3Count || 0,
              sub?.totalSubscribers || 0,
              (sub?.estimatedRevenue || 0).toFixed(2),
              bits?.totalBits || 0,
              (bits?.estimatedRevenue || 0).toFixed(2),
            ].join(",")
          );
        }

        res.setHeader("Content-Type", "text/csv");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename=revenue-report-${days}days.csv`
        );
        return res.send(lines.join("\n"));
      }

      // JSON ?¼å?
      return res.json({
        overview,
        subscriptions: subStats,
        bits: bitsStats,
        generatedAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error("[RevenueController] exportReport error:", error);
      return res.status(500).json({ error: "Failed to export report" });
    }
  }
}

export const revenueController = new RevenueController();
