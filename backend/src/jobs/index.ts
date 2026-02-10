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
import { syncVideosJob } from "./sync-videos.job";
import { syncSubscriptionsJob } from "./sync-subscriptions.job";
import { updateLiveStatusJob } from "./update-live-status.job";
import { logger } from "../utils/logger";
import { MEMORY_THRESHOLDS } from "../utils/memory-thresholds";
import { captureJobError } from "./job-error-tracker";

const CHANNEL_STATS_START_RETRY_MS = 5 * 60 * 1000;
const CHANNEL_STATS_MAX_DELAYED_START_ATTEMPTS = 6;

function startChannelStatsSyncWithMemoryGuard(attempt: number = 1): void {
  const heapUsedMB = process.memoryUsage().heapUsed / 1024 / 1024;
  const canStartNow = !global.gc || heapUsedMB < MEMORY_THRESHOLDS.CRITICAL_MB;

  if (canStartNow || attempt >= CHANNEL_STATS_MAX_DELAYED_START_ATTEMPTS) {
    if (!canStartNow) {
      logger.warn(
        "Jobs",
        `記憶體持續偏高 (${heapUsedMB.toFixed(1)}MB)，已達延遲上限，強制啟動 Channel Stats Sync Job`
      );
    }
    channelStatsSyncJob.start();
    return;
  }

  logger.warn(
    "Jobs",
    `記憶體偏高 (${heapUsedMB.toFixed(1)}MB)，第 ${attempt}/${CHANNEL_STATS_MAX_DELAYED_START_ATTEMPTS} 次延遲啟動 Channel Stats Sync Job`
  );

  setTimeout(() => {
    startChannelStatsSyncWithMemoryGuard(attempt + 1);
  }, CHANNEL_STATS_START_RETRY_MS);
}

/**
 * 啟動所有定時任務（Zeabur 免費層優化版）
 */
export function startAllJobs(): void {
  logger.info("Jobs", "正在啟動定時任務（分階段啟動以減少記憶體壓力）...");

  // === 階段 1: 立即啟動核心任務 ===

  // Story 3.3: 開播狀態輪詢任務（核心功能）
  streamStatusJob.start();

  // 優化: 即時直播狀態更新任務（核心功能）
  updateLiveStatusJob.start();

  // Token 驗證任務 - 每天凌晨 4 點執行（低流量時段）
  cron.schedule("0 4 * * *", async () => {
    logger.info("Jobs", "開始執行 Token 驗證任務...");
    try {
      const result = await validateTokensJob();
      logger.info("Jobs", `Token 驗證完成: ${result.stats.valid}/${result.stats.total} 有效`);
    } catch (error) {
      logger.error("Jobs", "Token 驗證失敗:", error);
      captureJobError("validate-tokens-scheduler", error);
    }
  });

  // === 階段 2: 延遲 5 分鐘後啟動次要任務 ===
  setTimeout(
    () => {
      logger.info("Jobs", "啟動次要任務...");

      // 訊息聚合任務
      startMessageAggregationJob();

      // 全時段統計聚合任務
      updateLifetimeStatsJob();

      // Story 3.3: 頻道統計同步任務 (耗資源)
      startChannelStatsSyncWithMemoryGuard();
    },
    5 * 60 * 1000
  ); // 延長到 5 分鐘

  // === 階段 3: 延遲 10 分鐘後啟動低優先級任務 ===
  setTimeout(
    () => {
      logger.info("Jobs", "啟動低優先級任務...");

      // Story 2.5: 資料保留與刪除任務
      dataRetentionJob.start();

      // Story 3.6: 使用者追蹤同步任務
      syncUserFollowsJob.start();

      // Story 6.4: VOD 與剪輯同步任務
      syncVideosJob.start();

      // Epic 4: 訂閱快照同步任務
      syncSubscriptionsJob.start();
    },
    10 * 60 * 1000
  ); // 延長到 10 分鐘

  logger.info("Jobs", "核心定時任務已啟動（其他任務將在背景分階段啟動）");
}

/**
 * 停止所有定時任務（用於優雅關閉）
 */
export function stopAllJobs(): void {
  logger.info("Jobs", "正在停止所有定時任務...");
  // node-cron 任務會在程序結束時自動停止
  // 如果需要手動控制，可以保存 cron.schedule 返回的 task 並調用 task.stop()
}
