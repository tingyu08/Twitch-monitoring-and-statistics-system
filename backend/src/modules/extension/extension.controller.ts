/**
 * Extension Heartbeat Controller
 * 接收瀏覽器擴充功能發送的觀看心跳
 */

import { Request, Response } from "express";
import { prisma } from "../../db/prisma";
import { logger } from "../../utils/logger";

interface HeartbeatBody {
  channelName: string;
  timestamp: string;
  duration: number; // seconds
}

/**
 * POST /api/extension/heartbeat
 * 接收並處理觀看心跳
 */
export async function postHeartbeatHandler(
  req: Request,
  res: Response
): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const viewerId = (req as any).userId as string | undefined;
    if (!viewerId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const body = req.body as HeartbeatBody;
    const { channelName, duration } = body;

    if (!channelName || !duration) {
      res.status(400).json({ error: "Missing channelName or duration" });
      return;
    }

    // 查找頻道
    const channel = await prisma.channel.findFirst({
      where: {
        channelName: channelName.toLowerCase(),
      },
    });

    if (!channel) {
      logger.debug("EXTENSION", `Channel not found: ${channelName}`);
      res.json({ success: true, message: "Channel not tracked" });
      return;
    }

    // 更新每日統計
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    await prisma.viewerChannelDailyStat.upsert({
      where: {
        viewerId_channelId_date: {
          viewerId,
          channelId: channel.id,
          date: today,
        },
      },
      create: {
        viewerId,
        channelId: channel.id,
        date: today,
        watchSeconds: duration,
      },
      update: {
        watchSeconds: { increment: duration },
      },
    });

    // 更新生命週期統計的 lastWatchedAt
    await prisma.viewerChannelLifetimeStats.upsert({
      where: {
        viewerId_channelId: {
          viewerId,
          channelId: channel.id,
        },
      },
      create: {
        viewerId,
        channelId: channel.id,
        lastWatchedAt: new Date(),
        totalWatchTimeMinutes: Math.floor(duration / 60),
      },
      update: {
        lastWatchedAt: new Date(),
        totalWatchTimeMinutes: { increment: Math.floor(duration / 60) },
      },
    });

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
