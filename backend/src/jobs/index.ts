/**
 * Job Scheduler - 統一管理所有定時任務
 */

import { startMessageAggregationJob } from "./aggregate-daily-messages.job";

/**
 * 啟動所有定時任務
 */
export function startAllJobs(): void {
  console.log("🚀 [Jobs] 正在啟動所有定時任務...");

  // 訊息聚合任務
  startMessageAggregationJob();

  // 全時段統計聚合任務
  const { updateLifetimeStatsJob } = require("./update-lifetime-stats.job");
  updateLifetimeStatsJob();

  // Story 2.5: 資料保留與刪除任務
  const { dataRetentionJob } = require("./data-retention.job");
  dataRetentionJob.start();

  // 未來可以在這裡添加更多任務
  // startTokenRefreshJob();
  // startStreamerStatusCheckJob();

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
