import cron from "node-cron";
import { prisma } from "../db/prisma";
import { twurpleVideoService } from "../services/twitch-video.service";
import { logger } from "../utils/logger";

/**
 * Sync Videos & Clips Job (記憶體優化版)
 * 頻率: 每 6 小時一次 ('0 0 *\/6 * * *')
 *
 * 優化重點：
 * - 分批處理，避免一次載入所有實況主資料
 * - 批次之間強制 GC 和休息
 * - 記憶體超限時提前中斷
 */

// Render Free Tier 優化：平衡性能與記憶體
const BATCH_SIZE = 20;           // 每批處理 20 個實況主（平衡性能與記憶體）
const BATCH_DELAY_MS = 1500;     // 批次之間休息 1.5 秒（讓 GC 有時間清理）
const STREAMER_DELAY_MS = 300;   // 每個實況主之間休息 300ms
const MAX_MEMORY_MB = 400;       // 記憶體警戒線 400MB（預留 112MB 緩衝）

export const syncVideosJob = cron.schedule("0 0 */6 * * *", async () => {
  logger.info("Jobs", "開始執行 Sync Videos Job (記憶體優化版)...");

  const startTime = Date.now();
  let totalProcessed = 0;
  let totalSkipped = 0;

  try {
    // 只取得 ID 和基本資訊，減少記憶體佔用
    const streamers = await prisma.streamer.findMany({
      select: {
        id: true,
        twitchUserId: true,
        displayName: true,
      },
    });

    const totalStreamers = streamers.length;
    logger.info("Jobs", `找到 ${totalStreamers} 個實況主需要同步`);

    // 分批處理
    for (let i = 0; i < streamers.length; i += BATCH_SIZE) {
      const batch = streamers.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(streamers.length / BATCH_SIZE);

      logger.info("Jobs", `處理第 ${batchNum}/${totalBatches} 批 (${batch.length} 個實況主)...`);

      // 記憶體檢查
      const memUsage = process.memoryUsage();
      const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);

      if (heapUsedMB > MAX_MEMORY_MB) {
        logger.warn(
          "Jobs",
          `⚠️ 記憶體使用超過警戒線 (${heapUsedMB}MB > ${MAX_MEMORY_MB}MB)，提前結束同步`
        );
        totalSkipped = streamers.length - totalProcessed;
        break;
      }

      // 處理此批次
      for (const streamer of batch) {
        if (!streamer.twitchUserId) {
          totalSkipped++;
          continue;
        }

        try {
          logger.debug("Jobs", `同步: ${streamer.displayName}`);

          // 依序執行以免觸發 Rate Limit
          await twurpleVideoService.syncVideos(streamer.twitchUserId, streamer.id);
          await twurpleVideoService.syncClips(streamer.twitchUserId, streamer.id);

          totalProcessed++;

          // 每個實況主之間短暫休息
          await new Promise((resolve) => setTimeout(resolve, STREAMER_DELAY_MS));
        } catch (error) {
          logger.error("Jobs", `同步失敗 (${streamer.displayName}):`, error);
          totalSkipped++;
        }
      }

      // 批次之間較長休息，讓 GC 有時間清理
      if (i + BATCH_SIZE < streamers.length) {
        logger.debug("Jobs", `批次完成，休息 ${BATCH_DELAY_MS}ms 讓系統喘息...`);
        await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));

        // 手動觸發 GC（如果可用）
        if (global.gc) {
          global.gc();
          logger.debug("Jobs", "已觸發 GC");
        }
      }
    }

    const duration = Math.round((Date.now() - startTime) / 1000);
    const finalMemMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);

    logger.info(
      "Jobs",
      `Sync Videos Job 完成: 成功 ${totalProcessed}, 跳過 ${totalSkipped}, ` +
      `耗時 ${duration}s, 記憶體 ${finalMemMB}MB`
    );
  } catch (error) {
    logger.error("Jobs", "Sync Videos Job 執行失敗", error);
  }
});
