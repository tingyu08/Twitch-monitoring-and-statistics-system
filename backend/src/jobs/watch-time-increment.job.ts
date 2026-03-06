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
import { runWithWriteGuard } from "./job-write-guard";
import { WriteGuardKeys } from "../constants";
import {
  recordJobFailure,
  recordJobSuccess,
  shouldSkipForCircuitBreaker,
} from "../utils/job-circuit-breaker";

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
const WATERMARK_SETTING_KEY = "watch-time-increment:last-processed-at";
const RUN_IDEMPOTENCY_KEY_PREFIX = "watch-time-increment:run:";
const CRON_JITTER_MAX_MS = Number.parseInt(process.env.WATCH_TIME_CRON_JITTER_MAX_MS || "3000", 10);
const JOB_CIRCUIT_BREAKER_NAME = "watch-time-increment";

/**
 * 將 Date 轉為 SQLite 可解析的 datetime 字串 (YYYY-MM-DD 00:00:00)
 * 避免只寫入 YYYY-MM-DD 造成 Prisma DateTime 解析失敗。
 */
function toSqliteDateTime(d: Date): string {
  return `${d.toISOString().slice(0, 10)} 00:00:00`;
}

function floorToMinute(d: Date): Date {
  const value = new Date(d);
  value.setUTCSeconds(0, 0);
  return value;
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
      if (CRON_JITTER_MAX_MS > 0) {
        const jitterMs = Math.floor(Math.random() * CRON_JITTER_MAX_MS);
        if (jitterMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, jitterMs));
        }
      }
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

    if (shouldSkipForCircuitBreaker(JOB_CIRCUIT_BREAKER_NAME)) {
      logger.warn("Jobs", "Watch Time Increment Job 暫停中（circuit breaker），跳過本輪");
      this.isRunning = false;
      return;
    }

    try {
      const now = floorToMinute(new Date());
      const executionResult = await runWithWriteGuard(WriteGuardKeys.WATCH_TIME_EXECUTION, async () => {
        // Turso 每次 round-trip ~1.5s，transaction 含 8 個操作最多約 12s
        // 明確設定 timeout 避免使用 Turso 預設 5000ms 造成 P2028
        return prisma.$transaction(async (tx) => {
          const watermark = await tx.systemSetting.findUnique({
            where: { key: WATERMARK_SETTING_KEY },
            select: { value: true },
          });

          const defaultWindowStart = new Date(now.getTime() - ACTIVE_WINDOW_MINUTES * 60 * 1000);
          const intervalStart = watermark ? new Date(watermark.value) : defaultWindowStart;
          const intervalEnd = now;

          if (!Number.isFinite(intervalStart.getTime()) || intervalStart >= intervalEnd) {
            await tx.systemSetting.upsert({
              where: { key: WATERMARK_SETTING_KEY },
              create: { key: WATERMARK_SETTING_KEY, value: intervalEnd.toISOString() },
              update: { value: intervalEnd.toISOString() },
            });

            return {
              intervalStart: intervalEnd,
              intervalEnd,
              idempotentSkip: false,
              activePairs: [] as Array<{ viewerId: string; channelId: string }>,
              dailyUpsertCount: 0,
              lifetimeUpsertCount: 0,
            };
          }

          const runKey = `${RUN_IDEMPOTENCY_KEY_PREFIX}${intervalStart.toISOString()}|${intervalEnd.toISOString()}`;
          const existingRun = await tx.systemSetting.findUnique({
            where: { key: runKey },
            select: { id: true },
          });

          if (existingRun) {
            await tx.systemSetting.upsert({
              where: { key: WATERMARK_SETTING_KEY },
              create: { key: WATERMARK_SETTING_KEY, value: intervalEnd.toISOString() },
              update: { value: intervalEnd.toISOString() },
            });

            return {
              intervalStart,
              intervalEnd,
              idempotentSkip: true,
              activePairs: [] as Array<{ viewerId: string; channelId: string }>,
              dailyUpsertCount: 0,
              lifetimeUpsertCount: 0,
            };
          }

          await tx.systemSetting.create({
            data: { key: runKey, value: "started" },
          });

          const activePairs = await tx.$queryRaw<Array<{ viewerId: string; channelId: string }>>(Prisma.sql`
            SELECT viewerId, channelId
            FROM viewer_channel_messages
            WHERE timestamp >= ${intervalStart}
              AND timestamp < ${intervalEnd}
            GROUP BY viewerId, channelId
          `);

          let dailyUpsertCount = 0;
          let lifetimeUpsertCount = 0;
          const activeCount = activePairs.length;

          if (activeCount > 0) {
            const todayDateTime = toSqliteDateTime(intervalEnd);
            for (let i = 0; i < activePairs.length; i += BATCH_SIZE) {
              const batch = activePairs.slice(i, i + BATCH_SIZE);
              const batchValues = batch.map(
                (p) =>
                  Prisma.sql`(${p.viewerId}, ${p.channelId}, ${todayDateTime}, ${INCREMENT_SECONDS})`
              );

              const affected = await tx.$executeRaw(Prisma.sql`
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
                WHERE 1 = 1
                ON CONFLICT(viewerId, channelId, date) DO UPDATE SET
                  watchSeconds = CASE
                    WHEN viewer_channel_daily_stats.source = 'extension'
                      THEN viewer_channel_daily_stats.watchSeconds
                    ELSE viewer_channel_daily_stats.watchSeconds + excluded.watchSeconds
                  END,
                  updatedAt = CURRENT_TIMESTAMP
              `);

              dailyUpsertCount += Number(affected);
            }

            const incrementMinutes = Math.floor(INCREMENT_SECONDS / 60);
            if (incrementMinutes > 0) {
              const intervalEndIso = intervalEnd.toISOString();
              for (let i = 0; i < activePairs.length; i += BATCH_SIZE) {
                const batch = activePairs.slice(i, i + BATCH_SIZE);
                const batchValues = batch.map(
                  (p) =>
                    Prisma.sql`(${p.viewerId}, ${p.channelId}, ${incrementMinutes}, ${intervalEndIso})`
                );

                const affected = await tx.$executeRaw(Prisma.sql`
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
                     AND daily.date = ${todayDateTime}
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
                  WHERE 1 = 1
                  ON CONFLICT(viewerId, channelId) DO UPDATE SET
                    totalWatchTimeMinutes =
                      viewer_channel_lifetime_stats.totalWatchTimeMinutes + excluded.totalWatchTimeMinutes,
                    lastWatchedAt = excluded.lastWatchedAt,
                    updatedAt = CURRENT_TIMESTAMP
                `);

                lifetimeUpsertCount += Number(affected);
              }
            }
          }

          await tx.systemSetting.update({
            where: { key: runKey },
            data: { value: "completed" },
          });

          await tx.systemSetting.upsert({
            where: { key: WATERMARK_SETTING_KEY },
            create: { key: WATERMARK_SETTING_KEY, value: intervalEnd.toISOString() },
            update: { value: intervalEnd.toISOString() },
          });

          return {
            intervalStart,
            intervalEnd,
            idempotentSkip: false,
            activePairs,
            dailyUpsertCount,
            lifetimeUpsertCount,
          };
        }, {
          maxWait: 15000, // 最多等 15s 取得 transaction slot
          timeout: 30000, // transaction 執行上限 30s（8 次操作 × ~1.5s/次 ≈ 12s，留充足餘裕）
        });
      });

      if (executionResult.idempotentSkip) {
        logger.debug(
          "Jobs",
          `Watch Time Increment 重複區間跳過: ${executionResult.intervalStart.toISOString()} -> ${executionResult.intervalEnd.toISOString()}`
        );
        return;
      }

      const activeCount = executionResult.activePairs.length;
      if (activeCount === 0) {
        logger.debug(
          "Jobs",
          `沒有活躍的觀眾，跳過觀看時間更新 (range=${executionResult.intervalStart.toISOString()} -> ${executionResult.intervalEnd.toISOString()})`
        );
        return;
      }

      // 5. 從 JS 陣列提取不重複 viewerId，清理快取（不需要再查 DB）
      const uniqueViewerIds = new Set(executionResult.activePairs.map((p) => p.viewerId));
      for (const viewerId of uniqueViewerIds) {
        cacheManager.delete(`viewer:${viewerId}:channels_list`);
      }

      const duration = Date.now() - executionStartedAt;

      this.lastSuccessAt = now;
      recordJobSuccess(JOB_CIRCUIT_BREAKER_NAME);
      logger.info(
        "Jobs",
        `Watch Time Increment 完成: 更新了 ${activeCount} 個觀眾的觀看時間 (+${
          INCREMENT_SECONDS / 60
        } 分鐘, dailyUpserts=${executionResult.dailyUpsertCount}, lifetimeUpserts=${executionResult.lifetimeUpsertCount}, invalidatedCaches=${uniqueViewerIds.size}, range=${executionResult.intervalStart.toISOString()} -> ${executionResult.intervalEnd.toISOString()}) [${duration}ms]`
      );
    } catch (error) {
      logger.error("Jobs", "❌ Watch Time Increment Job 執行失敗", error);
      recordJobFailure(JOB_CIRCUIT_BREAKER_NAME, error);
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
