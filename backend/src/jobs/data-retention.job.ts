/**
 * Data Retention Job
 * 執行分級保留政策與過期刪除
 *
 * Story 2.5: 觀眾隱私與授權控制
 */

import { Prisma } from "@prisma/client";
import cron from "node-cron";

import { accountDeletionService } from "../services/account-deletion.service";
import { dataExportService } from "../services/data-export.service";
import { prisma } from "../db/prisma";
import { logger } from "../utils/logger";
import { runWithWriteGuard } from "./job-write-guard";
import { buildStreamMetricDownsampleSql } from "./stream-metric-retention";
import { WriteGuardKeys } from "../constants";

const DAY_MS = 24 * 60 * 60 * 1000;

function readPositiveIntEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return Math.floor(parsed);
}

// 每日凌晨 3 點執行
const DATA_RETENTION_CRON = process.env.DATA_RETENTION_CRON_EXPRESSION || "0 3 * * *";
const DATA_RETENTION_MESSAGE_DELETE_BATCH_SIZE = readPositiveIntEnv(
  "DATA_RETENTION_MESSAGE_DELETE_BATCH_SIZE",
  3000
);
// stream_metrics 保留 10 分鐘原始採樣的天數，更舊的合併為每場每小時一筆
const STREAM_METRIC_RAW_RETENTION_DAYS = readPositiveIntEnv("STREAM_METRIC_RAW_RETENTION_DAYS", 30);
// 每批合併的「場次 × 小時」區段數
const STREAM_METRIC_DOWNSAMPLE_BATCH_SIZE = readPositiveIntEnv(
  "STREAM_METRIC_DOWNSAMPLE_BATCH_SIZE",
  2000
);

export class DataRetentionJob {
  private isRunning = false;
  private readonly MESSAGE_DELETE_BATCH_SIZE = DATA_RETENTION_MESSAGE_DELETE_BATCH_SIZE;
  private readonly BATCH_DELAY_MS = 200;

  private async batchDownsampleStreamMetrics(before: Date): Promise<number> {
    let totalMerged = 0;

    while (true) {
      const merged = await runWithWriteGuard(WriteGuardKeys.DATA_RETENTION_DOWNSAMPLE_METRICS, () =>
        prisma.$executeRaw(
          buildStreamMetricDownsampleSql(before, STREAM_METRIC_DOWNSAMPLE_BATCH_SIZE)
        )
      );

      totalMerged += merged;

      if (merged < STREAM_METRIC_DOWNSAMPLE_BATCH_SIZE) {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, this.BATCH_DELAY_MS));
    }

    return totalMerged;
  }

  private async batchDeleteViewerMessages(before: Date): Promise<number> {
    let totalDeleted = 0;

    while (true) {
      const deleted = await runWithWriteGuard(WriteGuardKeys.DATA_RETENTION_DELETE, () =>
        prisma.$executeRaw(
          Prisma.sql`
            DELETE FROM viewer_channel_messages
            WHERE id IN (
              SELECT id FROM viewer_channel_messages
              WHERE timestamp < ${before}
              ORDER BY timestamp ASC
              LIMIT ${this.MESSAGE_DELETE_BATCH_SIZE}
            )
          `
        )
      );

      if (deleted === 0) {
        break;
      }

      totalDeleted += deleted;

      if (deleted < this.MESSAGE_DELETE_BATCH_SIZE) {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, this.BATCH_DELAY_MS));
    }

    return totalDeleted;
  }

  /**
   * 啟動 Cron Job
   */
  start(): void {
    logger.info(
      "DataRetention",
      `Job 已排程: ${DATA_RETENTION_CRON} (messageDeleteBatchSize=${this.MESSAGE_DELETE_BATCH_SIZE})`
    );

    cron.schedule(DATA_RETENTION_CRON, async () => {
      await this.execute();
    });
  }

  /**
   * 執行資料保留任務
   */
  async execute(): Promise<void> {
    if (this.isRunning) {
      logger.warn("DataRetention", "Job 正在執行中，跳過...");
      return;
    }

    this.isRunning = true;
    logger.info("DataRetention", "開始執行資料保留任務...");

    try {
      // 1. 執行到期的帳號刪除請求
      logger.info("DataRetention", "檢查到期的刪除請求...");
      const deletionResult = await accountDeletionService.executeExpiredDeletions();
      logger.info(
        "DataRetention",
        `處理了 ${deletionResult.processed} 個刪除請求 (成功: ${deletionResult.success}, 失敗: ${deletionResult.failed})`
      );

      // 2. 清理過期的匯出檔案
      logger.info("DataRetention", "清理過期的匯出檔案...");
      const cleanedExports = await dataExportService.cleanupExpiredExports();
      logger.info("DataRetention", `清理了 ${cleanedExports} 個過期匯出檔案`);

      // 3. 清理過期聊天室訊息（保留 90 天，使用分批刪除避免鎖表）
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      const deletedViewerMessageCount = await this.batchDeleteViewerMessages(ninetyDaysAgo);

      logger.info(
        "DataRetention",
        `清理了 ${deletedViewerMessageCount} 則過期訊息`
      );

      // 4. stream_metrics 超過保留天數的合併為每場每小時一筆
      const metricCutoff = new Date(Date.now() - STREAM_METRIC_RAW_RETENTION_DAYS * DAY_MS);
      const mergedMetricHours = await this.batchDownsampleStreamMetrics(metricCutoff);
      logger.info(
        "DataRetention",
        `stream_metrics 降採樣：合併了 ${mergedMetricHours} 個小時區段（${STREAM_METRIC_RAW_RETENTION_DAYS} 天前）`
      );

      logger.info("DataRetention", "Job 執行完成");
    } catch (error) {
      logger.error("DataRetention", "Job 執行失敗:", error);
    } finally {
      this.isRunning = false;
    }
  }
}

// 匯出單例
export const dataRetentionJob = new DataRetentionJob();
