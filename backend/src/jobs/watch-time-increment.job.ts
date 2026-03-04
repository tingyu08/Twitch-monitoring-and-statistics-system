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
import { WriteGuardKeys } from "../constants";

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

// 批次大小：每次 INSERT VALUES 的組數上限，避免 SQL 過長
// 預設提高到 1000，讓一般負載可在單批完成，將 DB 寫入壓到最少
const BATCH_SIZE = 1000;

/** 將 Date 轉為 SQLite 相容的 ISO 日期字串 (YYYY-MM-DD) */
function toSqliteDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export class WatchTimeIncrementJob {
  private isRunning = false;
  private scheduledTask: ScheduledTask | null = null;
  private lastSuccessAt: Date | null = null;
  private lastAttemptAt: Date | null = null;

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
    this.lastAttemptAt = new Date();
    const executionStartedAt = Date.now();

    try {
      const now = new Date();
      const activeWindowStart = new Date(now.getTime() - ACTIVE_WINDOW_MINUTES * 60 * 1000);

      // 1. 一次性物化所有活躍的 viewer-channel 組合到 JS 陣列
      //    這是唯一一次掃描 viewer_channel_messages 的查詢
      //    後續的 daily upsert、lifetime upsert、cache invalidation 全部基於此陣列
      const activePairs = await prisma.$queryRaw<
        Array<{ viewerId: string; channelId: string }>
      >(Prisma.sql`
        SELECT viewerId, channelId
        FROM viewer_channel_messages
        WHERE timestamp >= ${activeWindowStart}
        GROUP BY viewerId, channelId
      `);

      const activeCount = activePairs.length;
      if (activeCount === 0) {
        logger.debug(
          "Jobs",
          `沒有活躍的觀眾，跳過觀看時間更新 (window=${ACTIVE_WINDOW_MINUTES}m)`
        );
        return;
      }

      // 3. 批次 upsert daily stats（每批一條 SQL，避免逐筆寫入造成 write guard gap 放大）
      let dailyUpsertCount = 0;
      const todayStr = toSqliteDate(now);
      for (let i = 0; i < activePairs.length; i += BATCH_SIZE) {
        const batch = activePairs.slice(i, i + BATCH_SIZE);
        const batchValues = batch.map(
          (p) => Prisma.sql`(${p.viewerId}, ${p.channelId}, ${todayStr}, ${INCREMENT_SECONDS})`
        );

        const affected = await runWithWriteGuard(WriteGuardKeys.WATCH_TIME_DAILY_UPSERT, () =>
          prisma.$executeRaw(Prisma.sql`
            WITH src (viewerId, channelId, date, watchSeconds) AS (
              VALUES ${Prisma.join(batchValues)}
            )
            INSERT INTO viewer_channel_daily_stats (
              id,
              viewerId,
              channelId,
              date,
              watchSeconds,
              messageCount,
              emoteCount,
              source,
              createdAt,
              updatedAt
            )
            SELECT
              lower(hex(randomblob(16))) AS id,
              src.viewerId,
              src.channelId,
              src.date,
              src.watchSeconds,
              0,
              0,
              'chat',
              CURRENT_TIMESTAMP,
              CURRENT_TIMESTAMP
            FROM src
            ON CONFLICT(viewerId, channelId, date) DO UPDATE SET
              watchSeconds = CASE
                WHEN viewer_channel_daily_stats.source = 'extension'
                  THEN viewer_channel_daily_stats.watchSeconds
                ELSE viewer_channel_daily_stats.watchSeconds + excluded.watchSeconds
              END,
              updatedAt = CURRENT_TIMESTAMP
          `)
        );

        dailyUpsertCount += Number(affected);
      }

      // 4. 批次 upsert lifetime stats（每批一條 SQL，沿用 daily source='extension' 防重複邏輯）
      const incrementMinutes = Math.floor(INCREMENT_SECONDS / 60);
      let lifetimeUpsertCount = 0;
      if (incrementMinutes > 0) {
        const nowIso = now.toISOString();
        for (let i = 0; i < activePairs.length; i += BATCH_SIZE) {
          const batch = activePairs.slice(i, i + BATCH_SIZE);
          const batchValues = batch.map(
            (p) => Prisma.sql`(${p.viewerId}, ${p.channelId}, ${incrementMinutes}, ${nowIso})`
          );

          const affected = await runWithWriteGuard(WriteGuardKeys.WATCH_TIME_LIFETIME_UPSERT, () =>
            prisma.$executeRaw(Prisma.sql`
              WITH src (viewerId, channelId, incrementMinutes, lastWatchedAt) AS (
                VALUES ${Prisma.join(batchValues)}
              ),
              effective AS (
                SELECT
                  src.viewerId,
                  src.channelId,
                  CASE
                    WHEN daily.source = 'extension' THEN 0
                    ELSE src.incrementMinutes
                  END AS incrementMinutes,
                  src.lastWatchedAt
                FROM src
                LEFT JOIN viewer_channel_daily_stats daily
                  ON daily.viewerId = src.viewerId
                 AND daily.channelId = src.channelId
                 AND daily.date = ${todayStr}
              )
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
                effective.viewerId,
                effective.channelId,
                effective.incrementMinutes,
                0,
                0,
                effective.lastWatchedAt,
                effective.lastWatchedAt,
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
              FROM effective
              ON CONFLICT(viewerId, channelId) DO UPDATE SET
                totalWatchTimeMinutes =
                  viewer_channel_lifetime_stats.totalWatchTimeMinutes + excluded.totalWatchTimeMinutes,
                lastWatchedAt = excluded.lastWatchedAt,
                updatedAt = CURRENT_TIMESTAMP
            `)
          );

          lifetimeUpsertCount += Number(affected);
        }
      }

      // 5. 從 JS 陣列提取不重複 viewerId，清理快取（不需要再查 DB）
      const uniqueViewerIds = new Set(activePairs.map((p) => p.viewerId));
      for (const viewerId of uniqueViewerIds) {
        cacheManager.delete(`viewer:${viewerId}:channels_list`);
      }

      const duration = Date.now() - executionStartedAt;

      this.lastSuccessAt = now;
      logger.info(
        "Jobs",
        `Watch Time Increment 完成: 更新了 ${activeCount} 個觀眾的觀看時間 (+${
          INCREMENT_SECONDS / 60
        } 分鐘, dailyUpserts=${dailyUpsertCount}, lifetimeUpserts=${lifetimeUpsertCount}, invalidatedCaches=${uniqueViewerIds.size}) [${duration}ms]`
      );
    } catch (error) {
      logger.error("Jobs", "❌ Watch Time Increment Job 執行失敗", error);
      captureJobError("watch-time-increment", error);
    } finally {
      this.isRunning = false;
    }
  }

  getStatus(): {
    scheduled: boolean;
    isRunning: boolean;
    lastAttemptAt: string | null;
    lastSuccessAt: string | null;
    cron: string;
    incrementMinutes: number;
    activeWindowMinutes: number;
  } {
    return {
      scheduled: Boolean(this.scheduledTask),
      isRunning: this.isRunning,
      lastAttemptAt: this.lastAttemptAt ? this.lastAttemptAt.toISOString() : null,
      lastSuccessAt: this.lastSuccessAt ? this.lastSuccessAt.toISOString() : null,
      cron: WATCH_TIME_INCREMENT_CRON,
      incrementMinutes: WATCH_TIME_INCREMENT_MINUTES,
      activeWindowMinutes: ACTIVE_WINDOW_MINUTES,
    };
  }
}

export const watchTimeIncrementJob = new WatchTimeIncrementJob();
