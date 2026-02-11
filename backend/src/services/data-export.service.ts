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
import { once } from "events";
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
  queued?: boolean;
}

// 匯出資料類型定義
interface ExportViewerData {
  id: string;
  twitchUserId: string;
  displayName: string | null;
  createdAt: Date;
  updatedAt: Date;
  privacyConsent: {
    consentVersion: string;
    consentGivenAt: Date;
    collectDailyWatchTime: boolean;
    collectWatchTimeDistribution: boolean;
    collectMonthlyAggregates: boolean;
    collectChatMessages: boolean;
    collectInteractions: boolean;
    collectInteractionFrequency: boolean;
    collectBadgeProgress: boolean;
    collectFootprintData: boolean;
    collectRankings: boolean;
    collectRadarAnalysis: boolean;
    updatedAt: Date;
  } | null;
}

interface ExportLifetimeStat {
  totalWatchTimeMinutes: number;
  totalSessions: number;
  totalMessages: number;
  totalChatMessages: number;
  totalSubscriptions: number;
  totalCheers: number;
  totalBits: number;
  trackingDays: number;
  longestStreakDays: number;
  firstWatchedAt: Date | null;
  lastWatchedAt: Date | null;
  channel: { channelName: string } | null;
}

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
   * 只建立任務，實際處理交給 queue worker
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

    const existingJob = await prisma.exportJob.findFirst({
      where: {
        viewerId,
        status: { in: ["processing", "completed"] },
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });

    if (existingJob) {
      return {
        success: true,
        message: "已有可用的匯出任務",
        job: existingJob,
        queued: false,
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

    return {
      success: true,
      message: "資料匯出任務已建立",
      job,
      queued: true,
    };
  }

  async processExportJob(jobId: string): Promise<void> {
    const job = await prisma.exportJob.findUnique({ where: { id: jobId } });

    if (!job) {
      logger.warn("DataExport", `Job not found: ${jobId}`);
      return;
    }

    if (job.status === "completed" || job.status === "expired") {
      return;
    }

    try {
      const downloadPath = await this.generateExport(job.viewerId, job.id);

      await prisma.exportJob.update({
        where: { id: job.id },
        data: {
          status: "completed",
          downloadPath,
          errorMessage: null,
        },
      });

      await prisma.privacyAuditLog.create({
        data: {
          viewerId: job.viewerId,
          action: "data_exported",
          details: JSON.stringify({
            jobId: job.id,
            expiresAt: job.expiresAt.toISOString(),
          }),
        },
      });
    } catch (error) {
      await prisma.exportJob.update({
        where: { id: job.id },
        data: {
          status: "failed",
          errorMessage: error instanceof Error ? error.message : "未知錯誤",
        },
      });

      throw error;
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

      const lifetimeStats = await prisma.viewerChannelLifetimeStats.findMany({
        where: { viewerId },
        include: { channel: true },
      });

      // 生成 JSON 檔案
      await this.generateJsonFiles(exportDir, {
        viewer,
        lifetimeStats,
      });

      await this.generateDailyStatsFiles(exportDir, viewerId);
      await this.generateMessageAggFiles(exportDir, viewerId);

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

  private async writeLine(stream: fs.WriteStream, content: string): Promise<void> {
    if (stream.write(content)) {
      return;
    }
    await once(stream, "drain");
  }

  private async generateDailyStatsFiles(exportDir: string, viewerId: string): Promise<void> {
    const jsonPath = path.join(exportDir, "json", "watch-time-stats.json");
    const csvPath = path.join(exportDir, "csv", "watch-time-daily.csv");
    const jsonStream = fs.createWriteStream(jsonPath, { encoding: "utf8" });
    const csvStream = fs.createWriteStream(csvPath, { encoding: "utf8" });

    await this.writeLine(jsonStream, "[\n");
    await this.writeLine(csvStream, "\ufeff日期,頻道,觀看秒數,觀看分鐘,留言數,表情數\n");

    let isFirst = true;
    let cursorId: string | undefined;

    while (true) {
      const batch = await prisma.viewerChannelDailyStat.findMany({
        where: { viewerId },
        include: { channel: true },
        orderBy: { id: "asc" },
        take: 200,
        ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
      });

      if (batch.length === 0) break;

      for (const stat of batch) {
        const jsonRow = {
          date: stat.date,
          channelName: stat.channel?.channelName,
          watchSeconds: stat.watchSeconds,
          messageCount: stat.messageCount,
          emoteCount: stat.emoteCount,
        };

        await this.writeLine(
          jsonStream,
          `${isFirst ? "" : ",\n"}${JSON.stringify(jsonRow, null, 2)}`
        );
        isFirst = false;

        await this.writeLine(
          csvStream,
          `${stat.date.toISOString().split("T")[0]},${stat.channel?.channelName || ""},${
            stat.watchSeconds
          },${Math.round(stat.watchSeconds / 60)},${stat.messageCount},${stat.emoteCount}\n`
        );
      }

      cursorId = batch[batch.length - 1].id;
    }

    await this.writeLine(jsonStream, "\n]");
    await new Promise<void>((resolve) => jsonStream.end(resolve));
    await new Promise<void>((resolve) => csvStream.end(resolve));
  }

  private async generateMessageAggFiles(exportDir: string, viewerId: string): Promise<void> {
    const jsonPath = path.join(exportDir, "json", "message-stats.json");
    const csvPath = path.join(exportDir, "csv", "messages-daily.csv");
    const jsonStream = fs.createWriteStream(jsonPath, { encoding: "utf8" });
    const csvStream = fs.createWriteStream(csvPath, { encoding: "utf8" });

    await this.writeLine(jsonStream, "[\n");
    await this.writeLine(csvStream, "\ufeff日期,頻道,總留言數,聊天訊息,訂閱,Cheer,禮物訂閱,Raid,Bits數\n");

    let isFirst = true;
    let cursorId: string | undefined;

    while (true) {
      const batch = await prisma.viewerChannelMessageDailyAgg.findMany({
        where: { viewerId },
        include: { channel: true },
        orderBy: { id: "asc" },
        take: 200,
        ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
      });

      if (batch.length === 0) break;

      for (const agg of batch) {
        const jsonRow = {
          date: agg.date,
          channelName: agg.channel?.channelName,
          totalMessages: agg.totalMessages,
          chatMessages: agg.chatMessages,
          subscriptions: agg.subscriptions,
          cheers: agg.cheers,
          giftSubs: agg.giftSubs,
          raids: agg.raids,
          totalBits: agg.totalBits,
        };

        await this.writeLine(
          jsonStream,
          `${isFirst ? "" : ",\n"}${JSON.stringify(jsonRow, null, 2)}`
        );
        isFirst = false;

        await this.writeLine(
          csvStream,
          `${agg.date.toISOString().split("T")[0]},${agg.channel?.channelName || ""},${
            agg.totalMessages
          },${agg.chatMessages},${agg.subscriptions},${agg.cheers},${agg.giftSubs},${agg.raids},${
            agg.totalBits || 0
          }\n`
        );
      }

      cursorId = batch[batch.length - 1].id;
    }

    await this.writeLine(jsonStream, "\n]");
    await new Promise<void>((resolve) => jsonStream.end(resolve));
    await new Promise<void>((resolve) => csvStream.end(resolve));
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
