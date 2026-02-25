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
import { captureJobError } from "./job-error-tracker";
import { runWithWriteGuard } from "./job-write-guard";
import { WriteGuardKeys } from "../constants";

// 每日凌晨 3 點執行
const DATA_RETENTION_CRON = process.env.DATA_RETENTION_CRON_EXPRESSION || "0 3 * * *";
const DEFAULT_MESSAGE_DELETE_BATCH_SIZE = 3000;
const DATA_RETENTION_MESSAGE_DELETE_BATCH_SIZE = (() => {
  const parsed = Number(process.env.DATA_RETENTION_MESSAGE_DELETE_BATCH_SIZE);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_MESSAGE_DELETE_BATCH_SIZE;
  }
  return Math.floor(parsed);
})();

export class DataRetentionJob {
  private isRunning = false;
  private readonly MESSAGE_DELETE_BATCH_SIZE = DATA_RETENTION_MESSAGE_DELETE_BATCH_SIZE;
  private readonly MESSAGE_DELETE_BATCH_DELAY_MS = 200;

  private async batchDeleteViewerMessages(before: Date): Promise<number> {
    let totalDeleted = 0;

    while (true) {
      const deleted = await runWithWriteGuard(WriteGuardKeys.DATA_RETENTION_DELETE, () =>
        prisma.$executeRaw(
          Prisma.sql`
            DELETE FROM viewer_channel_messages
            WHERE rowid IN (
              SELECT rowid FROM viewer_channel_messages
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

      await new Promise((resolve) => setTimeout(resolve, this.MESSAGE_DELETE_BATCH_DELAY_MS));
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

      logger.info("DataRetention", "Job 執行完成");
    } catch (error) {
      logger.error("DataRetention", "Job 執行失敗:", error);
      captureJobError("data-retention", error);
    } finally {
      this.isRunning = false;
    }
  }
}

// 匯出單例
export const dataRetentionJob = new DataRetentionJob();
