import cron from "node-cron";
import { prisma } from "../db/prisma";
import { twurpleVideoService } from "../services/twitch-video.service";
import { logger } from "../utils/logger";

/**
 * Sync Videos & Clips Job
 * 頻率: 每 6 小時一次 ('0 0 *\/6 * * *')
 */
export const syncVideosJob = cron.schedule("0 0 */6 * * *", async () => {
  logger.info("Jobs", "開始執行 Sync Videos Job...");
  try {
    const streamers = await prisma.streamer.findMany();

    for (const streamer of streamers) {
      if (!streamer.twitchUserId) continue;

      logger.debug("Jobs", `正在同步實況主的影片: ${streamer.displayName}`);

      // 依序執行以免觸發 Rate Limit
      await twurpleVideoService.syncVideos(streamer.twitchUserId, streamer.id);
      await twurpleVideoService.syncClips(streamer.twitchUserId, streamer.id);

      // 簡單延遲防止請求過快
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    logger.info("Jobs", `Sync Videos Job 完成，已處理 ${streamers.length} 個實況主`);
  } catch (error) {
    logger.error("Jobs", "Sync Videos Job 執行失敗", error);
  }
});
