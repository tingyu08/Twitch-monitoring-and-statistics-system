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

const WATERMARK_SETTING_KEY = "watch-time-increment:last-processed-at";
const RUN_IDEMPOTENCY_KEY_PREFIX = "watch-time-increment:run:";
const ACTIVE_LEASE_KEY = "watch-time-increment:lease";
const CRON_JITTER_MAX_MS = Number.parseInt(process.env.WATCH_TIME_CRON_JITTER_MAX_MS || "3000", 10);
const JOB_CIRCUIT_BREAKER_NAME = "watch-time-increment";
const RUN_KEY_STALE_MS = Number.parseInt(
  process.env.WATCH_TIME_RUN_KEY_STALE_MS || `${Math.max(WATCH_TIME_INCREMENT_MINUTES * 3 * 60 * 1000, 1800000)}`,
  10
);

type ActivePair = { viewerId: string; channelId: string };

type ReservedInterval = {
  intervalStart: Date;
  intervalEnd: Date;
  runKey: string | null;
  idempotentSkip: boolean;
};

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

function buildRunStartedValue(now: Date): string {
  return `started:${now.toISOString()}`;
}

function parseRunStartedAt(value: string | null | undefined): Date | null {
  if (!value || !value.startsWith("started:")) {
    return null;
  }

  const startedAt = new Date(value.slice("started:".length));
  return Number.isFinite(startedAt.getTime()) ? startedAt : null;
}

function buildLeaseValue(now: Date, intervalEnd: Date): string {
  return `lease:${now.toISOString()}|${intervalEnd.toISOString()}`;
}

function parseLeaseStartedAt(value: string | null | undefined): Date | null {
  if (!value || !value.startsWith("lease:")) {
    return null;
  }

  const body = value.slice("lease:".length);
  const [startedAtRaw] = body.split("|", 1);
  const startedAt = new Date(startedAtRaw);
  return Number.isFinite(startedAt.getTime()) ? startedAt : null;
}

function buildActivePairsSql(intervalStart: Date, intervalEnd: Date) {
  return Prisma.sql`
    SELECT vcm.viewerId, vcm.channelId
    FROM viewer_channel_messages vcm
    INNER JOIN channels c ON c.id = vcm.channelId
    WHERE vcm.timestamp >= ${intervalStart}
      AND vcm.timestamp < ${intervalEnd}
      AND c.isLive = 1
      AND c.isMonitored = 1
    GROUP BY vcm.viewerId, vcm.channelId
  `;
}

function buildDailyUpsertSql(intervalStart: Date, intervalEnd: Date, todayDateTime: string) {
  return Prisma.sql`
    WITH active_pairs AS (
      ${buildActivePairsSql(intervalStart, intervalEnd)}
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
      active_pairs.viewerId,
      active_pairs.channelId,
      ${todayDateTime},
      ${INCREMENT_SECONDS},
      0,
      0,
      'chat',
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    FROM active_pairs
    ON CONFLICT(viewerId, channelId, date) DO UPDATE SET
      watchSeconds = CASE
        WHEN viewer_channel_daily_stats.source = 'extension'
          THEN viewer_channel_daily_stats.watchSeconds
        ELSE viewer_channel_daily_stats.watchSeconds + excluded.watchSeconds
      END,
      updatedAt = CURRENT_TIMESTAMP
  `;
}

function buildLifetimeUpsertSql(intervalStart: Date, intervalEnd: Date, todayDateTime: string) {
  const incrementMinutes = Math.floor(INCREMENT_SECONDS / 60);

  return Prisma.sql`
    WITH active_pairs AS (
      ${buildActivePairsSql(intervalStart, intervalEnd)}
    ),
    effective AS (
      SELECT
        active_pairs.viewerId,
        active_pairs.channelId,
        CASE
          WHEN daily.source = 'extension' THEN 0
          ELSE ${incrementMinutes}
        END AS incrementMinutes,
        ${intervalEnd.toISOString()} AS lastWatchedAt
      FROM active_pairs
      LEFT JOIN viewer_channel_daily_stats daily
        ON daily.viewerId = active_pairs.viewerId
       AND daily.channelId = active_pairs.channelId
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
    ON CONFLICT(viewerId, channelId) DO UPDATE SET
      totalWatchTimeMinutes =
        viewer_channel_lifetime_stats.totalWatchTimeMinutes + excluded.totalWatchTimeMinutes,
      lastWatchedAt = excluded.lastWatchedAt,
      updatedAt = CURRENT_TIMESTAMP
  `;
}

async function reserveInterval(now: Date): Promise<ReservedInterval> {
  return prisma.$transaction(
    async (tx) => {
      const watermark = await tx.systemSetting.findUnique({
        where: { key: WATERMARK_SETTING_KEY },
        select: { value: true },
      });

      const defaultWindowStart = new Date(now.getTime() - ACTIVE_WINDOW_MINUTES * 60 * 1000);
      const intervalStart = watermark ? new Date(watermark.value) : defaultWindowStart;
      const intervalEnd = now;
      const activeLease = await tx.systemSetting.findUnique({
        where: { key: ACTIVE_LEASE_KEY },
        select: { id: true, value: true },
      });

      if (!Number.isFinite(intervalStart.getTime()) || intervalStart >= intervalEnd) {
        await tx.systemSetting.upsert({
          where: { key: WATERMARK_SETTING_KEY },
          create: { key: WATERMARK_SETTING_KEY, value: intervalEnd.toISOString() },
          update: { value: intervalEnd.toISOString() },
        });

        return {
          intervalStart: intervalEnd,
          intervalEnd,
          runKey: null,
          idempotentSkip: false,
        };
      }

      const activeLeaseStartedAt = parseLeaseStartedAt(activeLease?.value);
      if (activeLeaseStartedAt && Date.now() - activeLeaseStartedAt.getTime() < RUN_KEY_STALE_MS) {
        return {
          intervalStart,
          intervalEnd,
          runKey: null,
          idempotentSkip: true,
        };
      }

      const runKey = `${RUN_IDEMPOTENCY_KEY_PREFIX}${intervalStart.toISOString()}|${intervalEnd.toISOString()}`;
      const existingRun = await tx.systemSetting.findUnique({
        where: { key: runKey },
        select: { id: true, value: true },
      });

      if (existingRun?.value === "completed") {
        await tx.systemSetting.upsert({
          where: { key: WATERMARK_SETTING_KEY },
          create: { key: WATERMARK_SETTING_KEY, value: intervalEnd.toISOString() },
          update: { value: intervalEnd.toISOString() },
        });

        return {
          intervalStart,
          intervalEnd,
          runKey,
          idempotentSkip: true,
        };
      }

      const existingRunStartedAt = parseRunStartedAt(existingRun?.value);
      if (
        existingRun &&
        existingRun.value !== "started" &&
        existingRunStartedAt &&
        Date.now() - existingRunStartedAt.getTime() < RUN_KEY_STALE_MS
      ) {
        return {
          intervalStart,
          intervalEnd,
          runKey,
          idempotentSkip: true,
        };
      }

      if (existingRun) {
        await tx.systemSetting.update({
          where: { key: runKey },
          data: { value: buildRunStartedValue(now) },
        });
      } else {
        try {
          await tx.systemSetting.create({
            data: { key: runKey, value: buildRunStartedValue(now) },
          });
        } catch (error) {
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2002"
          ) {
            return {
              intervalStart,
              intervalEnd,
              runKey,
              idempotentSkip: true,
            };
          }

          throw error;
        }
      }

      if (activeLease) {
        await tx.systemSetting.update({
          where: { key: ACTIVE_LEASE_KEY },
          data: { value: buildLeaseValue(now, intervalEnd) },
        });
      } else {
        try {
          await tx.systemSetting.create({
            data: { key: ACTIVE_LEASE_KEY, value: buildLeaseValue(now, intervalEnd) },
          });
        } catch (error) {
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2002"
          ) {
            return {
              intervalStart,
              intervalEnd,
              runKey,
              idempotentSkip: true,
            };
          }

          throw error;
        }
      }

      return {
        intervalStart,
        intervalEnd,
        runKey,
        idempotentSkip: false,
      };
    },
    {
      maxWait: 15000,
      timeout: 30000,
    }
  );
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
        const reserved = await reserveInterval(now);

        if (reserved.idempotentSkip || !reserved.runKey) {
          return {
            intervalStart: reserved.intervalStart,
            intervalEnd: reserved.intervalEnd,
            idempotentSkip: reserved.idempotentSkip,
            activePairs: [] as ActivePair[],
            dailyUpsertCount: 0,
            lifetimeUpsertCount: 0,
          };
        }

        const activePairs = await prisma.$queryRaw<Array<ActivePair>>(
          buildActivePairsSql(reserved.intervalStart, reserved.intervalEnd)
        );

        if (activePairs.length === 0) {
          await prisma.$transaction([
            prisma.systemSetting.update({
              where: { key: reserved.runKey },
              data: { value: "completed" },
            }),
            prisma.systemSetting.upsert({
              where: { key: WATERMARK_SETTING_KEY },
              create: { key: WATERMARK_SETTING_KEY, value: reserved.intervalEnd.toISOString() },
              update: { value: reserved.intervalEnd.toISOString() },
            }),
            prisma.systemSetting.delete({
              where: { key: ACTIVE_LEASE_KEY },
            }),
          ]);

          return {
            intervalStart: reserved.intervalStart,
            intervalEnd: reserved.intervalEnd,
            idempotentSkip: false,
            activePairs,
            dailyUpsertCount: 0,
            lifetimeUpsertCount: 0,
          };
        }

        const todayDateTime = toSqliteDateTime(reserved.intervalEnd);
        const transactionResult = await prisma.$transaction([
          prisma.$executeRaw(buildDailyUpsertSql(reserved.intervalStart, reserved.intervalEnd, todayDateTime)),
          prisma.$executeRaw(
            buildLifetimeUpsertSql(reserved.intervalStart, reserved.intervalEnd, todayDateTime)
          ),
          prisma.systemSetting.update({
            where: { key: reserved.runKey },
            data: { value: "completed" },
          }),
          prisma.systemSetting.upsert({
            where: { key: WATERMARK_SETTING_KEY },
            create: { key: WATERMARK_SETTING_KEY, value: reserved.intervalEnd.toISOString() },
            update: { value: reserved.intervalEnd.toISOString() },
          }),
          prisma.systemSetting.delete({
            where: { key: ACTIVE_LEASE_KEY },
          }),
        ]);

        return {
          intervalStart: reserved.intervalStart,
          intervalEnd: reserved.intervalEnd,
          idempotentSkip: false,
          activePairs,
          dailyUpsertCount: Number(transactionResult[0]),
          lifetimeUpsertCount: Number(transactionResult[1]),
        };
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
        this.lastSuccessAt = now;
        recordJobSuccess(JOB_CIRCUIT_BREAKER_NAME);
        logger.debug(
          "Jobs",
          `沒有活躍的觀眾，跳過觀看時間更新 (range=${executionResult.intervalStart.toISOString()} -> ${executionResult.intervalEnd.toISOString()})`
        );
        return;
      }

      // 5. 從 JS 陣列提取不重複 viewerId，清理快取（不需要再查 DB）
      const uniqueViewerIds = new Set(executionResult.activePairs.map((p) => p.viewerId));
      await cacheManager.invalidateTags(Array.from(uniqueViewerIds, (viewerId) => `viewer:${viewerId}`));

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
