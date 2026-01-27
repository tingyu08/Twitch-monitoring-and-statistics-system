import type { Response } from "express";
import type { AuthRequest } from "../auth/auth.middleware";
import { revenueService } from "./revenue.service";
import PDFDocument from "pdfkit";
import { cacheManager, CacheKeys } from "../../utils/cache-manager";
import { SYNC_TIMEOUT_MS, PDF_EXPORT, QUERY_LIMITS } from "../../config/revenue.config";

export class RevenueController {
  /**
   * GET /api/streamer/revenue/overview - 收益總覽
   */
  async getOverview(req: AuthRequest, res: Response) {
    try {
      // streamerId 已在 requireStreamer middleware 中驗證
      const streamerId = req.user!.streamerId!;

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
      const streamerId = req.user!.streamerId!;

      const days = Math.min(
        Math.max(parseInt(req.query.days as string) || QUERY_LIMITS.DEFAULT_DAYS, QUERY_LIMITS.MIN_DAYS),
        QUERY_LIMITS.MAX_DAYS
      );
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
      const streamerId = req.user!.streamerId!;

      const days = Math.min(
        Math.max(parseInt(req.query.days as string) || QUERY_LIMITS.DEFAULT_DAYS, QUERY_LIMITS.MIN_DAYS),
        QUERY_LIMITS.MAX_DAYS
      );
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
      const streamerId = req.user!.streamerId!;

      const limit = Math.min(
        Math.max(parseInt(req.query.limit as string) || QUERY_LIMITS.DEFAULT_LIMIT, QUERY_LIMITS.MIN_LIMIT),
        QUERY_LIMITS.MAX_LIMIT
      );
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
      const streamerId = req.user!.streamerId!;

      // 使用 Promise.race 設定超時（Render 免費版有 30 秒限制）
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("SYNC_TIMEOUT")), SYNC_TIMEOUT_MS);
      });

      await Promise.race([
        revenueService.syncSubscriptionSnapshot(streamerId),
        timeoutPromise,
      ]);

      // 同步成功後清除相關快取
      cacheManager.delete(CacheKeys.revenueOverview(streamerId));
      // 清除各時間範圍的訂閱統計快取
      [7, 30, 90].forEach(days => {
        cacheManager.delete(CacheKeys.revenueSubscriptions(streamerId, days));
      });

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

      if (err.message?.includes("SUBSCRIPTION_LIMIT_EXCEEDED")) {
        return res.status(507).json({
          error: "Subscription limit exceeded",
          details: err.message.replace("SUBSCRIPTION_LIMIT_EXCEEDED: ", "")
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
      const streamerId = req.user!.streamerId!;

      const days = Math.min(
        Math.max(parseInt(req.query.days as string) || QUERY_LIMITS.DEFAULT_DAYS, QUERY_LIMITS.MIN_DAYS),
        QUERY_LIMITS.MAX_DAYS
      );
      const format = (req.query.format as string) || "csv";

      if (format !== "csv" && format !== "pdf") {
        return res.status(400).json({ error: "Only CSV and PDF formats are supported" });
      }

      // 在 Render free tier 上，PDF 生成較消耗記憶體
      // 如果資料量過大，建議使用 CSV 格式
      if (format === "pdf" && days > PDF_EXPORT.MAX_DAYS) {
        return res.status(400).json({
          error: `PDF export is limited to ${PDF_EXPORT.MAX_DAYS} days maximum`,
          suggestion: "Please use CSV format for longer periods or reduce the date range"
        });
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
        // CSV 轉義函數：處理逗號、引號等特殊字元
        const escapeCsv = (value: string): string => {
          // 將值轉為字串並處理引號（雙引號轉義為兩個雙引號）
          const escaped = String(value).replace(/"/g, '""');
          // 如果包含逗號、引號或換行，需要用引號包圍
          if (escaped.includes(',') || escaped.includes('"') || escaped.includes('\n')) {
            return `"${escaped}"`;
          }
          return escaped;
        };

        const csv = [
          headers.map(escapeCsv).join(","),
          ...rows.map((r) => r.map(escapeCsv).join(","))
        ].join("\n");

        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="revenue-report-${days}days.csv"`);
        // 添加 BOM 以確保 Excel 正確識別 UTF-8
        return res.send('\ufeff' + csv);
      } else {
        // PDF 格式 - 使用 pdfkit 生成專業 PDF
        try {
          const pdfBuffer = await this.generatePdfContent(overview, subscriptionStats, bitsStats, days);

          res.setHeader("Content-Type", "application/pdf");
          res.setHeader("Content-Disposition", `attachment; filename="revenue-report-${days}days.pdf"`);
          return res.send(pdfBuffer);
        } catch (pdfError) {
          console.error("PDF generation failed:", pdfError);
          // 降級策略：如果 PDF 生成失敗，建議使用 CSV
          return res.status(500).json({
            error: "PDF generation failed",
            suggestion: "Please try CSV format instead or reduce the date range",
            details: process.env.NODE_ENV === "development" ? (pdfError as Error).message : undefined
          });
        }
      }
    } catch (error) {
      console.error("Export report error:", error);
      return res.status(500).json({ error: "Failed to export report" });
    }
  }

  /**
   * 生成 PDF 內容（使用 pdfkit）
   * 優化記憶體使用以適應 Render free tier (512MB RAM)
   */
  private async generatePdfContent(
    overview: Awaited<ReturnType<typeof revenueService.getRevenueOverview>>,
    subscriptionStats: Awaited<ReturnType<typeof revenueService.getSubscriptionStats>>,
    bitsStats: Awaited<ReturnType<typeof revenueService.getBitsStats>>,
    days: number
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      // 添加超時保護（30秒）
      const timeout = setTimeout(() => {
        doc.end();
        reject(new Error("PDF generation timeout"));
      }, 30000);

      const doc = new PDFDocument({
        margin: 50,
        bufferPages: true, // 啟用頁面緩衝以減少記憶體使用
        autoFirstPage: true,
        size: 'A4'
      });
      const chunks: Buffer[] = [];

      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => {
        clearTimeout(timeout);
        resolve(Buffer.concat(chunks));
      });
      doc.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      // 標題
      doc.fontSize(20).font("Helvetica-Bold").text("TWITCH REVENUE REPORT", { align: "center" });
      doc.moveDown(0.5);
      doc.fontSize(12).font("Helvetica").text(`Period: Last ${days} Days`, { align: "center" });
      doc.text(`Generated: ${new Date().toISOString().split("T")[0]}`, { align: "center" });
      doc.moveDown(1);

      // 分隔線
      doc.moveTo(50, doc.y).lineTo(562, doc.y).stroke();
      doc.moveDown(1);

      // 總覽摘要
      doc.fontSize(14).font("Helvetica-Bold").text("REVENUE OVERVIEW");
      doc.moveDown(0.5);
      doc.fontSize(11).font("Helvetica");
      doc.text(`Total Estimated Revenue: $${overview.totalEstimatedRevenue.toFixed(2)}`);
      doc.moveDown(0.5);

      // 訂閱統計
      doc.fontSize(12).font("Helvetica-Bold").text("Subscriptions:");
      doc.fontSize(10).font("Helvetica");
      doc.text(`  Total Subscribers: ${overview.subscriptions.current}`);
      doc.text(`  Tier 1: ${overview.subscriptions.tier1}`);
      doc.text(`  Tier 2: ${overview.subscriptions.tier2}`);
      doc.text(`  Tier 3: ${overview.subscriptions.tier3}`);
      doc.text(`  Monthly Revenue: $${overview.subscriptions.estimatedMonthlyRevenue.toFixed(2)}`);
      doc.moveDown(0.5);

      // Bits 統計
      doc.fontSize(12).font("Helvetica-Bold").text("Bits:");
      doc.fontSize(10).font("Helvetica");
      doc.text(`  Total Bits: ${overview.bits.totalBits.toLocaleString()}`);
      doc.text(`  Cheer Events: ${overview.bits.eventCount}`);
      doc.text(`  Estimated Revenue: $${overview.bits.estimatedRevenue.toFixed(2)}`);
      doc.moveDown(1);

      // 訂閱歷史（只顯示最近 10 筆以節省記憶體）
      if (subscriptionStats.length > 0) {
        doc.moveTo(50, doc.y).lineTo(562, doc.y).stroke();
        doc.moveDown(0.5);
        doc.fontSize(14).font("Helvetica-Bold").text("SUBSCRIPTION HISTORY");
        doc.fontSize(9).font("Helvetica-Oblique")
          .text(`(Showing last 10 records out of ${subscriptionStats.length} total)`, { align: "left" });
        doc.moveDown(0.5);

        // 表格標題
        doc.fontSize(9).font("Helvetica-Bold");
        const colWidths = { date: 80, t1: 40, t2: 40, t3: 40, total: 50, revenue: 70 };
        let x = 50;
        doc.text("Date", x, doc.y); x += colWidths.date;
        doc.text("T1", x, doc.y); x += colWidths.t1;
        doc.text("T2", x, doc.y); x += colWidths.t2;
        doc.text("T3", x, doc.y); x += colWidths.t3;
        doc.text("Total", x, doc.y); x += colWidths.total;
        doc.text("Revenue", x, doc.y);
        doc.moveDown(0.3);

        // 表格數據（最近 10 筆）- 限制數量以節省記憶體
        doc.fontSize(9).font("Helvetica");
        const recentSubscriptions = subscriptionStats.slice(-10);
        for (const stat of recentSubscriptions) {
          x = 50;
          const y = doc.y;
          doc.text(stat.date, x, y); x += colWidths.date;
          doc.text(String(stat.tier1Count), x, y); x += colWidths.t1;
          doc.text(String(stat.tier2Count), x, y); x += colWidths.t2;
          doc.text(String(stat.tier3Count), x, y); x += colWidths.t3;
          doc.text(String(stat.totalSubscribers), x, y); x += colWidths.total;
          doc.text(`$${stat.estimatedRevenue.toFixed(2)}`, x, y);
          doc.moveDown(0.5);
        }
        doc.moveDown(0.5);
      }

      // Bits 歷史（只顯示最近 10 筆以節省記憶體）
      if (bitsStats.length > 0) {
        doc.moveTo(50, doc.y).lineTo(562, doc.y).stroke();
        doc.moveDown(0.5);
        doc.fontSize(14).font("Helvetica-Bold").text("BITS HISTORY");
        doc.fontSize(9).font("Helvetica-Oblique")
          .text(`(Showing last 10 records out of ${bitsStats.length} total)`, { align: "left" });
        doc.moveDown(0.5);

        // 表格標題
        doc.fontSize(9).font("Helvetica-Bold");
        const colWidths = { date: 80, bits: 80, events: 60, revenue: 70 };
        let x = 50;
        doc.text("Date", x, doc.y); x += colWidths.date;
        doc.text("Total Bits", x, doc.y); x += colWidths.bits;
        doc.text("Events", x, doc.y); x += colWidths.events;
        doc.text("Revenue", x, doc.y);
        doc.moveDown(0.3);

        // 表格數據（最近 10 筆）- 限制數量以節省記憶體
        doc.fontSize(9).font("Helvetica");
        const recentBits = bitsStats.slice(-10);
        for (const stat of recentBits) {
          x = 50;
          const y = doc.y;
          doc.text(stat.date, x, y); x += colWidths.date;
          doc.text(String(stat.totalBits), x, y); x += colWidths.bits;
          doc.text(String(stat.eventCount), x, y); x += colWidths.events;
          doc.text(`$${stat.estimatedRevenue.toFixed(2)}`, x, y);
          doc.moveDown(0.5);
        }
        doc.moveDown(0.5);
      }

      // 頁尾說明
      doc.moveTo(50, doc.y).lineTo(562, doc.y).stroke();
      doc.moveDown(0.5);
      doc.fontSize(9).font("Helvetica-Oblique");
      doc.text("Note: Revenue estimates are based on standard 50% revenue share.");
      doc.text("Actual earnings may vary based on your contract with Twitch.");

      doc.end();
    });
  }
}

export const revenueController = new RevenueController();
