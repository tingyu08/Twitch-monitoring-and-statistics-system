import type { Response } from "express";
import type { AuthRequest } from "../auth/auth.middleware";
import { revenueService } from "./revenue.service";
import PDFDocument from "pdfkit";
import { cacheManager } from "../../utils/cache-manager";
import { prisma } from "../../db/prisma";
import {
  SYNC_TIMEOUT_MS,
  PDF_EXPORT,
  QUERY_LIMITS,
  BITS_TO_USD_RATE,
} from "../../config/revenue.config";
import { logger } from "../../utils/logger";

/**
 * 從已驗證的請求中提取 streamerId
 * 在 requireStreamer middleware 之後使用，確保 streamerId 存在
 */
function getStreamerId(req: AuthRequest): string {
  const streamerId = req.user?.streamerId;
  if (!streamerId) {
    throw new Error("Streamer ID not found in authenticated request");
  }
  return streamerId;
}

export class RevenueController {
  /**
   * GET /api/streamer/revenue/overview - 收益總覽
   */
  async getOverview(req: AuthRequest, res: Response) {
    try {
      const streamerId = getStreamerId(req);

      // Zeabur 免費層超時保護（25 秒）
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("QUERY_TIMEOUT")), 25000);
      });

      const overview = await Promise.race([
        revenueService.getRevenueOverview(streamerId),
        timeoutPromise,
      ]);

      return res.json(overview);
    } catch (error) {
      const err = error as Error;

      if (err.message === "QUERY_TIMEOUT") {
        logger.warn("RevenueController", "Revenue overview query timeout");
        // 降級策略：返回空數據而不是 502
        return res.json({
          subscriptions: { current: 0, estimatedMonthlyRevenue: 0, tier1: 0, tier2: 0, tier3: 0 },
          bits: { totalBits: 0, estimatedRevenue: 0, eventCount: 0 },
          totalEstimatedRevenue: 0,
          _timeout: true,
          _message: "查詢超時，請稍後重試或聯繫支援",
        });
      }

      logger.error("RevenueController", "Get revenue overview error:", error);
      return res.status(500).json({ error: "Failed to get revenue overview" });
    }
  }

  /**
   * GET /api/streamer/revenue/subscriptions?days=30 - 訂閱統計趨勢
   */
  async getSubscriptionStats(req: AuthRequest, res: Response) {
    try {
      const streamerId = getStreamerId(req);

      const days = Math.min(
        Math.max(
          parseInt(req.query.days as string) || QUERY_LIMITS.DEFAULT_DAYS,
          QUERY_LIMITS.MIN_DAYS
        ),
        QUERY_LIMITS.MAX_DAYS
      );

      // Zeabur 免費層超時保護（25 秒）
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("QUERY_TIMEOUT")), 25000);
      });

      const stats = await Promise.race([
        revenueService.getSubscriptionStats(streamerId, days),
        timeoutPromise,
      ]);

      return res.json(stats);
    } catch (error) {
      const err = error as Error;

      if (err.message === "QUERY_TIMEOUT") {
        logger.warn("RevenueController", "Subscription stats query timeout");
        // 降級策略：返回空陣列
        return res.json([]);
      }

      logger.error("RevenueController", "Get subscription stats error:", error);
      return res.status(500).json({ error: "Failed to get subscription stats" });
    }
  }

  /**
   * GET /api/streamer/revenue/bits?days=30 - Bits 統計趨勢
   */
  async getBitsStats(req: AuthRequest, res: Response) {
    try {
      const streamerId = getStreamerId(req);

      const days = Math.min(
        Math.max(
          parseInt(req.query.days as string) || QUERY_LIMITS.DEFAULT_DAYS,
          QUERY_LIMITS.MIN_DAYS
        ),
        QUERY_LIMITS.MAX_DAYS
      );

      // Zeabur 免費層超時保護（25 秒）
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("QUERY_TIMEOUT")), 25000);
      });

      const stats = await Promise.race([
        revenueService.getBitsStats(streamerId, days),
        timeoutPromise,
      ]);

      return res.json(stats);
    } catch (error) {
      const err = error as Error;

      if (err.message === "QUERY_TIMEOUT") {
        logger.warn("RevenueController", "Bits stats query timeout");
        // 降級策略：返回空陣列
        return res.json([]);
      }

      logger.error("RevenueController", "Get bits stats error:", error);
      return res.status(500).json({ error: "Failed to get bits stats" });
    }
  }

  /**
   * GET /api/streamer/revenue/top-supporters?limit=10 - Top 贊助者
   */
  async getTopSupporters(req: AuthRequest, res: Response) {
    try {
      const streamerId = getStreamerId(req);

      const limit = Math.min(
        Math.max(
          parseInt(req.query.limit as string) || QUERY_LIMITS.DEFAULT_LIMIT,
          QUERY_LIMITS.MIN_LIMIT
        ),
        QUERY_LIMITS.MAX_LIMIT
      );
      const supporters = await revenueService.getTopSupporters(streamerId, limit);
      return res.json(supporters);
    } catch (error) {
      logger.error("RevenueController", "Get top supporters error:", error);
      return res.status(500).json({ error: "Failed to get top supporters" });
    }
  }

  /**
   * POST /api/streamer/revenue/sync - 手動同步訂閱
   */
  async syncSubscriptions(req: AuthRequest, res: Response) {
    try {
      const streamerId = getStreamerId(req);

      // 使用 Promise.race 設定超時（Zeabur 免費層有 30 秒限制）
      let timeoutId: NodeJS.Timeout | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error("SYNC_TIMEOUT")), SYNC_TIMEOUT_MS);
      });

      try {
        await Promise.race([revenueService.syncSubscriptionSnapshot(streamerId), timeoutPromise]);
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }

      // 同步成功後清除所有相關快取（包含 overview、subscriptions、bits）
      cacheManager.deleteRevenueCache(streamerId);

      return res.json({ success: true, message: "Subscription data synced" });
    } catch (error) {
      logger.error("RevenueController", "Sync subscriptions error:", error);

      const err = error as Error;

      // 更友善的錯誤訊息
      if (err.message === "SYNC_TIMEOUT") {
        return res.status(504).json({
          error: "Sync timeout - try again later",
          details:
            "The sync operation took too long. This may happen for channels with many subscribers.",
        });
      }

      if (err.message?.includes("no valid token") || err.message?.includes("No refresh token")) {
        return res.status(401).json({
          error: "Token expired - please re-login",
          details: "Your Twitch authorization has expired. Please log out and log in again.",
        });
      }

      if (err.message?.includes("Permission") || err.message?.includes("403")) {
        return res.status(403).json({
          error: "Permission denied",
          details:
            "This feature requires Twitch Affiliate or Partner status to access subscription data.",
        });
      }

      if (err.message?.includes("SUBSCRIPTION_LIMIT_EXCEEDED")) {
        return res.status(507).json({
          error: "Subscription limit exceeded",
          details: err.message.replace("SUBSCRIPTION_LIMIT_EXCEEDED: ", ""),
        });
      }

      // 開發環境提供詳細錯誤訊息以便除錯
      return res.status(500).json({
        error: "Failed to sync subscriptions",
        details: process.env.NODE_ENV === "development" ? err.message : undefined,
        stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
      });
    }
  }

  /**
   * GET /api/streamer/revenue/export?format=csv&days=30 - 匯出報表
   */
  async exportReport(req: AuthRequest, res: Response) {
    try {
      const streamerId = getStreamerId(req);

      const days = Math.min(
        Math.max(
          parseInt(req.query.days as string) || QUERY_LIMITS.DEFAULT_DAYS,
          QUERY_LIMITS.MIN_DAYS
        ),
        QUERY_LIMITS.MAX_DAYS
      );
      const format = (req.query.format as string) || "csv";

      if (format !== "csv" && format !== "pdf") {
        return res.status(400).json({ error: "Only CSV and PDF formats are supported" });
      }

      // 在 Zeabur 免費層上，PDF 生成較消耗記憶體
      // 如果資料量過大，建議使用 CSV 格式
      if (format === "pdf" && days > PDF_EXPORT.MAX_DAYS) {
        return res.status(400).json({
          error: `PDF export is limited to ${PDF_EXPORT.MAX_DAYS} days maximum`,
          suggestion: "Please use CSV format for longer periods or reduce the date range",
        });
      }

      if (format === "csv") {
        // 使用 streaming CSV export 避免記憶體累積
        return this.streamCsvExport(res, streamerId, days);
      } else {
        // PDF 格式 - 使用 streaming 直接 pipe 到 response
        try {
          // 先獲取數據
          const [subscriptionStats, bitsStats, overview] = await Promise.all([
            revenueService.getSubscriptionStats(streamerId, days),
            revenueService.getBitsStats(streamerId, days),
            revenueService.getRevenueOverview(streamerId),
          ]);

          // 使用 streaming PDF export
          return this.streamPdfExport(res, overview, subscriptionStats, bitsStats, days);
        } catch (pdfError) {
          logger.error("RevenueController", "PDF generation failed:", pdfError);
          // 降級策略：如果 PDF 生成失敗，建議使用 CSV
          return res.status(500).json({
            error: "PDF generation failed",
            suggestion: "Please try CSV format instead or reduce the date range",
            details:
              process.env.NODE_ENV === "development" ? (pdfError as Error).message : undefined,
          });
        }
      }
    } catch (error) {
      logger.error("RevenueController", "Export report error:", error);
      return res.status(500).json({ error: "Failed to export report" });
    }
  }

  /**
   * Streaming CSV Export - 分批讀取資料庫並串流寫入
   * 優化記憶體使用，避免一次載入所有資料
   */
  private async streamCsvExport(res: Response, streamerId: string, days: number): Promise<void> {
    const BATCH_SIZE = 50;

    // 設定 response headers
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="revenue-${days}days.csv"`);

    // 寫入 BOM 確保 Excel 正確識別 UTF-8
    res.write("\ufeff");

    // 寫入 CSV headers
    res.write("Date,Tier1,Tier2,Tier3,Total,SubRevenue,Bits,BitsRevenue\n");

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    // 建立日期到 Bits 的映射（Bits 資料量通常較少，先全部載入）
    const bitsMap = new Map<string, { totalBits: number; eventCount: number }>();
    const bitsResults = await prisma.$queryRaw<
      Array<{ date: string; totalBits: bigint; eventCount: bigint }>
    >`
      SELECT
        DATE(cheeredAt) as date,
        SUM(bits) as totalBits,
        COUNT(*) as eventCount
      FROM cheer_events
      WHERE streamerId = ${streamerId}
        AND cheeredAt >= ${startDate.toISOString()}
      GROUP BY DATE(cheeredAt)
      ORDER BY date ASC
    `;

    for (const row of bitsResults) {
      bitsMap.set(row.date, {
        totalBits: Number(row.totalBits),
        eventCount: Number(row.eventCount),
      });
    }

    // 分批讀取訂閱快照並串流寫入
    let offset = 0;
    let hasMore = true;
    const processedDates = new Set<string>();

    while (hasMore) {
      const subs = await prisma.subscriptionSnapshot.findMany({
        where: {
          streamerId,
          snapshotDate: { gte: startDate },
        },
        orderBy: { snapshotDate: "asc" },
        skip: offset,
        take: BATCH_SIZE,
      });

      for (const sub of subs) {
        const dateStr = sub.snapshotDate.toISOString().split("T")[0];
        processedDates.add(dateStr);

        const bits = bitsMap.get(dateStr);
        const bitsRevenue = bits ? bits.totalBits * BITS_TO_USD_RATE : 0;

        res.write(
          `${dateStr},${sub.tier1Count},${sub.tier2Count},${sub.tier3Count},` +
            `${sub.totalSubscribers},${(sub.estimatedRevenue || 0).toFixed(2)},` +
            `${bits?.totalBits || 0},${bitsRevenue.toFixed(2)}\n`
        );
      }

      hasMore = subs.length === BATCH_SIZE;
      offset += BATCH_SIZE;
    }

    // 寫入只有 Bits 資料的日期（沒有訂閱快照的日期）
    for (const [dateStr, bits] of bitsMap.entries()) {
      if (!processedDates.has(dateStr)) {
        const bitsRevenue = bits.totalBits * BITS_TO_USD_RATE;
        res.write(`${dateStr},0,0,0,0,0.00,${bits.totalBits},${bitsRevenue.toFixed(2)}\n`);
      }
    }

    res.end();
  }

  /**
   * Streaming PDF Export - 直接 pipe 到 Response
   * 優化記憶體使用：禁用緩衝、啟用壓縮
   */
  private streamPdfExport(
    res: Response,
    overview: Awaited<ReturnType<typeof revenueService.getRevenueOverview>>,
    subscriptionStats: Awaited<ReturnType<typeof revenueService.getSubscriptionStats>>,
    bitsStats: Awaited<ReturnType<typeof revenueService.getBitsStats>>,
    days: number
  ): void {
    // 設定 response headers
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="revenue-report-${days}days.pdf"`);

    // 建立 PDF document，禁用緩衝、啟用壓縮
    const doc = new PDFDocument({
      margin: 50,
      bufferPages: false, // 禁用頁面緩衝
      compress: true, // 啟用壓縮
      autoFirstPage: true,
      size: "A4",
    });

    // 直接 pipe 到 response
    doc.pipe(res);

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
      doc
        .fontSize(9)
        .font("Helvetica-Oblique")
        .text(`(Showing last 10 records out of ${subscriptionStats.length} total)`, {
          align: "left",
        });
      doc.moveDown(0.5);

      // 表格標題
      doc.fontSize(9).font("Helvetica-Bold");
      const colWidths = { date: 80, t1: 40, t2: 40, t3: 40, total: 50, revenue: 70 };
      let x = 50;
      doc.text("Date", x, doc.y);
      x += colWidths.date;
      doc.text("T1", x, doc.y);
      x += colWidths.t1;
      doc.text("T2", x, doc.y);
      x += colWidths.t2;
      doc.text("T3", x, doc.y);
      x += colWidths.t3;
      doc.text("Total", x, doc.y);
      x += colWidths.total;
      doc.text("Revenue", x, doc.y);
      doc.moveDown(0.3);

      // 表格數據（最近 10 筆）
      doc.fontSize(9).font("Helvetica");
      const recentSubscriptions = subscriptionStats.slice(-PDF_EXPORT.MAX_RECORDS_PER_TABLE);
      for (const stat of recentSubscriptions) {
        x = 50;
        const y = doc.y;
        doc.text(stat.date, x, y);
        x += colWidths.date;
        doc.text(String(stat.tier1Count), x, y);
        x += colWidths.t1;
        doc.text(String(stat.tier2Count), x, y);
        x += colWidths.t2;
        doc.text(String(stat.tier3Count), x, y);
        x += colWidths.t3;
        doc.text(String(stat.totalSubscribers), x, y);
        x += colWidths.total;
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
      doc
        .fontSize(9)
        .font("Helvetica-Oblique")
        .text(`(Showing last 10 records out of ${bitsStats.length} total)`, { align: "left" });
      doc.moveDown(0.5);

      // 表格標題
      doc.fontSize(9).font("Helvetica-Bold");
      const colWidths = { date: 80, bits: 80, events: 60, revenue: 70 };
      let x = 50;
      doc.text("Date", x, doc.y);
      x += colWidths.date;
      doc.text("Total Bits", x, doc.y);
      x += colWidths.bits;
      doc.text("Events", x, doc.y);
      x += colWidths.events;
      doc.text("Revenue", x, doc.y);
      doc.moveDown(0.3);

      // 表格數據（最近 10 筆）
      doc.fontSize(9).font("Helvetica");
      const recentBits = bitsStats.slice(-PDF_EXPORT.MAX_RECORDS_PER_TABLE);
      for (const stat of recentBits) {
        x = 50;
        const y = doc.y;
        doc.text(stat.date, x, y);
        x += colWidths.date;
        doc.text(String(stat.totalBits), x, y);
        x += colWidths.bits;
        doc.text(String(stat.eventCount), x, y);
        x += colWidths.events;
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

    // 結束文件
    doc.end();
  }
}

export const revenueController = new RevenueController();
