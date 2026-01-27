/**
 * Channel Stats Sync Job
 * 定時從 Twitch API 同步頻道統計數據
 *
 * Story 3.3: 定時資料抓取與 EventSub 整合
 */

import cron from "node-cron";
import { prisma } from "../db/prisma";
import { unifiedTwitchService } from "../services/unified-twitch.service";
import { logger } from "../utils/logger";

// 每小時同步一次 (作為 EventSub 的備援與數據補全)
const CHANNEL_STATS_CRON = process.env.CHANNEL_STATS_CRON || "0 * * * *";

export interface ChannelStatsSyncResult {
  synced: number;
  failed: number;
  dailyStatsUpdated: number;
}

export class ChannelStatsSyncJob {
  private isRunning = false;

  /**
   * Start Cron Job
   */
  start(): void {
    logger.info("ChannelStatsSync", `Job scheduled: ${CHANNEL_STATS_CRON}`);

    cron.schedule(CHANNEL_STATS_CRON, async () => {
      await this.execute();
    });
  }

  /**
   * Execute Channel Stats Sync
   */
  async execute(): Promise<ChannelStatsSyncResult> {
    if (this.isRunning) {
      logger.warn("ChannelStatsSync", "Job already running, skipping...");
      return { synced: 0, failed: 0, dailyStatsUpdated: 0 };
    }

    this.isRunning = true;
    logger.info("ChannelStatsSync", "Starting Channel Stats Sync...");

    const result: ChannelStatsSyncResult = {
      synced: 0,
      failed: 0,
      dailyStatsUpdated: 0,
    };

    try {
      // Get all channels
      const channels = await prisma.channel.findMany({
        select: {
          id: true,
          channelName: true,
          twitchChannelId: true,
        },
      });

      if (channels.length === 0) {
        logger.info("ChannelStatsSync", "No channels to sync");
        return result;
      }

      // Sync stats for each channel
      for (const channel of channels) {
        try {
          await this.syncChannelStats(channel);
          result.synced++;
        } catch (error) {
          logger.error("ChannelStatsSync", `Failed to sync channel ${channel.channelName}:`, error);
          result.failed++;
        }
      }

      // Update daily stats
      result.dailyStatsUpdated = await this.updateDailyStats();

      logger.info(
        "ChannelStatsSync",
        `Job done: ${result.synced} synced, ${result.failed} failed, ${result.dailyStatsUpdated} daily stats updated`
      );

      return result;
    } catch (error) {
      logger.error("ChannelStatsSync", "Job execution failed:", error);
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * 同步單一頻道的統計
   */
  private async syncChannelStats(channel: {
    id: string;
    channelName: string;
    twitchChannelId: string;
  }): Promise<void> {
    // Get channel info
    const channelInfo = await unifiedTwitchService.getChannelInfo(channel.channelName);

    if (!channelInfo) {
      logger.warn("ChannelStatsSync", `Could not get channel info: ${channel.channelName}`);
      return;
    }

    // If live, update active session
    if (channelInfo.isLive) {
      const activeSession = await prisma.streamSession.findFirst({
        where: {
          channelId: channel.id,
          endedAt: null,
        },
        orderBy: { startedAt: "desc" },
      });

      if (activeSession && channelInfo.viewerCount !== undefined) {
        // Update peak viewers
        const newPeak = Math.max(activeSession.peakViewers || 0, channelInfo.viewerCount);

        // Update avg viewers
        const currentAvg = activeSession.avgViewers || channelInfo.viewerCount;
        const newAvg = Math.round((currentAvg + channelInfo.viewerCount) / 2);

        await prisma.streamSession.update({
          where: { id: activeSession.id },
          data: {
            title: channelInfo.streamTitle,
            category: channelInfo.currentGame,
            avgViewers: newAvg,
            peakViewers: newPeak,
          },
        });
      }
    }

    // console.log(
    //   `INFO: Synced: ${channel.channelName} (${
    //     channelInfo.isLive ? "LIVE" : "OFFLINE"
    //   })`
    // );
  }

  /**
   * Update/Create daily stats
   */
  private async updateDailyStats(): Promise<number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // console.log("[DEBUG] updateDailyStats: Fetching sessions...");
    // Get all finished sessions for today
    const todaySessions = await prisma.streamSession.findMany({
      where: {
        startedAt: { gte: today },
        endedAt: { not: null },
      },
      select: {
        channelId: true,
        durationSeconds: true,
        avgViewers: true,
        peakViewers: true,
      },
    });

    // console.log(
    //   `[DEBUG] updateDailyStats found ${todaySessions.length} sessions.`
    // );

    // Group by channel
    const channelStats = new Map<
      string,
      {
        streamSeconds: number;
        streamCount: number;
        totalViewers: number;
        peakViewers: number;
      }
    >();

    for (const session of todaySessions) {
      // console.log(
      //   `[DEBUG] Processing session for channelId: ${session.channelId}`
      // );
      const existing = channelStats.get(session.channelId) || {
        streamSeconds: 0,
        streamCount: 0,
        totalViewers: 0,
        peakViewers: 0,
      };

      existing.streamSeconds += session.durationSeconds || 0;
      existing.streamCount += 1;
      existing.totalViewers += session.avgViewers || 0;
      existing.peakViewers = Math.max(existing.peakViewers, session.peakViewers || 0);

      channelStats.set(session.channelId, existing);
    }

    // Update or create daily stats
    let updated = 0;
    // console.log(`[DEBUG] Updating stats for ${channelStats.size} channels.`);
    for (const [channelId, stats] of channelStats) {
      const avgViewers =
        stats.streamCount > 0 ? Math.round(stats.totalViewers / stats.streamCount) : null;

      // console.log(`[DEBUG] Upserting stats for channel: ${channelId}`);
      await prisma.channelDailyStat.upsert({
        where: {
          channelId_date: {
            channelId,
            date: today,
          },
        },
        create: {
          channelId,
          date: today,
          streamSeconds: stats.streamSeconds,
          streamCount: stats.streamCount,
          avgViewers,
          peakViewers: stats.peakViewers,
        },
        update: {
          streamSeconds: stats.streamSeconds,
          streamCount: stats.streamCount,
          avgViewers,
          peakViewers: stats.peakViewers,
        },
      });
      updated++;
    }

    return updated;
  }
}

// 匯出單例
export const channelStatsSyncJob = new ChannelStatsSyncJob();
