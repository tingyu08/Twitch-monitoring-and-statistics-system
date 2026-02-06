/**
 * Watch Time Increment Job
 *
 * 每 6 分鐘為在線觀眾增加 0.1 小時（360 秒）的觀看時間
 * 判斷在線：用戶在過去 6 分鐘內在正在直播的頻道發送過訊息
 */

import cron from "node-cron";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { logger } from "../utils/logger";

// 每 6 分鐘執行，在第 4 分鐘觸發（錯開其他 Jobs）
const WATCH_TIME_INCREMENT_CRON = "0 4-59/6 * * * *";

// 每次增加的秒數：0.1 小時 = 6 分鐘 = 360 秒
const INCREMENT_SECONDS = 360;

// 活躍窗口：過去 6 分鐘內有訊息視為在線
const ACTIVE_WINDOW_MINUTES = 6;

export class WatchTimeIncrementJob {
  private isRunning = false;

  start(): void {
    logger.info("Jobs", `📋 Watch Time Increment Job 已排程: ${WATCH_TIME_INCREMENT_CRON}`);

    cron.schedule(WATCH_TIME_INCREMENT_CRON, async () => {
      await this.execute();
    });
  }

  async execute(): Promise<void> {
    if (this.isRunning) {
      logger.debug("Jobs", "Watch Time Increment Job 正在執行中，跳過...");
      return;
    }

    this.isRunning = true;

    try {
      const now = new Date();
      const activeWindowStart = new Date(now.getTime() - ACTIVE_WINDOW_MINUTES * 60 * 1000);

      // 今天的日期（正規化到 00:00:00）
      const today = new Date(now);
      today.setHours(0, 0, 0, 0);

      // 1. 找出正在直播中的頻道
      const liveChannels = await prisma.channel.findMany({
        where: { isLive: true },
        select: { id: true, channelName: true },
      });

      if (liveChannels.length === 0) {
        logger.debug("Jobs", "沒有正在直播的頻道，跳過觀看時間更新");
        return;
      }

      const liveChannelIds = liveChannels.map((c: { id: string }) => c.id);

      // 2. 計算活躍的 viewer-channel 組合數量
      const rows = await prisma.$queryRaw<Array<{ count: number | string }>>(Prisma.sql`
        SELECT COUNT(*) AS count
        FROM (
          SELECT viewerId, channelId
          FROM viewer_channel_messages
          WHERE channelId IN (${Prisma.join(liveChannelIds)})
            AND timestamp >= ${activeWindowStart}
          GROUP BY viewerId, channelId
        )
      `);

      const activeCount = Number(rows[0]?.count ?? 0);
      if (activeCount === 0) {
        logger.debug("Jobs", "沒有活躍的觀眾，跳過觀看時間更新");
        return;
      }

      // 3. 使用 set-based SQL 一次性 upsert，降低大量逐筆寫入成本
      await prisma.$executeRaw(Prisma.sql`
        INSERT INTO viewer_channel_daily_stats (
          id,
          viewerId,
          channelId,
          date,
          watchSeconds,
          messageCount,
          emoteCount,
          createdAt,
          updatedAt
        )
        SELECT
          lower(hex(randomblob(16))) AS id,
          active.viewerId,
          active.channelId,
          ${today} AS date,
          ${INCREMENT_SECONDS} AS watchSeconds,
          0,
          0,
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        FROM (
          SELECT viewerId, channelId
          FROM viewer_channel_messages
          WHERE channelId IN (${Prisma.join(liveChannelIds)})
            AND timestamp >= ${activeWindowStart}
          GROUP BY viewerId, channelId
        ) AS active
        ON CONFLICT(viewerId, channelId, date) DO UPDATE SET
          watchSeconds = viewer_channel_daily_stats.watchSeconds + excluded.watchSeconds,
          updatedAt = CURRENT_TIMESTAMP
      `);

      const updatedCount = activeCount;

      // 只在有實際更新時輸出 info，否則輸出 debug
      if (updatedCount > 0) {
        logger.info(
          "Jobs",
          `Watch Time Increment 完成: 更新了 ${updatedCount} 個觀眾的觀看時間 (+${
            INCREMENT_SECONDS / 60
          } 分鐘)`
        );
      } else {
        logger.debug("Jobs", "Watch Time Increment 完成: 沒有需要更新的觀眾");
      }
    } catch (error) {
      logger.error("Jobs", "❌ Watch Time Increment Job 執行失敗", error);
    } finally {
      this.isRunning = false;
    }
  }
}

export const watchTimeIncrementJob = new WatchTimeIncrementJob();
