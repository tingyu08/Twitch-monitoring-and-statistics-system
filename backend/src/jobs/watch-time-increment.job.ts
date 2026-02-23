/**
 * Watch Time Increment Job
 *
 * 每 6 分鐘為在線觀眾增加 0.1 小時（360 秒）的觀看時間
 * 判斷在線：用戶在過去 6 分鐘內在正在直播的頻道發送過訊息
 */

import cron, { type ScheduledTask } from "node-cron";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { logger } from "../utils/logger";
import { cacheManager } from "../utils/cache-manager";
import { captureJobError } from "./job-error-tracker";
import { runWithWriteGuard } from "./job-write-guard";

const parsedIncrementMinutes = Number.parseInt(
  process.env.WATCH_TIME_INCREMENT_MINUTES || "10",
  10
);
const WATCH_TIME_INCREMENT_MINUTES =
  Number.isFinite(parsedIncrementMinutes) && parsedIncrementMinutes > 0
    ? parsedIncrementMinutes
    : 10;

// 預設每 10 分鐘執行一次（可用環境變數覆蓋）
const WATCH_TIME_INCREMENT_CRON =
  process.env.WATCH_TIME_INCREMENT_CRON || `15 */${WATCH_TIME_INCREMENT_MINUTES} * * * *`;

// 每次增加的秒數：與執行間隔一致
const INCREMENT_SECONDS = WATCH_TIME_INCREMENT_MINUTES * 60;

// 活躍窗口：過去 N 分鐘內有訊息視為在線
const ACTIVE_WINDOW_MINUTES = WATCH_TIME_INCREMENT_MINUTES;

export class WatchTimeIncrementJob {
  private isRunning = false;
  private scheduledTask: ScheduledTask | null = null;
  private lastSuccessAt: Date | null = null;

  start(): void {
    if (this.scheduledTask) {
      logger.debug("Jobs", "Watch Time Increment Job 已啟動，略過重複排程");
      return;
    }

    logger.info("Jobs", `📋 Watch Time Increment Job 已排程: ${WATCH_TIME_INCREMENT_CRON}`);

    this.scheduledTask = cron.schedule(WATCH_TIME_INCREMENT_CRON, async () => {
      await this.execute();
    });
  }

  async execute(): Promise<void> {
    if (this.isRunning) {
      logger.debug("Jobs", "Watch Time Increment Job 正在執行中，跳過...");
      return;
    }

    this.isRunning = true;
    const executionStartedAt = Date.now();

    try {
      const now = new Date();
      const activeWindowStart = new Date(now.getTime() - ACTIVE_WINDOW_MINUTES * 60 * 1000);

      // 今天的日期（正規化到 00:00:00）
      const today = new Date(now);
      today.setHours(0, 0, 0, 0);

      // 1. 找出正在直播中的頻道（僅取數量，避免大量 ID 造成 SQL 變數上限）
      const liveChannelCount = await prisma.channel.count({
        where: { isLive: true },
      });

      if (liveChannelCount === 0) {
        logger.debug(
          "Jobs",
          `沒有正在直播的頻道，跳過觀看時間更新 (lastSuccessAt=${
            this.lastSuccessAt?.toISOString() || "never"
          })`
        );
        return;
      }

      // 2. 計算活躍的 viewer-channel 組合數量
      const rows = await prisma.$queryRaw<Array<{ count: number | string }>>(Prisma.sql`
          SELECT COUNT(*) AS count
          FROM (
            SELECT viewerId, channelId
            FROM viewer_channel_messages
            WHERE timestamp >= ${activeWindowStart}
              AND EXISTS (
                SELECT 1
                FROM channels c
                WHERE c.id = viewer_channel_messages.channelId
                  AND c.isLive = 1
              )
            GROUP BY viewerId, channelId
          )
      `);

      const activeCount = Number(rows[0]?.count ?? 0);
      if (activeCount === 0) {
        logger.debug(
          "Jobs",
          `沒有活躍的觀眾，跳過觀看時間更新 (liveChannels=${liveChannelCount}, window=${ACTIVE_WINDOW_MINUTES}m)`
        );
        return;
      }

      // 3. 使用 set-based SQL 一次性 upsert，降低大量逐筆寫入成本
      const dailyUpsertAffected = await runWithWriteGuard("watch-time-increment:daily-stats-upsert", () =>
        prisma.$executeRaw(Prisma.sql`
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
            WHERE timestamp >= ${activeWindowStart}
              AND EXISTS (
                SELECT 1
                FROM channels c
                WHERE c.id = viewer_channel_messages.channelId
                  AND c.isLive = 1
              )
            GROUP BY viewerId, channelId
          ) AS active
          ON CONFLICT(viewerId, channelId, date) DO UPDATE SET
            watchSeconds = viewer_channel_daily_stats.watchSeconds + excluded.watchSeconds,
            updatedAt = CURRENT_TIMESTAMP
        `)
      );
      const dailyUpsertCount = Number(dailyUpsertAffected);

      // 4. 同步更新 lifetime watch minutes，避免等到每日聚合才看到數值變化
      const incrementMinutes = Math.floor(INCREMENT_SECONDS / 60);
      let lifetimeUpsertCount = 0;
      if (incrementMinutes > 0) {
        const lifetimeUpsertAffected = await runWithWriteGuard(
          "watch-time-increment:lifetime-stats-upsert",
          () =>
          prisma.$executeRaw(Prisma.sql`
            INSERT INTO viewer_channel_lifetime_stats (
              id,
              viewerId,
              channelId,
              totalWatchTimeMinutes,
              totalSessions,
              avgSessionMinutes,
              firstWatchedAt,
              lastWatchedAt,
              totalMessages,
              totalChatMessages,
              totalSubscriptions,
              totalCheers,
              totalBits,
              trackingStartedAt,
              trackingDays,
              longestStreakDays,
              currentStreakDays,
              activeDaysLast30,
              activeDaysLast90,
              mostActiveMonthCount,
              createdAt,
              updatedAt
            )
            SELECT
              lower(hex(randomblob(16))) AS id,
              active.viewerId,
              active.channelId,
              ${incrementMinutes},
              0,
              0,
              ${now},
              ${now},
              0,
              0,
              0,
              0,
              0,
              CURRENT_TIMESTAMP,
              0,
              0,
              0,
              0,
              0,
              0,
              CURRENT_TIMESTAMP,
              CURRENT_TIMESTAMP
            FROM (
              SELECT viewerId, channelId
              FROM viewer_channel_messages
              WHERE timestamp >= ${activeWindowStart}
                AND EXISTS (
                  SELECT 1
                  FROM channels c
                  WHERE c.id = viewer_channel_messages.channelId
                    AND c.isLive = 1
                )
              GROUP BY viewerId, channelId
            ) AS active
            ON CONFLICT(viewerId, channelId) DO UPDATE SET
              totalWatchTimeMinutes =
                viewer_channel_lifetime_stats.totalWatchTimeMinutes + excluded.totalWatchTimeMinutes,
              lastWatchedAt = excluded.lastWatchedAt,
              updatedAt = CURRENT_TIMESTAMP
          `)
        );
        lifetimeUpsertCount = Number(lifetimeUpsertAffected);
      }

      // 5. 清理受影響觀眾的頻道列表快取，確保前端立即看到更新
      const activeViewers = await prisma.$queryRaw<Array<{ viewerId: string }>>(Prisma.sql`
        SELECT DISTINCT viewerId
        FROM viewer_channel_messages
        WHERE timestamp >= ${activeWindowStart}
          AND EXISTS (
            SELECT 1
            FROM channels c
            WHERE c.id = viewer_channel_messages.channelId
              AND c.isLive = 1
          )
      `);

      for (const row of activeViewers) {
        cacheManager.delete(`viewer:${row.viewerId}:channels_list`);
      }

      const updatedCount = activeCount;
      const duration = Date.now() - executionStartedAt;

      // 只在有實際更新時輸出 info，否則輸出 debug
      if (updatedCount > 0) {
        this.lastSuccessAt = now;
        logger.info(
          "Jobs",
          `Watch Time Increment 完成: 更新了 ${updatedCount} 個觀眾的觀看時間 (+${
            INCREMENT_SECONDS / 60
          } 分鐘, liveChannels=${liveChannelCount}, dailyUpserts=${dailyUpsertCount}, lifetimeUpserts=${lifetimeUpsertCount}, invalidatedCaches=${activeViewers.length}) [${duration}ms]`
        );
      } else {
        logger.debug(
          "Jobs",
          `Watch Time Increment 完成: 沒有需要更新的觀眾 (liveChannels=${liveChannelCount}, activePairs=${activeCount})`
        );
      }
    } catch (error) {
      logger.error("Jobs", "❌ Watch Time Increment Job 執行失敗", error);
      captureJobError("watch-time-increment", error);
    } finally {
      this.isRunning = false;
    }
  }
}

export const watchTimeIncrementJob = new WatchTimeIncrementJob();
