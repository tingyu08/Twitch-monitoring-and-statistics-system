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

      // 使用 Promise.race 設定 25 秒超時（Render 免費版有 30 秒限制）
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("SYNC_TIMEOUT")), 25000);
      });

      await Promise.race([
        revenueService.syncSubscriptionSnapshot(streamerId),
        timeoutPromise,
      ]);

      return res.json({ success: true, message: "Subscription data synced" });
    } catch (error) {
      console.error("Sync subscriptions error:", error);
      
      const err = error as Error;
      
      // 更友善的錯誤訊息
      if (err.message === "SYNC_TIMEOUT") {
        return res.status(504).json({ 
          error: "Sync timeout - try again later",
          details: "The sync operation took too long. This may happen for channels with many subscribers."
        });
      }
      
      if (err.message?.includes("no valid token") || err.message?.includes("No refresh token")) {
        return res.status(401).json({ 
          error: "Token expired - please re-login",
          details: "Your Twitch authorization has expired. Please log out and log in again."
        });
      }
      
      if (err.message?.includes("Permission") || err.message?.includes("403")) {
        return res.status(403).json({ 
          error: "Permission denied",
          details: "This feature requires Twitch Affiliate or Partner status to access subscription data."
        });
      }
      
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

      if (format !== "csv" && format !== "pdf") {
        return res.status(400).json({ error: "Only CSV and PDF formats are supported" });
      }

      // 獲取數據
      const [subscriptionStats, bitsStats, overview] = await Promise.all([
        revenueService.getSubscriptionStats(streamerId, days),
        revenueService.getBitsStats(streamerId, days),
        revenueService.getRevenueOverview(streamerId),
      ]);

      // 構建報表數據
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

      if (format === "csv") {
        const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");

        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", `attachment; filename="revenue-report-${days}days.csv"`);
        return res.send(csv);
      } else {
        // PDF 格式 - 生成可讀的文本格式 PDF
        const pdfContent = this.generatePdfContent(overview, subscriptionStats, bitsStats, days);

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="revenue-report-${days}days.pdf"`);
        return res.send(pdfContent);
      }
    } catch (error) {
      console.error("Export report error:", error);
      return res.status(500).json({ error: "Failed to export report" });
    }
  }

  /**
   * 生成 PDF 內容（使用基本格式）
   */
  private generatePdfContent(
    overview: Awaited<ReturnType<typeof revenueService.getRevenueOverview>>,
    subscriptionStats: Awaited<ReturnType<typeof revenueService.getSubscriptionStats>>,
    bitsStats: Awaited<ReturnType<typeof revenueService.getBitsStats>>,
    days: number
  ): Buffer {
    const lines: string[] = [];
    const divider = "=".repeat(60);
    const subDivider = "-".repeat(60);

    // 標題
    lines.push("");
    lines.push(divider);
    lines.push("           TWITCH REVENUE REPORT");
    lines.push(`           Period: Last ${days} Days`);
    lines.push(`           Generated: ${new Date().toISOString().split("T")[0]}`);
    lines.push(divider);
    lines.push("");

    // 總覽摘要
    lines.push("REVENUE OVERVIEW");
    lines.push(subDivider);
    lines.push(`Total Estimated Revenue:    $${overview.totalEstimatedRevenue.toFixed(2)}`);
    lines.push("");
    lines.push("Subscriptions:");
    lines.push(`  - Total Subscribers:      ${overview.subscriptions.current}`);
    lines.push(`  - Tier 1:                 ${overview.subscriptions.tier1}`);
    lines.push(`  - Tier 2:                 ${overview.subscriptions.tier2}`);
    lines.push(`  - Tier 3:                 ${overview.subscriptions.tier3}`);
    lines.push(`  - Monthly Revenue:        $${overview.subscriptions.estimatedMonthlyRevenue.toFixed(2)}`);
    lines.push("");
    lines.push("Bits:");
    lines.push(`  - Total Bits:             ${overview.bits.totalBits.toLocaleString()}`);
    lines.push(`  - Cheer Events:           ${overview.bits.eventCount}`);
    lines.push(`  - Estimated Revenue:      $${overview.bits.estimatedRevenue.toFixed(2)}`);
    lines.push("");

    // 訂閱趨勢
    if (subscriptionStats.length > 0) {
      lines.push(divider);
      lines.push("SUBSCRIPTION HISTORY");
      lines.push(subDivider);
      lines.push("Date        | T1   | T2   | T3   | Total | Revenue");
      lines.push(subDivider);
      for (const stat of subscriptionStats.slice(-10)) {
        const date = stat.date.padEnd(11);
        const t1 = String(stat.tier1Count).padStart(4);
        const t2 = String(stat.tier2Count).padStart(4);
        const t3 = String(stat.tier3Count).padStart(4);
        const total = String(stat.totalSubscribers).padStart(5);
        const rev = `$${stat.estimatedRevenue.toFixed(2)}`.padStart(8);
        lines.push(`${date} | ${t1} | ${t2} | ${t3} | ${total} | ${rev}`);
      }
      lines.push("");
    }

    // Bits 趨勢
    if (bitsStats.length > 0) {
      lines.push(divider);
      lines.push("BITS HISTORY");
      lines.push(subDivider);
      lines.push("Date        | Total Bits | Events | Revenue");
      lines.push(subDivider);
      for (const stat of bitsStats.slice(-10)) {
        const date = stat.date.padEnd(11);
        const bits = String(stat.totalBits).padStart(10);
        const events = String(stat.eventCount).padStart(6);
        const rev = `$${stat.estimatedRevenue.toFixed(2)}`.padStart(8);
        lines.push(`${date} | ${bits} | ${events} | ${rev}`);
      }
      lines.push("");
    }

    // 頁尾
    lines.push(divider);
    lines.push("Note: Revenue estimates are based on standard 50% revenue share.");
    lines.push("Actual earnings may vary based on your contract with Twitch.");
    lines.push(divider);

    // 簡單的 PDF 格式（純文本 wrapper）
    // 使用 %PDF-1.4 標準格式生成最小化 PDF
    const textContent = lines.join("\n");
    return this.createSimplePdf(textContent);
  }

  /**
   * 創建簡單的 PDF 文件
   */
  private createSimplePdf(textContent: string): Buffer {
    // 創建最簡化的 PDF 結構
    const stream = textContent.replace(/\n/g, "\\n");

    const pdf = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj
4 0 obj
<< /Length ${stream.length + 50} >>
stream
BT
/F1 10 Tf
50 750 Td
(${stream}) Tj
ET
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>
endobj
xref
0 6
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
0000000266 00000 n
0000000${String(366 + stream.length).padStart(3, "0")} 00000 n
trailer
<< /Size 6 /Root 1 0 R >>
startxref
${420 + stream.length}
%%EOF`;

    return Buffer.from(pdf, "utf-8");
  }
}

export const revenueController = new RevenueController();
