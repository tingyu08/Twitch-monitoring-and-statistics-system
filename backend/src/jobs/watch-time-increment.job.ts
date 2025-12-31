/**
 * Watch Time Increment Job
 *
 * 每 6 分鐘為在線觀眾增加 0.1 小時（360 秒）的觀看時間
 * 判斷在線：用戶在過去 6 分鐘內在正在直播的頻道發送過訊息
 */

import cron from "node-cron";
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
    logger.info(
      "Jobs",
      `📋 Watch Time Increment Job 已排程: ${WATCH_TIME_INCREMENT_CRON}`
    );

    cron.schedule(WATCH_TIME_INCREMENT_CRON, async () => {
      await this.execute();
    });
  }

  async execute(): Promise<void> {
    if (this.isRunning) {
      logger.warn("Jobs", "⚠️ Watch Time Increment Job 正在執行中，跳過...");
      return;
    }

    this.isRunning = true;

    try {
      const now = new Date();
      const activeWindowStart = new Date(
        now.getTime() - ACTIVE_WINDOW_MINUTES * 60 * 1000
      );

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

      const liveChannelIds = liveChannels.map((c) => c.id);

      // 2. 找出在活躍窗口內有訊息的 viewer-channel 組合
      const activeViewerChannels = await prisma.viewerChannelMessage.groupBy({
        by: ["viewerId", "channelId"],
        where: {
          channelId: { in: liveChannelIds },
          timestamp: { gte: activeWindowStart },
        },
      });

      if (activeViewerChannels.length === 0) {
        logger.debug("Jobs", "沒有活躍的觀眾，跳過觀看時間更新");
        return;
      }

      // 3. 為每個活躍的 viewer-channel 組合增加觀看時間
      let updatedCount = 0;

      for (const { viewerId, channelId } of activeViewerChannels) {
        try {
          await prisma.viewerChannelDailyStat.upsert({
            where: {
              viewerId_channelId_date: {
                viewerId,
                channelId,
                date: today,
              },
            },
            create: {
              viewerId,
              channelId,
              date: today,
              watchSeconds: INCREMENT_SECONDS,
              messageCount: 0,
              emoteCount: 0,
            },
            update: {
              watchSeconds: {
                increment: INCREMENT_SECONDS,
              },
            },
          });
          updatedCount++;
        } catch (error) {
          logger.error(
            "Jobs",
            `更新觀看時間失敗: viewer=${viewerId}, channel=${channelId}`,
            error
          );
        }
      }

      logger.info(
        "Jobs",
        `✅ Watch Time Increment 完成: 更新了 ${updatedCount} 個觀眾的觀看時間 (+${
          INCREMENT_SECONDS / 60
        } 分鐘)`
      );
    } catch (error) {
      logger.error("Jobs", "❌ Watch Time Increment Job 執行失敗", error);
    } finally {
      this.isRunning = false;
    }
  }
}

export const watchTimeIncrementJob = new WatchTimeIncrementJob();
