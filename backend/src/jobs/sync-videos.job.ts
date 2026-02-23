import cron from "node-cron";
import { prisma } from "../db/prisma";
import { twurpleVideoService } from "../services/twitch-video.service";
import { logger } from "../utils/logger";
import { MEMORY_THRESHOLDS } from "../utils/memory-thresholds";
import { captureJobError } from "./job-error-tracker";

/**
 * Sync Videos & Clips Job (記憶體優化版)
 * 頻率: 每 6 小時一次 ('0 0 *\/6 * * *')
 */

const BATCH_SIZE = 20;
const BATCH_DELAY_MS = 1500;
const STREAMER_DELAY_MS = 300;
const JOB_TIMEOUT_MS = 90 * 60 * 1000;
const MAX_MEMORY_MB = MEMORY_THRESHOLDS.MAX_MB;
const ENTITY_QUERY_BATCH_SIZE = 200;
let isRunning = false;

type StreamerSyncTarget = {
  id: string;
  twitchUserId: string;
  displayName: string;
};

type FollowedChannelSyncTarget = {
  id: string;
  twitchChannelId: string;
  channelName: string;
};

async function loadStreamerBatch(cursorId?: string): Promise<StreamerSyncTarget[]> {
  return prisma.streamer.findMany({
    select: {
      id: true,
      twitchUserId: true,
      displayName: true,
    },
    orderBy: { id: "asc" },
    take: ENTITY_QUERY_BATCH_SIZE,
    ...(cursorId
      ? {
          cursor: { id: cursorId },
          skip: 1,
        }
      : {}),
  });
}

async function loadFollowedChannelBatch(cursorId?: string): Promise<FollowedChannelSyncTarget[]> {
  return prisma.channel.findMany({
    where: {
      twitchChannelId: { not: "" },
      userFollows: { some: {} },
    },
    select: {
      id: true,
      twitchChannelId: true,
      channelName: true,
    },
    orderBy: { id: "asc" },
    take: BATCH_SIZE,
    ...(cursorId
      ? {
          cursor: { id: cursorId },
          skip: 1,
        }
      : {}),
  });
}

async function shouldSkipBatch(maxMemoryMB: number, context: string): Promise<boolean> {
  const memUsage = process.memoryUsage();
  const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);

  if (heapUsedMB <= maxMemoryMB) {
    return false;
  }

  logger.warn(
    "Jobs",
    `⚠️ ${context} 記憶體使用超過警戒線 (${heapUsedMB}MB > ${maxMemoryMB}MB)，嘗試釋放後再繼續`
  );

  if (global.gc) {
    global.gc();
  }

  await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));

  const retryUsage = process.memoryUsage();
  const retryHeapMB = Math.round(retryUsage.heapUsed / 1024 / 1024);

  if (retryHeapMB > maxMemoryMB) {
    logger.warn("Jobs", `⚠️ ${context} 記憶體仍偏高 (${retryHeapMB}MB)，跳過此批次`);
    return true;
  }

  return false;
}

export const syncVideosJob = cron.schedule("0 0 */6 * * *", async () => {
  if (isRunning) {
    logger.warn("Jobs", "Sync Videos Job 正在執行中，跳過此次排程");
    return;
  }

  isRunning = true;
  logger.info("Jobs", "開始執行 Sync Videos Job (記憶體優化版)...");

  const startTime = Date.now();
  let totalProcessed = 0;
  let totalSkipped = 0;
  let viewerChannelsSynced = 0;
  let timeoutTriggered = false;
  const timeoutHandle = setTimeout(() => {
    timeoutTriggered = true;
  }, JOB_TIMEOUT_MS);

  try {
    let streamerCursorId: string | undefined;
    let streamerBatchNum = 0;

    while (true) {
      if (timeoutTriggered) {
        logger.warn("Jobs", "Sync Videos Job 已達超時上限，提前結束");
        break;
      }

      const streamerChunk = await loadStreamerBatch(streamerCursorId);
      if (streamerChunk.length === 0) {
        break;
      }

      streamerCursorId = streamerChunk[streamerChunk.length - 1]?.id;

      for (let i = 0; i < streamerChunk.length; i += BATCH_SIZE) {
        if (timeoutTriggered) {
          break;
        }

        const batch = streamerChunk.slice(i, i + BATCH_SIZE);
        streamerBatchNum += 1;
        logger.info("Jobs", `處理第 ${streamerBatchNum} 批 (${batch.length} 個實況主)...`);

        if (await shouldSkipBatch(MAX_MEMORY_MB, "實況主同步")) {
          totalSkipped += batch.length;
          continue;
        }

        for (const streamer of batch) {
          if (timeoutTriggered) {
            break;
          }

          if (!streamer.twitchUserId) {
            totalSkipped++;
            continue;
          }

          try {
            logger.debug("Jobs", `同步: ${streamer.displayName}`);
            await twurpleVideoService.syncVideos(streamer.twitchUserId, streamer.id);
            await twurpleVideoService.syncClips(streamer.twitchUserId, streamer.id);
            totalProcessed++;
            await new Promise((resolve) => setTimeout(resolve, STREAMER_DELAY_MS));
          } catch (error) {
            logger.error("Jobs", `同步失敗 (${streamer.displayName}):`, error);
            totalSkipped++;
          }
        }

        if (i + BATCH_SIZE < streamerChunk.length) {
          logger.debug("Jobs", `批次完成，休息 ${BATCH_DELAY_MS}ms 讓系統喘息...`);
          await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));

          if (global.gc) {
            global.gc();
            logger.debug("Jobs", "已觸發 GC");
          }
        }
      }

      if (streamerChunk.length < ENTITY_QUERY_BATCH_SIZE) {
        break;
      }
    }

    logger.info("Jobs", "開始同步觀眾追蹤名單影片和剪輯...");

    let followedChannelCursorId: string | undefined;
    let followedBatchNum = 0;

    while (true) {
      if (timeoutTriggered) {
        logger.warn("Jobs", "Sync Videos Job 已達超時上限，提前結束觀眾內容同步");
        break;
      }

      const batch = await loadFollowedChannelBatch(followedChannelCursorId);
      if (batch.length === 0) {
        break;
      }

      followedBatchNum += 1;
      followedChannelCursorId = batch[batch.length - 1]?.id;

      logger.info("Jobs", `[觀眾內容] 處理第 ${followedBatchNum} 批 (${batch.length} 個 Channel)...`);

      if (await shouldSkipBatch(MAX_MEMORY_MB, "觀眾內容同步")) {
        if (batch.length < BATCH_SIZE) {
          break;
        }
        continue;
      }

      for (const channel of batch) {
        if (timeoutTriggered) {
          break;
        }

        if (!channel.twitchChannelId) {
          continue;
        }

        try {
          await twurpleVideoService.syncViewerVideos(channel.id, channel.twitchChannelId);
          await twurpleVideoService.syncViewerClips(channel.id, channel.twitchChannelId);
          viewerChannelsSynced++;
          await new Promise((resolve) => setTimeout(resolve, STREAMER_DELAY_MS));
        } catch (error) {
          logger.error("Jobs", `同步觀眾內容失敗 (${channel.channelName}):`, error);
        }
      }

      if (batch.length === BATCH_SIZE) {
        logger.debug("Jobs", `[觀眾內容] 批次完成，休息 ${BATCH_DELAY_MS}ms...`);
        await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));

        if (global.gc) {
          global.gc();
        }
      }

      if (batch.length < BATCH_SIZE) {
        break;
      }
    }

    const duration = Math.round((Date.now() - startTime) / 1000);
    const finalMemMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);

    logger.info(
      "Jobs",
      `Sync Videos Job 完成: 實況主 ${totalProcessed}, 跳過 ${totalSkipped}, ` +
        `觀眾 Channel ${viewerChannelsSynced}, 耗時 ${duration}s, 記憶體 ${finalMemMB}MB`
    );
  } catch (error) {
    logger.error("Jobs", "Sync Videos Job 執行失敗", error);
    captureJobError("sync-videos", error);
  } finally {
    clearTimeout(timeoutHandle);
    isRunning = false;
  }
});
