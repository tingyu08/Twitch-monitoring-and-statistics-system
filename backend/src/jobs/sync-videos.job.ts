import cron from "node-cron";
import { prisma } from "../db/prisma";
import { twurpleVideoService } from "../services/twitch-video.service";
import { logger } from "../utils/logger";
import { MEMORY_THRESHOLDS } from "../utils/memory-thresholds";
import { captureJobError } from "./job-error-tracker";

/**
 * Sync Videos & Clips Job (記憶體優化版)
 * 頻率: 每 6 小時一次 ('0 0 *\/6 * * *')
 *
 * 同步內容：
 * 1. 實況主影片 (Video 表) - 保留 90 天，用於實況主後台
 * 2. 實況主剪輯 (Clip 表) - 永久保留，用於實況主後台
 * 3. 觀眾影片 (ViewerChannelVideo 表) - 每個 Channel 最多 6 部最新，用於觀眾追蹤名單
 * 4. 觀眾剪輯 (ViewerChannelClip 表) - 每個 Channel 最多 6 部最高觀看，用於觀眾追蹤名單
 *
 * 優化重點：
 * - 分批處理，避免一次載入所有實況主資料
 * - 批次之間強制 GC 和休息
 * - 記憶體超限時提前中斷
 */

// Zeabur 免費層優化：平衡性能與記憶體
const BATCH_SIZE = 20;           // 每批處理 20 個實況主（平衡性能與記憶體）
const BATCH_DELAY_MS = 1500;     // 批次之間休息 1.5 秒（讓 GC 有時間清理）
const STREAMER_DELAY_MS = 300;   // 每個實況主之間休息 300ms
// P0 Fix: 使用統一的記憶體閾值常數
const MAX_MEMORY_MB = MEMORY_THRESHOLDS.MAX_MB;
const ENTITY_QUERY_BATCH_SIZE = 200;

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

async function loadStreamersForSync(): Promise<StreamerSyncTarget[]> {
  const streamers: StreamerSyncTarget[] = [];
  let cursorId: string | undefined;

  while (true) {
    const batch = await prisma.streamer.findMany({
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

    if (batch.length === 0) break;

    streamers.push(...batch);
    cursorId = batch[batch.length - 1]?.id;

    if (batch.length < ENTITY_QUERY_BATCH_SIZE) break;
  }

  return streamers;
}

async function loadFollowedChannelsForSync(): Promise<FollowedChannelSyncTarget[]> {
  const channels: FollowedChannelSyncTarget[] = [];
  let cursorId: string | undefined;

  while (true) {
    const batch = await prisma.channel.findMany({
      where: {
        userFollows: {
          some: {},
        },
      },
      select: {
        id: true,
        twitchChannelId: true,
        channelName: true,
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

    if (batch.length === 0) break;

    channels.push(...batch);
    cursorId = batch[batch.length - 1]?.id;

    if (batch.length < ENTITY_QUERY_BATCH_SIZE) break;
  }

  return channels;
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
    logger.warn(
      "Jobs",
      `⚠️ ${context} 記憶體仍偏高 (${retryHeapMB}MB)，跳過此批次`
    );
    return true;
  }

  return false;
}

export const syncVideosJob = cron.schedule("0 0 */6 * * *", async () => {
  logger.info("Jobs", "開始執行 Sync Videos Job (記憶體優化版)...");

  const startTime = Date.now();
  let totalProcessed = 0;
  let totalSkipped = 0;
  let viewerChannelsSynced = 0;

  try {
    // ========== Part 1: 同步實況主的 Videos 和 Clips ==========
    // 只取得 ID 和基本資訊，減少記憶體佔用
    const streamers = await loadStreamersForSync();

    const totalStreamers = streamers.length;
    logger.info("Jobs", `找到 ${totalStreamers} 個實況主需要同步`);

    // 分批處理
    for (let i = 0; i < streamers.length; i += BATCH_SIZE) {
      const batch = streamers.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(streamers.length / BATCH_SIZE);

      logger.info("Jobs", `處理第 ${batchNum}/${totalBatches} 批 (${batch.length} 個實況主)...`);

      if (await shouldSkipBatch(MAX_MEMORY_MB, "實況主同步")) {
        totalSkipped += batch.length;
        continue;
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

    // ========== Part 2: 同步觀眾追蹤名單用的影片和剪輯 ==========
    logger.info("Jobs", "開始同步觀眾追蹤名單影片和剪輯...");

    // 找出所有被追蹤的 Channel（有 UserFollow 記錄的）
    const followedChannels = await loadFollowedChannelsForSync();

    logger.info("Jobs", `找到 ${followedChannels.length} 個被追蹤的 Channel 需要同步觀眾影片/剪輯`);

    // 分批處理 Channels
    for (let i = 0; i < followedChannels.length; i += BATCH_SIZE) {
      const batch = followedChannels.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(followedChannels.length / BATCH_SIZE);

      logger.info("Jobs", `[觀眾內容] 處理第 ${batchNum}/${totalBatches} 批 (${batch.length} 個 Channel)...`);

      if (await shouldSkipBatch(MAX_MEMORY_MB, "觀眾內容同步")) {
        continue;
      }

      // 處理此批次
      for (const channel of batch) {
        if (!channel.twitchChannelId) {
          continue;
        }

        try {
          // 同步影片和剪輯
          await twurpleVideoService.syncViewerVideos(channel.id, channel.twitchChannelId);
          await twurpleVideoService.syncViewerClips(channel.id, channel.twitchChannelId);
          viewerChannelsSynced++;

          // 每個 Channel 之間短暫休息
          await new Promise((resolve) => setTimeout(resolve, STREAMER_DELAY_MS));
        } catch (error) {
          logger.error("Jobs", `同步觀眾內容失敗 (${channel.channelName}):`, error);
        }
      }

      // 批次之間較長休息
      if (i + BATCH_SIZE < followedChannels.length) {
        logger.debug("Jobs", `[觀眾內容] 批次完成，休息 ${BATCH_DELAY_MS}ms...`);
        await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));

        if (global.gc) {
          global.gc();
        }
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
  }
});
