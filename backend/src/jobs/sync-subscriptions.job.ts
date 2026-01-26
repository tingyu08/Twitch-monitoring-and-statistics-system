import cron from "node-cron";
import { prisma } from "../db/prisma";
import { revenueService } from "../modules/streamer/revenue.service";
import { logger } from "../utils/logger";

// 每個實況主的超時時間（毫秒）- 60 秒
const PER_STREAMER_TIMEOUT_MS = 60 * 1000;

/**
 * Sync Subscriptions Job
 * 每日同步訂閱快照
 * 頻率: 每天 UTC 00:00 (台灣時間 08:00)
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

    let successCount = 0;
    let failCount = 0;

    for (const streamer of streamers) {
      try {
        // 使用 Promise.race 實現單個實況主的超時保護
        await Promise.race([
          revenueService.syncSubscriptionSnapshot(streamer.id),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error(`Timeout after ${PER_STREAMER_TIMEOUT_MS / 1000}s`)),
              PER_STREAMER_TIMEOUT_MS
            )
          ),
        ]);
        successCount++;
        logger.debug("Jobs", `Synced subscription snapshot for ${streamer.displayName}`);
      } catch (error) {
        failCount++;
        logger.error("Jobs", `Failed to sync subscriptions for ${streamer.displayName}`, error);
      }

      // 簡單延遲防止 Rate Limit
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    logger.info(
      "Jobs",
      `Sync Subscriptions Job completed. Success: ${successCount}, Failed: ${failCount}`
    );
  } catch (error) {
    logger.error("Jobs", "Sync Subscriptions Job failed", error);
  }
});
