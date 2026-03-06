import cron from "node-cron";
import { prisma } from "../db/prisma";
import { revenueService } from "../modules/streamer/revenue.service";
import { logger } from "../utils/logger";
import { revenueSyncQueue, type RevenueSyncJobData } from "../utils/revenue-sync-queue";
import { retryDatabaseOperation } from "../utils/db-retry";
import {
  recordJobFailure,
  recordJobSuccess,
  shouldSkipForCircuitBreaker,
} from "../utils/job-circuit-breaker";

// 每個實況主的超時時間（毫秒）- 60 秒
const PER_STREAMER_TIMEOUT_MS = 60 * 1000;

/**
 * 初始化佇列處理器
 * 使用 MemoryQueue 進行併發控制和重試
 */
revenueSyncQueue.process(async (data: RevenueSyncJobData) => {
  const { streamerId, streamerName } = data;

  // 使用 Promise.race 實現超時保護
  await Promise.race([
    revenueService.syncSubscriptionSnapshot(streamerId),
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`Timeout after ${PER_STREAMER_TIMEOUT_MS / 1000}s`)),
        PER_STREAMER_TIMEOUT_MS
      )
    ),
  ]);

  await revenueService.prewarmRevenueCache(streamerId);

  logger.debug("Jobs", `已同步 ${streamerName || streamerId} 的訂閱快照`);
});

/**
 * Sync Subscriptions Job
 * 每日同步訂閱快照
 * 頻率: 每天 UTC 00:00 (台灣時間 08:00)
 *
 * 使用 MemoryQueue 實現：
 * - 併發控制（預設 2 個同時處理）
 * - 重試機制（預設最多重試 2 次）
 * - 優先級排序
 */
const SYNC_SUBSCRIPTIONS_CRON = process.env.SYNC_SUBSCRIPTIONS_CRON || "20 0 * * *";
const CRON_JITTER_MAX_MS = Number.parseInt(
  process.env.SYNC_SUBSCRIPTIONS_CRON_JITTER_MAX_MS || "8000",
  10
);
const JOB_CIRCUIT_BREAKER_NAME = "sync-subscriptions";

export const syncSubscriptionsJob = cron.schedule(SYNC_SUBSCRIPTIONS_CRON, async () => {
  if (CRON_JITTER_MAX_MS > 0) {
    const jitterMs = Math.floor(Math.random() * CRON_JITTER_MAX_MS);
    if (jitterMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, jitterMs));
    }
  }

  if (shouldSkipForCircuitBreaker(JOB_CIRCUIT_BREAKER_NAME)) {
    logger.warn("Jobs", "Sync Subscriptions Job 暫停中（circuit breaker），跳過本輪");
    return;
  }

  logger.info("Jobs", "開始執行 Sync Subscriptions Job...");

  try {
    // 獲取所有有效 Token 的實況主
    const streamers = await retryDatabaseOperation(() =>
      prisma.streamer.findMany({
        where: {
          twitchTokens: {
            some: {
              ownerType: "streamer",
              status: "active",
            },
          },
        },
        select: {
          id: true,
          displayName: true,
        },
      })
    );

    let addedCount = 0;
    let rejectedCount = 0;

    // 將所有實況主加入佇列
    for (const streamer of streamers) {
      const jobId = await revenueSyncQueue.add({
        streamerId: streamer.id,
        streamerName: streamer.displayName,
      });

      if (jobId) {
        addedCount++;
      } else {
        rejectedCount++;
        logger.warn("Jobs", `無法加入 ${streamer.displayName} 的同步任務 - 佇列已滿`);
      }
    }

    const status = await revenueSyncQueue.getStatus();
    logger.info(
      "Jobs",
      `Sync Subscriptions Job: 已加入 ${addedCount} 個任務到佇列, ${rejectedCount} 個被拒絕。` +
        `佇列狀態: ${status.queued} 排隊中, ${status.processing} 處理中, ` +
        `overflow 已持久化 ${status.overflowPersisted} / 回補 ${status.overflowRecovered}`
    );
    recordJobSuccess(JOB_CIRCUIT_BREAKER_NAME);
  } catch (error) {
    logger.error("Jobs", "Sync Subscriptions Job 執行失敗", error);
    recordJobFailure(JOB_CIRCUIT_BREAKER_NAME, error);
  }
});
