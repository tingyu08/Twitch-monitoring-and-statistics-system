/**
 * Extension Heartbeat Controller
 * 接收瀏覽器擴充功能發送的觀看心跳
 *
 * P0 Security: Now uses dedicated JWT authentication instead of raw viewerId
 */

import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import { prisma } from "../../db/prisma";
import { logger } from "../../utils/logger";
import { cacheManager } from "../../utils/cache-manager";
import { signExtensionToken, verifyAccessToken } from "../auth/jwt.utils";
import type { ExtensionAuthRequest } from "./extension.middleware";
import { getViewerAuthSnapshotById } from "../viewer/viewer-auth-snapshot.service";

interface HeartbeatBody {
  channelName: string;
  timestamp: string;
  duration: number; // seconds
}

interface PendingHeartbeat {
  dedupKey: string;
  viewerId: string;
  channelId: string;
  heartbeatTimestamp: Date;
  date: Date;
  watchSeconds: number;
  lastWatchedAt: Date;
}

const CHANNEL_ID_CACHE_TTL_MS = 5 * 60 * 1000;
const channelIdCache = new Map<string, { channelId: string; expiresAt: number }>();
const heartbeatDedupCache = new Map<string, number>();
const HEARTBEAT_FLUSH_INTERVAL_MS = Number(process.env.HEARTBEAT_FLUSH_INTERVAL_MS || 5000);
const HEARTBEAT_FLUSH_BATCH_SIZE = Number(process.env.HEARTBEAT_FLUSH_BATCH_SIZE || 200);
const HEARTBEAT_DEDUP_TTL_MS = Number(process.env.HEARTBEAT_DEDUP_TTL_MS || 5 * 60 * 1000);
const HEARTBEAT_DEDUP_MAX_CACHE_SIZE = Number(
  process.env.HEARTBEAT_DEDUP_MAX_CACHE_SIZE || 20000
);
const HEARTBEAT_DEDUP_CLEANUP_INTERVAL_MS = Number(
  process.env.HEARTBEAT_DEDUP_CLEANUP_INTERVAL_MS || 60000
);
const heartbeatBuffer = new Map<string, PendingHeartbeat>();
let heartbeatFlushTimer: NodeJS.Timeout | null = null;
let isHeartbeatFlushing = false;
let heartbeatDedupCleanupTimer: NodeJS.Timeout | null = null;
let heartbeatFlushFailureCount = 0;

function buildHeartbeatKey(viewerId: string, channelId: string, date: Date): string {
  return `${viewerId}:${channelId}:${date.toISOString().slice(0, 10)}`;
}

function buildHeartbeatDedupKey(
  viewerId: string,
  channelId: string,
  timestamp: string,
  duration: number
): string {
  return `${viewerId}:${channelId}:${timestamp}:${duration}`;
}

function isDuplicateHeartbeat(dedupKey: string): boolean {
  const now = Date.now();

  const existing = heartbeatDedupCache.get(dedupKey);
  if (existing && existing > now) {
    return true;
  }

  if (heartbeatDedupCache.size >= HEARTBEAT_DEDUP_MAX_CACHE_SIZE) {
    cleanupExpiredHeartbeatDedupCache(now);
    if (heartbeatDedupCache.size >= HEARTBEAT_DEDUP_MAX_CACHE_SIZE) {
      const oldestKey = heartbeatDedupCache.keys().next().value;
      if (oldestKey) {
        heartbeatDedupCache.delete(oldestKey);
      }
    }
  }

  heartbeatDedupCache.set(dedupKey, now + HEARTBEAT_DEDUP_TTL_MS);
  return false;
}

function cleanupExpiredHeartbeatDedupCache(now: number = Date.now()): void {
  for (const [key, expiresAt] of heartbeatDedupCache) {
    if (expiresAt <= now) {
      heartbeatDedupCache.delete(key);
    }
  }
}

function ensureHeartbeatDedupCleanupTimer(): void {
  if (heartbeatDedupCleanupTimer) {
    return;
  }

  heartbeatDedupCleanupTimer = setInterval(() => {
    cleanupExpiredHeartbeatDedupCache();
  }, HEARTBEAT_DEDUP_CLEANUP_INTERVAL_MS);
  heartbeatDedupCleanupTimer.unref?.();
}

function scheduleHeartbeatFlush(): void {
  ensureHeartbeatDedupCleanupTimer();

  if (heartbeatFlushTimer) {
    return;
  }

  const retryMultiplier = Math.min(1 << Math.min(heartbeatFlushFailureCount, 5), 32);
  const delayMs = HEARTBEAT_FLUSH_INTERVAL_MS * retryMultiplier;

  heartbeatFlushTimer = setTimeout(() => {
    heartbeatFlushTimer = null;
    void flushHeartbeatBuffer();
  }, delayMs);

  heartbeatFlushTimer.unref?.();
}

async function flushHeartbeatBuffer(): Promise<void> {
  if (isHeartbeatFlushing || heartbeatBuffer.size === 0) {
    return;
  }

  isHeartbeatFlushing = true;
  let entries: Array<[string, PendingHeartbeat]> = [];
  try {
    entries = Array.from(heartbeatBuffer.entries()).slice(0, HEARTBEAT_FLUSH_BATCH_SIZE);
    for (const [key] of entries) {
      heartbeatBuffer.delete(key);
    }

    const allPending = entries.map(([, pending]) => pending);

    // 階段 1: 嘗試 dedup 過濾（非關鍵路徑，失敗時跳過 dedup 處理所有心跳）
    let accepted: PendingHeartbeat[] = allPending;
    try {
      const pendingByDedupKey = new Map(allPending.map((p) => [p.dedupKey, p]));
      const dedupInsertRows = allPending.map((pending) =>
        Prisma.sql`(${randomUUID()}, ${pending.dedupKey}, ${pending.viewerId}, ${pending.channelId}, ${
          pending.heartbeatTimestamp
        }, ${pending.watchSeconds})`
      );

      const insertedRows = await prisma.$queryRaw<Array<{ dedupKey: string }>>(Prisma.sql`
        INSERT INTO extension_heartbeat_dedups
          (id, dedupKey, viewerId, channelId, heartbeatTimestamp, durationSeconds)
        VALUES ${Prisma.join(dedupInsertRows)}
        ON CONFLICT(dedupKey) DO NOTHING
        RETURNING dedupKey
      `);

      accepted = insertedRows
        .map((row) => pendingByDedupKey.get(row.dedupKey))
        .filter((pending): pending is PendingHeartbeat => !!pending);
    } catch (dedupError) {
      // dedup 表可能不存在或 RETURNING 不被支援，跳過 dedup 直接處理所有心跳
      logger.warn(
        "EXTENSION",
        `Heartbeat dedup check failed (processing all ${allPending.length} heartbeats without dedup)`,
        dedupError
      );
    }

    if (accepted.length === 0) {
      heartbeatFlushFailureCount = 0;
      isHeartbeatFlushing = false;
      if (heartbeatBuffer.size > 0) {
        scheduleHeartbeatFlush();
      }
      return;
    }

    // 階段 2: 聚合並寫入觀看時間（關鍵路徑）
    const aggregatedByDay = new Map<string, PendingHeartbeat>();

    for (const pending of accepted) {
      const heartbeatKey = buildHeartbeatKey(pending.viewerId, pending.channelId, pending.date);
      const existing = aggregatedByDay.get(heartbeatKey);

      if (existing) {
        existing.watchSeconds += pending.watchSeconds;
        if (pending.lastWatchedAt > existing.lastWatchedAt) {
          existing.lastWatchedAt = pending.lastWatchedAt;
        }
      } else {
        aggregatedByDay.set(heartbeatKey, {
          ...pending,
        });
      }
    }

    const aggregated = Array.from(aggregatedByDay.values());
    const dailyRows = aggregated.map((pending) =>
      Prisma.sql`(${randomUUID()}, ${pending.viewerId}, ${pending.channelId}, ${pending.date}, ${
        pending.watchSeconds
      }, ${new Date()})`
    );
    const lifetimeRows = aggregated.map((pending) =>
      Prisma.sql`(${pending.viewerId}, ${pending.channelId}, ${pending.lastWatchedAt}, ${pending.watchSeconds})`
    );

    const acceptedHeartbeats = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO viewer_channel_daily_stats
          (id, viewerId, channelId, date, watchSeconds, updatedAt)
        VALUES ${Prisma.join(dailyRows)}
        ON CONFLICT(viewerId, channelId, date) DO UPDATE SET
          watchSeconds = viewer_channel_daily_stats.watchSeconds + excluded.watchSeconds,
          updatedAt = excluded.updatedAt
      `);

      await tx.$executeRaw(Prisma.sql`
        WITH src (viewerId, channelId, lastWatchedAt, watchSeconds) AS (
          VALUES ${Prisma.join(lifetimeRows)}
        )
        INSERT INTO viewer_channel_lifetime_stats (
          id, viewerId, channelId, lastWatchedAt, totalWatchTimeMinutes,
          totalSessions, avgSessionMinutes, firstWatchedAt,
          totalMessages, totalChatMessages, totalSubscriptions, totalCheers, totalBits,
          trackingStartedAt, trackingDays, longestStreakDays, currentStreakDays,
          activeDaysLast30, activeDaysLast90, mostActiveMonthCount,
          createdAt, updatedAt
        )
        SELECT
          lower(hex(randomblob(16))) AS id,
          src.viewerId,
          src.channelId,
          src.lastWatchedAt,
          CAST(ROUND(src.watchSeconds / 60.0) AS INTEGER),
          0, 0, src.lastWatchedAt,
          0, 0, 0, 0, 0,
          CURRENT_TIMESTAMP, 0, 0, 0,
          0, 0, 0,
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        FROM src
        ON CONFLICT(viewerId, channelId) DO UPDATE SET
          lastWatchedAt = CASE
            WHEN excluded.lastWatchedAt > viewer_channel_lifetime_stats.lastWatchedAt
              THEN excluded.lastWatchedAt
            ELSE viewer_channel_lifetime_stats.lastWatchedAt
          END,
          totalWatchTimeMinutes =
            viewer_channel_lifetime_stats.totalWatchTimeMinutes + excluded.totalWatchTimeMinutes,
          updatedAt = CURRENT_TIMESTAMP
      `);

      return accepted;
    });

    if (acceptedHeartbeats.length === 0) {
      heartbeatFlushFailureCount = 0;
      return;
    }

    const affectedViewerIds = Array.from(
      new Set(acceptedHeartbeats.map((heartbeat) => heartbeat.viewerId))
    );
    for (const viewerId of affectedViewerIds) {
      cacheManager.delete(`viewer:${viewerId}:channels_list`);
    }

    heartbeatFlushFailureCount = 0;
  } catch (error) {
    heartbeatFlushFailureCount += 1;
    for (const [key, pending] of entries) {
      if (!heartbeatBuffer.has(key)) {
        heartbeatBuffer.set(key, pending);
      }
    }
    logger.error("EXTENSION", "Flush heartbeat buffer failed", error);
  } finally {
    isHeartbeatFlushing = false;
    if (heartbeatBuffer.size > 0) {
      scheduleHeartbeatFlush();
    }
  }
}

async function getCachedChannelId(channelName: string): Promise<string | null> {
  const normalized = channelName.toLowerCase();
  const cached = channelIdCache.get(normalized);
  const now = Date.now();

  if (cached && cached.expiresAt > now) {
    return cached.channelId;
  }

  const channel = await prisma.channel.findFirst({
    where: {
      channelName: normalized,
    },
    select: {
      id: true,
    },
  });

  if (!channel) {
    channelIdCache.delete(normalized);
    return null;
  }

  channelIdCache.set(normalized, {
    channelId: channel.id,
    expiresAt: now + CHANNEL_ID_CACHE_TTL_MS,
  });

  return channel.id;
}

/**
 * POST /api/extension/token
 * Generate a dedicated extension JWT token for authenticated users
 * Requires: auth_token cookie (normal authentication)
 */
export async function getExtensionTokenHandler(req: Request, res: Response): Promise<void> {
  try {
    // Get auth token from cookie
    const authToken = req.cookies?.auth_token;
    if (!authToken) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    // Verify the access token
    const payload = verifyAccessToken(authToken);
    if (!payload || !payload.viewerId) {
      res.status(401).json({ error: "Invalid session" });
      return;
    }

    // Verify viewer exists and get tokenVersion
    const viewer = await getViewerAuthSnapshotById(payload.viewerId);

    if (!viewer) {
      res.status(401).json({ error: "Viewer not found" });
      return;
    }

    // P1 Fix: Generate dedicated extension JWT with tokenVersion (1 hour expiry)
    const extensionToken = signExtensionToken(payload.viewerId, viewer.tokenVersion);

    logger.info("EXTENSION", `Generated extension token for viewer: ${payload.viewerId}`);

    res.json({
      token: extensionToken,
      expiresIn: 3600, // 1 hour in seconds
    });
  } catch (error) {
    logger.error("EXTENSION", "Token generation error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
}

/**
 * POST /api/extension/heartbeat
 * P0 Security: Now uses ExtensionAuthRequest with JWT-verified viewerId
 */
export async function postHeartbeatHandler(req: ExtensionAuthRequest, res: Response): Promise<void> {
  try {
    // P0 Security: viewerId is now extracted from JWT by middleware
    const viewerId = req.extensionUser?.viewerId;
    if (!viewerId) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    const body = req.body as HeartbeatBody;
    const { channelName, duration, timestamp } = body;

    if (!channelName || !duration || !timestamp) {
      res.status(400).json({ error: "Missing channelName, timestamp or duration" });
      return;
    }

    // 查找頻道
    const channelId = await getCachedChannelId(channelName);

    if (!channelId) {
      logger.debug("EXTENSION", `Channel not found: ${channelName}`);
      res.json({ success: true, message: "Channel not tracked" });
      return;
    }

    const dedupKey = buildHeartbeatDedupKey(viewerId, channelId, timestamp, duration);
    if (isDuplicateHeartbeat(dedupKey)) {
      res.json({ success: true, deduped: true });
      return;
    }

    const heartbeatTimestamp = new Date(timestamp);
    if (Number.isNaN(heartbeatTimestamp.getTime())) {
      res.status(400).json({ error: "Invalid timestamp format" });
      return;
    }

    // 更新每日統計
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const heartbeatKey = dedupKey;
    const existing = heartbeatBuffer.get(heartbeatKey);
    if (existing) {
      existing.lastWatchedAt = new Date();
      res.json({ success: true, deduped: true });
      return;
    } else {
      heartbeatBuffer.set(heartbeatKey, {
        dedupKey,
        viewerId,
        channelId,
        heartbeatTimestamp,
        date: today,
        watchSeconds: duration,
        lastWatchedAt: new Date(),
      });
    }

    scheduleHeartbeatFlush();

    logger.info(
      "EXTENSION",
      `Heartbeat: viewer=${viewerId}, channel=${channelName}, duration=${duration}s`
    );

    res.json({ success: true });
  } catch (error) {
    logger.error("EXTENSION", "Heartbeat error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
}
