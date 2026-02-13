/**
 * Extension Heartbeat Controller
 * 接收瀏覽器擴充功能發送的觀看心跳
 *
 * P0 Security: Now uses dedicated JWT authentication instead of raw viewerId
 */

import { Request, Response } from "express";
import { prisma } from "../../db/prisma";
import { logger } from "../../utils/logger";
import { signExtensionToken, verifyAccessToken } from "../auth/jwt.utils";
import type { ExtensionAuthRequest } from "./extension.middleware";
import { getViewerAuthSnapshotById } from "../viewer/viewer-auth-snapshot.service";

interface HeartbeatBody {
  channelName: string;
  timestamp: string;
  duration: number; // seconds
}

interface PendingHeartbeat {
  viewerId: string;
  channelId: string;
  date: Date;
  watchSeconds: number;
  minuteIncrements: number;
  lastWatchedAt: Date;
}

const CHANNEL_ID_CACHE_TTL_MS = 5 * 60 * 1000;
const channelIdCache = new Map<string, { channelId: string; expiresAt: number }>();
const HEARTBEAT_FLUSH_INTERVAL_MS = Number(process.env.HEARTBEAT_FLUSH_INTERVAL_MS || 5000);
const HEARTBEAT_FLUSH_BATCH_SIZE = Number(process.env.HEARTBEAT_FLUSH_BATCH_SIZE || 200);
const heartbeatBuffer = new Map<string, PendingHeartbeat>();
let heartbeatFlushTimer: NodeJS.Timeout | null = null;
let isHeartbeatFlushing = false;

function buildHeartbeatKey(viewerId: string, channelId: string, date: Date): string {
  return `${viewerId}:${channelId}:${date.toISOString().slice(0, 10)}`;
}

function scheduleHeartbeatFlush(): void {
  if (heartbeatFlushTimer) {
    return;
  }

  heartbeatFlushTimer = setTimeout(() => {
    heartbeatFlushTimer = null;
    void flushHeartbeatBuffer();
  }, HEARTBEAT_FLUSH_INTERVAL_MS);

  heartbeatFlushTimer.unref?.();
}

async function flushHeartbeatBuffer(): Promise<void> {
  if (isHeartbeatFlushing || heartbeatBuffer.size === 0) {
    return;
  }

  isHeartbeatFlushing = true;
  try {
    const entries = Array.from(heartbeatBuffer.entries()).slice(0, HEARTBEAT_FLUSH_BATCH_SIZE);
    for (const [key] of entries) {
      heartbeatBuffer.delete(key);
    }

    await Promise.all(
      entries.map(async ([, pending]) => {
        const dailyStatPromise = prisma.viewerChannelDailyStat.upsert({
          where: {
            viewerId_channelId_date: {
              viewerId: pending.viewerId,
              channelId: pending.channelId,
              date: pending.date,
            },
          },
          create: {
            viewerId: pending.viewerId,
            channelId: pending.channelId,
            date: pending.date,
            watchSeconds: pending.watchSeconds,
          },
          update: {
            watchSeconds: { increment: pending.watchSeconds },
          },
        });

        const lifetimeStatsPromise = prisma.viewerChannelLifetimeStats.upsert({
          where: {
            viewerId_channelId: {
              viewerId: pending.viewerId,
              channelId: pending.channelId,
            },
          },
          create: {
            viewerId: pending.viewerId,
            channelId: pending.channelId,
            lastWatchedAt: pending.lastWatchedAt,
            totalWatchTimeMinutes: pending.minuteIncrements,
          },
          update: {
            lastWatchedAt: pending.lastWatchedAt,
            totalWatchTimeMinutes: { increment: pending.minuteIncrements },
          },
        });

        await Promise.all([dailyStatPromise, lifetimeStatsPromise]);
      })
    );
  } catch (error) {
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
    const { channelName, duration } = body;

    if (!channelName || !duration) {
      res.status(400).json({ error: "Missing channelName or duration" });
      return;
    }

    // 查找頻道
    const channelId = await getCachedChannelId(channelName);

    if (!channelId) {
      logger.debug("EXTENSION", `Channel not found: ${channelName}`);
      res.json({ success: true, message: "Channel not tracked" });
      return;
    }

    // 更新每日統計
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const heartbeatKey = buildHeartbeatKey(viewerId, channelId, today);
    const existing = heartbeatBuffer.get(heartbeatKey);
    const minuteIncrements = Math.floor(duration / 60);

    if (existing) {
      existing.watchSeconds += duration;
      existing.minuteIncrements += minuteIncrements;
      existing.lastWatchedAt = new Date();
    } else {
      heartbeatBuffer.set(heartbeatKey, {
        viewerId,
        channelId,
        date: today,
        watchSeconds: duration,
        minuteIncrements,
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
