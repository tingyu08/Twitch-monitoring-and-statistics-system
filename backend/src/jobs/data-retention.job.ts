/**
 * Data Retention Job
 * 執行分級保留政策與過期刪除
 *
 * Story 2.5: 觀眾隱私與授權控制
 */

import cron from "node-cron";
import { accountDeletionService } from "../services/account-deletion.service";
import { dataExportService } from "../services/data-export.service";
import { prisma } from "../db/prisma";
import { logger } from "../utils/logger";
import { captureJobError } from "./job-error-tracker";

// 每日凌晨 3 點執行
const DATA_RETENTION_CRON = process.env.DATA_RETENTION_CRON_EXPRESSION || "0 3 * * *";

export class DataRetentionJob {
  private isRunning = false;

  /**
   * 啟動 Cron Job
   */
  start(): void {
    logger.info("DataRetention", `Job 已排程: ${DATA_RETENTION_CRON}`);

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

      // 3. 清理過期的影片與剪輯 (7天)
      logger.info("DataRetention", "清理過期的 VOD 與 Clip...");
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const deletedVideos = await prisma.video.deleteMany({
        where: { createdAt: { lt: sevenDaysAgo } },
      });
      const deletedClips = await prisma.clip.deleteMany({
        where: { createdAt: { lt: sevenDaysAgo } },
      });

      // 4. 清理過期聊天室訊息（保留 90 天）
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      const deletedViewerMessages = await prisma.viewerChannelMessage.deleteMany({
        where: { timestamp: { lt: ninetyDaysAgo } },
      });

      logger.info(
        "DataRetention",
        `清理了 ${deletedVideos.count} 個影片, ${deletedClips.count} 個剪輯, ${deletedViewerMessages.count} 則訊息`
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
