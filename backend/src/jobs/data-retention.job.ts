/**
 * Data Retention Job
 * 執行分級保留政策與過期刪除
 *
 * Story 2.5: 觀眾隱私與授權控制
 */

import cron from "node-cron";
import { accountDeletionService } from "../services/account-deletion.service";
import { dataExportService } from "../services/data-export.service";

// 每日凌晨 3 點執行
const DATA_RETENTION_CRON =
  process.env.DATA_RETENTION_CRON_EXPRESSION || "0 3 * * *";

export class DataRetentionJob {
  private isRunning = false;

  /**
   * 啟動 Cron Job
   */
  start(): void {
    console.log(`📅 Data Retention Job 已排程: ${DATA_RETENTION_CRON}`);

    cron.schedule(DATA_RETENTION_CRON, async () => {
      await this.execute();
    });
  }

  /**
   * 執行資料保留任務
   */
  async execute(): Promise<void> {
    if (this.isRunning) {
      console.log("⚠️ Data Retention Job 正在執行中，跳過...");
      return;
    }

    this.isRunning = true;
    console.log("🗑️ 開始執行 Data Retention Job...");

    try {
      // 1. 執行到期的帳號刪除請求
      console.log("📋 檢查到期的刪除請求...");
      const deletionResult =
        await accountDeletionService.executeExpiredDeletions();
      console.log(
        `   處理了 ${deletionResult.processed} 個刪除請求 (成功: ${deletionResult.success}, 失敗: ${deletionResult.failed})`
      );

      // 2. 清理過期的匯出檔案
      console.log("📋 清理過期的匯出檔案...");
      const cleanedExports = await dataExportService.cleanupExpiredExports();
      console.log(`   清理了 ${cleanedExports} 個過期匯出檔案`);

      console.log("✅ Data Retention Job 執行完成");
    } catch (error) {
      console.error("❌ Data Retention Job 執行失敗:", error);
    } finally {
      this.isRunning = false;
    }
  }
}

// 匯出單例
export const dataRetentionJob = new DataRetentionJob();
