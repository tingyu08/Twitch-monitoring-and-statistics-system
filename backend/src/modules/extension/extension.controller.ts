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

interface HeartbeatBody {
  channelName: string;
  timestamp: string;
  duration: number; // seconds
}

const CHANNEL_ID_CACHE_TTL_MS = 5 * 60 * 1000;
const channelIdCache = new Map<string, { channelId: string; expiresAt: number }>();

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
    const viewer = await prisma.viewer.findUnique({
      where: { id: payload.viewerId },
      select: { id: true, tokenVersion: true },
    });

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

    const dailyStatPromise = prisma.viewerChannelDailyStat.upsert({
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
        watchSeconds: duration,
      },
      update: {
        watchSeconds: { increment: duration },
      },
    });

    // 更新生命週期統計的 lastWatchedAt
    const lifetimeStatsPromise = prisma.viewerChannelLifetimeStats.upsert({
      where: {
        viewerId_channelId: {
          viewerId,
          channelId,
        },
      },
      create: {
        viewerId,
        channelId,
        lastWatchedAt: new Date(),
        totalWatchTimeMinutes: Math.floor(duration / 60),
      },
      update: {
        lastWatchedAt: new Date(),
        totalWatchTimeMinutes: { increment: Math.floor(duration / 60) },
      },
    });

    await Promise.all([dailyStatPromise, lifetimeStatsPromise]);

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
