import { Request, Response } from "express";
import { revenueService } from "./revenue.service";

interface AuthenticatedRequest extends Request {
  user?: {
    streamerId?: string;
    viewerId?: string;
    displayName?: string;
  };
}

export class RevenueController {
  /**
   * GET /api/streamer/revenue/overview
   * 獲取收益總覽
   */
  async getOverview(req: AuthenticatedRequest, res: Response) {
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
   * 獲取訂閱統計趨勢
   */
  async getSubscriptionStats(req: AuthenticatedRequest, res: Response) {
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
   * 獲取 Bits 統計趨勢
   */
  async getBitsStats(req: AuthenticatedRequest, res: Response) {
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
   * 獲取 Top 贊助者排行榜
   */
  async getTopSupporters(req: AuthenticatedRequest, res: Response) {
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
   * 手動同步訂閱數據
   */
  async syncSubscriptions(req: AuthenticatedRequest, res: Response) {
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
   * 匯出收益報表
   */
  async exportReport(req: AuthenticatedRequest, res: Response) {
    try {
      const streamerId = req.user?.streamerId;
      if (!streamerId) {
        return res.status(403).json({ error: "Streamer access required" });
      }

      const format = (req.query.format as string) || "csv";
      const days = parseInt(req.query.days as string) || 30;

      // 獲取數據
      const [subStats, bitsStats, overview] = await Promise.all([
        revenueService.getSubscriptionStats(streamerId, days),
        revenueService.getBitsStats(streamerId, days),
        revenueService.getRevenueOverview(streamerId),
      ]);

      if (format === "csv") {
        // 生成 CSV
        const lines = [
          "Date,Tier1,Tier2,Tier3,TotalSubs,SubRevenue,Bits,BitsRevenue",
        ];

        // 合併訂閱和 Bits 資料
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

      // JSON 格式
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
