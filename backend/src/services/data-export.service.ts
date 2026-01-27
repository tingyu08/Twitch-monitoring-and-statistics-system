/**
 * Data Export Service
 * 生成觀眾資料匯出包 (JSON + CSV + ZIP)
 *
 * Story 2.5: 觀眾隱私與授權控制
 */

import { prisma } from "../db/prisma";
import type { ExportJob } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";
import archiver from "archiver";
import { logger } from "../utils/logger";

// 匯出檔案存放目錄
const EXPORT_DIR = process.env.EXPORT_STORAGE_PATH || "./exports";
// 匯出檔案有效期（小時）
const EXPORT_EXPIRY_HOURS = parseInt(process.env.EXPORT_EXPIRY_HOURS || "24");

export interface ExportJobResult {
  success: boolean;
  message: string;
  job?: ExportJob;
  downloadPath?: string;
}

// 匯出資料類型定義 (使用寬鬆類型以兼容 Prisma 返回值)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ExportViewerData = Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ExportDailyStat = Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ExportMessageAgg = Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ExportLifetimeStat = Record<string, any>;

/**
 * Helper: Check if a path exists (async)
 */
async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export class DataExportService {
  private initialized = false;

  /**
   * Initialize export directory (called lazily)
   */
  private async ensureExportDir(): Promise<void> {
    if (this.initialized) return;

    const exists = await pathExists(EXPORT_DIR);
    if (!exists) {
      await fs.promises.mkdir(EXPORT_DIR, { recursive: true });
    }
    this.initialized = true;
  }

  /**
   * 建立並執行匯出任務
   * 使用同步處理（簡化方案）
   */
  async createExportJob(viewerId: string): Promise<ExportJobResult> {
    // Ensure export directory exists
    await this.ensureExportDir();

    // 檢查觀眾是否存在
    const viewer = await prisma.viewer.findUnique({
      where: { id: viewerId },
    });

    if (!viewer) {
      return {
        success: false,
        message: "找不到觀眾記錄",
      };
    }

    // 建立匯出任務記錄
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + EXPORT_EXPIRY_HOURS);

    const job = await prisma.exportJob.create({
      data: {
        viewerId,
        status: "processing",
        expiresAt,
      },
    });

    try {
      // 同步執行匯出
      const downloadPath = await this.generateExport(viewerId, job.id);

      // 更新任務狀態
      const updatedJob = await prisma.exportJob.update({
        where: { id: job.id },
        data: {
          status: "completed",
          downloadPath,
        },
      });

      // 記錄審計日誌
      await prisma.privacyAuditLog.create({
        data: {
          viewerId,
          action: "data_exported",
          details: JSON.stringify({
            jobId: job.id,
            expiresAt: expiresAt.toISOString(),
          }),
        },
      });

      return {
        success: true,
        message: "資料匯出完成",
        job: updatedJob,
        downloadPath,
      };
    } catch (error) {
      // 更新任務狀態為失敗
      await prisma.exportJob.update({
        where: { id: job.id },
        data: {
          status: "failed",
          errorMessage: error instanceof Error ? error.message : "未知錯誤",
        },
      });

      return {
        success: false,
        message: `匯出失敗: ${error instanceof Error ? error.message : "未知錯誤"}`,
        job,
      };
    }
  }

  /**
   * 生成匯出資料並打包成 ZIP
   */
  private async generateExport(viewerId: string, _jobId: string): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const exportName = `viewer-data-export-${viewerId.slice(0, 8)}-${timestamp}`;
    const exportDir = path.join(EXPORT_DIR, exportName);
    const zipPath = path.join(EXPORT_DIR, `${exportName}.zip`);

    // 建立暫存目錄
    await fs.promises.mkdir(exportDir, { recursive: true });
    await fs.promises.mkdir(path.join(exportDir, "json"), { recursive: true });
    await fs.promises.mkdir(path.join(exportDir, "csv"), { recursive: true });

    try {
      // 獲取所有資料
      const viewer = await prisma.viewer.findUnique({
        where: { id: viewerId },
        include: {
          privacyConsent: true,
        },
      });

      if (!viewer) {
        throw new Error("找不到觀眾記錄");
      }

      const dailyStats = await prisma.viewerChannelDailyStat.findMany({
        where: { viewerId },
        include: { channel: true },
        orderBy: { date: "desc" },
      });

      const messageAggs = await prisma.viewerChannelMessageDailyAgg.findMany({
        where: { viewerId },
        include: { channel: true },
        orderBy: { date: "desc" },
      });

      const lifetimeStats = await prisma.viewerChannelLifetimeStats.findMany({
        where: { viewerId },
        include: { channel: true },
      });

      // 生成 JSON 檔案
      await this.generateJsonFiles(exportDir, {
        viewer,
        dailyStats,
        messageAggs,
        lifetimeStats,
      });

      // 生成 CSV 檔案
      await this.generateCsvFiles(exportDir, {
        dailyStats,
        messageAggs,
      });

      // 生成 README
      await this.generateReadme(exportDir);

      // 打包成 ZIP
      await this.createZipArchive(exportDir, zipPath);

      // 清理暫存目錄
      await fs.promises.rm(exportDir, { recursive: true, force: true });

      return zipPath;
    } catch (error) {
      // 清理暫存目錄
      const exists = await pathExists(exportDir);
      if (exists) {
        await fs.promises.rm(exportDir, { recursive: true, force: true });
      }
      throw error;
    }
  }

  /**
   * 生成 JSON 檔案
   */
  private async generateJsonFiles(
    exportDir: string,
    data: {
      viewer: ExportViewerData;
      dailyStats: ExportDailyStat[];
      messageAggs: ExportMessageAgg[];
      lifetimeStats: ExportLifetimeStat[];
    }
  ): Promise<void> {
    const jsonDir = path.join(exportDir, "json");

    // profile.json - 基本資料
    const profile = {
      id: data.viewer.id,
      twitchUserId: data.viewer.twitchUserId,
      displayName: data.viewer.displayName,
      createdAt: data.viewer.createdAt,
      updatedAt: data.viewer.updatedAt,
    };
    await fs.promises.writeFile(
      path.join(jsonDir, "profile.json"),
      JSON.stringify(profile, null, 2)
    );

    // watch-time-stats.json - 觀看時數記錄
    const watchTimeStats = data.dailyStats.map((stat) => ({
      date: stat.date,
      channelName: stat.channel?.channelName,
      watchSeconds: stat.watchSeconds,
      messageCount: stat.messageCount,
      emoteCount: stat.emoteCount,
    }));
    await fs.promises.writeFile(
      path.join(jsonDir, "watch-time-stats.json"),
      JSON.stringify(watchTimeStats, null, 2)
    );

    // message-stats.json - 留言統計
    const messageStats = data.messageAggs.map((agg) => ({
      date: agg.date,
      channelName: agg.channel?.channelName,
      totalMessages: agg.totalMessages,
      chatMessages: agg.chatMessages,
      subscriptions: agg.subscriptions,
      cheers: agg.cheers,
      giftSubs: agg.giftSubs,
      raids: agg.raids,
      totalBits: agg.totalBits,
    }));
    await fs.promises.writeFile(
      path.join(jsonDir, "message-stats.json"),
      JSON.stringify(messageStats, null, 2)
    );

    // lifetime-stats.json - 全時段統計
    const lifetimeStats = data.lifetimeStats.map((stat) => ({
      channelName: stat.channel?.channelName,
      totalWatchTimeMinutes: stat.totalWatchTimeMinutes,
      totalSessions: stat.totalSessions,
      totalMessages: stat.totalMessages,
      totalChatMessages: stat.totalChatMessages,
      totalSubscriptions: stat.totalSubscriptions,
      totalCheers: stat.totalCheers,
      totalBits: stat.totalBits,
      trackingDays: stat.trackingDays,
      longestStreakDays: stat.longestStreakDays,
      firstWatchedAt: stat.firstWatchedAt,
      lastWatchedAt: stat.lastWatchedAt,
    }));
    await fs.promises.writeFile(
      path.join(jsonDir, "lifetime-stats.json"),
      JSON.stringify(lifetimeStats, null, 2)
    );

    // privacy-settings.json - 隱私設定
    if (data.viewer.privacyConsent) {
      const privacySettings = {
        consentVersion: data.viewer.privacyConsent.consentVersion,
        consentGivenAt: data.viewer.privacyConsent.consentGivenAt,
        collectDailyWatchTime: data.viewer.privacyConsent.collectDailyWatchTime,
        collectWatchTimeDistribution: data.viewer.privacyConsent.collectWatchTimeDistribution,
        collectMonthlyAggregates: data.viewer.privacyConsent.collectMonthlyAggregates,
        collectChatMessages: data.viewer.privacyConsent.collectChatMessages,
        collectInteractions: data.viewer.privacyConsent.collectInteractions,
        collectInteractionFrequency: data.viewer.privacyConsent.collectInteractionFrequency,
        collectBadgeProgress: data.viewer.privacyConsent.collectBadgeProgress,
        collectFootprintData: data.viewer.privacyConsent.collectFootprintData,
        collectRankings: data.viewer.privacyConsent.collectRankings,
        collectRadarAnalysis: data.viewer.privacyConsent.collectRadarAnalysis,
        updatedAt: data.viewer.privacyConsent.updatedAt,
      };
      await fs.promises.writeFile(
        path.join(jsonDir, "privacy-settings.json"),
        JSON.stringify(privacySettings, null, 2)
      );
    }
  }

  /**
   * 生成 CSV 檔案
   */
  private async generateCsvFiles(
    exportDir: string,
    data: {
      dailyStats: ExportDailyStat[];
      messageAggs: ExportMessageAgg[];
    }
  ): Promise<void> {
    const csvDir = path.join(exportDir, "csv");

    // watch-time-daily.csv
    const watchTimeCsv = [
      "日期,頻道,觀看秒數,觀看分鐘,留言數,表情數",
      ...data.dailyStats.map(
        (stat) =>
          `${stat.date.toISOString().split("T")[0]},${
            stat.channel?.channelName || ""
          },${stat.watchSeconds},${Math.round(stat.watchSeconds / 60)},${
            stat.messageCount
          },${stat.emoteCount}`
      ),
    ].join("\n");
    await fs.promises.writeFile(
      path.join(csvDir, "watch-time-daily.csv"),
      "\ufeff" + watchTimeCsv
    ); // BOM for Excel

    // messages-daily.csv
    const messagesCsv = [
      "日期,頻道,總留言數,聊天訊息,訂閱,Cheer,禮物訂閱,Raid,Bits數",
      ...data.messageAggs.map(
        (agg) =>
          `${agg.date.toISOString().split("T")[0]},${
            agg.channel?.channelName || ""
          },${agg.totalMessages},${agg.chatMessages},${agg.subscriptions},${
            agg.cheers
          },${agg.giftSubs},${agg.raids},${agg.totalBits || 0}`
      ),
    ].join("\n");
    await fs.promises.writeFile(path.join(csvDir, "messages-daily.csv"), "\ufeff" + messagesCsv);
  }

  /**
   * 生成 README 說明檔
   */
  private async generateReadme(exportDir: string): Promise<void> {
    const readme = `# Twitch Analytics 個人資料匯出

本壓縮包包含您在 Twitch Analytics 平台上的所有個人資料。

## 檔案說明

### json/ 目錄
- profile.json - 您的基本資料
- watch-time-stats.json - 觀看時數記錄
- message-stats.json - 留言與互動統計
- lifetime-stats.json - 全時段統計聚合
- privacy-settings.json - 您的隱私設定

### csv/ 目錄
- watch-time-daily.csv - 每日觀看時數（可用 Excel 開啟）
- messages-daily.csv - 每日留言統計（可用 Excel 開啟）

## 資料使用說明

這些資料是根據 GDPR 及相關隱私法規的「資料可攜權」條款提供給您的。
您可以自由使用這些資料，或將其匯入其他服務。

## 問題回報

如有任何問題，請聯繫我們的支援團隊。

匯出時間: ${new Date().toISOString()}
`;
    await fs.promises.writeFile(path.join(exportDir, "README.txt"), readme);
  }

  /**
   * 建立 ZIP 壓縮檔
   */
  private createZipArchive(sourceDir: string, zipPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const output = fs.createWriteStream(zipPath);
      const archive = archiver("zip", { zlib: { level: 9 } });

      output.on("close", () => resolve());
      archive.on("error", (err) => reject(err));

      archive.pipe(output);
      archive.directory(sourceDir, false);
      archive.finalize();
    });
  }

  /**
   * 獲取匯出任務狀態
   */
  async getExportJob(jobId: string): Promise<ExportJob | null> {
    return prisma.exportJob.findUnique({
      where: { id: jobId },
    });
  }

  /**
   * 獲取觀眾最近的匯出任務
   */
  async getRecentExportJobs(viewerId: string): Promise<ExportJob[]> {
    return prisma.exportJob.findMany({
      where: { viewerId },
      orderBy: { createdAt: "desc" },
      take: 5,
    });
  }

  /**
   * 清理過期的匯出檔案
   */
  async cleanupExpiredExports(): Promise<number> {
    const now = new Date();

    // 找到所有過期的匯出任務
    const expiredJobs = await prisma.exportJob.findMany({
      where: {
        status: "completed",
        expiresAt: { lte: now },
        downloadPath: { not: null },
      },
    });

    let cleaned = 0;

    for (const job of expiredJobs) {
      if (job.downloadPath) {
        const exists = await pathExists(job.downloadPath);
        if (exists) {
          try {
            await fs.promises.unlink(job.downloadPath);
            cleaned++;
          } catch (error) {
            logger.error("DataExport", `清理匯出檔案失敗: ${job.downloadPath}`, error);
          }
        }
      }

      // 更新任務狀態
      await prisma.exportJob.update({
        where: { id: job.id },
        data: {
          downloadPath: null,
          status: "expired",
        },
      });
    }

    if (cleaned > 0) {
      logger.info("DataExport", `已清理 ${cleaned} 個過期的匯出檔案`);
    }

    return cleaned;
  }
}

// 匯出單例
export const dataExportService = new DataExportService();
