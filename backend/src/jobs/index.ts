/**
 * Job Scheduler - 統一管理所有定時任務
 */

import cron from "node-cron";
import { startMessageAggregationJob } from "./aggregate-daily-messages.job";
import { updateLifetimeStatsJob } from "./update-lifetime-stats.job";
import { dataRetentionJob } from "./data-retention.job";
import { streamStatusJob } from "./stream-status.job";
import { channelStatsSyncJob } from "./channel-stats-sync.job";
import { syncUserFollowsJob } from "./sync-user-follows.job";
import { validateTokensJob } from "./validate-tokens.job";

/**
 * 啟動所有定時任務
 */
export function startAllJobs(): void {
  console.log("🚀 [Jobs] 正在啟動所有定時任務...");

  // 訊息聚合任務
  startMessageAggregationJob();

  // 全時段統計聚合任務
  updateLifetimeStatsJob();

  // Story 2.5: 資料保留與刪除任務
  dataRetentionJob.start();

  // Story 3.3: 開播狀態輪詢任務
  streamStatusJob.start();

  // Story 3.3: 頻道統計同步任務
  channelStatsSyncJob.start();

  // Story 3.6: 使用者追蹤同步任務
  syncUserFollowsJob.start();

  // Token 驗證任務 - 每天凌晨 4 點執行（低流量時段）
  cron.schedule("0 4 * * *", async () => {
    console.log("🔐 [Jobs] 開始執行 Token 驗證任務...");
    try {
      const result = await validateTokensJob();
      console.log(
        `✅ [Jobs] Token 驗證完成: ${result.stats.valid}/${result.stats.total} 有效`
      );
    } catch (error) {
      console.error("❌ [Jobs] Token 驗證失敗:", error);
    }
  });

  console.log("✅ [Jobs] 所有定時任務已啟動");
}

/**
 * 停止所有定時任務（用於優雅關閉）
 */
export function stopAllJobs(): void {
  console.log("🛑 [Jobs] 正在停止所有定時任務...");
  // node-cron 任務會在程序結束時自動停止
  // 如果需要手動控制，可以保存 cron.schedule 返回的 task 並調用 task.stop()
}
