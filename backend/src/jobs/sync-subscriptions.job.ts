import cron from "node-cron";
import { prisma } from "../db/prisma";
import { revenueService } from "../modules/streamer/revenue.service";
import { logger } from "../utils/logger";
import { revenueSyncQueue, type RevenueSyncJobData } from "../utils/memory-queue";

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

  logger.debug("Jobs", `Synced subscription snapshot for ${streamerName || streamerId}`);
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
export const syncSubscriptionsJob = cron.schedule("0 0 * * *", async () => {
  logger.info("Jobs", "Starting Sync Subscriptions Job...");

  try {
    // 獲取所有有效 Token 的實況主
    const streamers = await prisma.streamer.findMany({
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
    });

    let addedCount = 0;
    let rejectedCount = 0;

    // 將所有實況主加入佇列
    for (const streamer of streamers) {
      const jobId = revenueSyncQueue.add({
        streamerId: streamer.id,
        streamerName: streamer.displayName,
      });

      if (jobId) {
        addedCount++;
      } else {
        rejectedCount++;
        logger.warn("Jobs", `Failed to add sync job for ${streamer.displayName} - queue full`);
      }
    }

    const status = revenueSyncQueue.getStatus();
    logger.info(
      "Jobs",
      `Sync Subscriptions Job: Added ${addedCount} jobs to queue, ${rejectedCount} rejected. ` +
        `Queue status: ${status.queued} queued, ${status.processing} processing`
    );
  } catch (error) {
    logger.error("Jobs", "Sync Subscriptions Job failed", error);
  }
});
