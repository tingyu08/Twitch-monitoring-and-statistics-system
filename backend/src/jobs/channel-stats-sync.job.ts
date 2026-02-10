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

// P1 Fix: 每小時第 10 分鐘執行（錯開 syncUserFollowsJob 的整點執行）
const CHANNEL_STATS_CRON = process.env.CHANNEL_STATS_CRON || "35 * * * *";

// P0 Fix: 加入批次處理配置
const BATCH_SIZE = 20;
const BATCH_DELAY_MS = 500; // 每批次間隔 500ms

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
        where: { isMonitored: true },
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

      // P0 Fix: 批次查詢所有活躍的 StreamSession，避免 N+1 查詢
      const channelIds = channels.map((c) => c.id);
      const activeSessions = await prisma.streamSession.findMany({
        where: {
          channelId: { in: channelIds },
          endedAt: null,
        },
        orderBy: { startedAt: "desc" },
        select: {
          id: true,
          channelId: true,
          peakViewers: true,
          avgViewers: true,
        },
      });
      const activeSessionMap = new Map(activeSessions.map((s) => [s.channelId, s]));

      // P0 Fix: 使用批次處理同步頻道統計
      for (let i = 0; i < channels.length; i += BATCH_SIZE) {
        const batch = channels.slice(i, i + BATCH_SIZE);
        
        const batchResults = await Promise.all(
          batch.map(async (channel) => {
            try {
              await this.syncChannelStats(channel, activeSessionMap);
              return { ok: true as const };
            } catch (error) {
              logger.error("ChannelStatsSync", `Failed to sync channel ${channel.channelName}:`, error);
              return { ok: false as const };
            }
          })
        );

        result.synced += batchResults.filter((r) => r.ok).length;
        result.failed += batchResults.filter((r) => !r.ok).length;

        // P0 Fix: 批次間延遲，避免壓垮資料庫和 API
        if (i + BATCH_SIZE < channels.length) {
          await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
        }
      }

      // Update daily stats
      result.dailyStatsUpdated = await this.updateDailyStats();

      // 優化日誌：避免 "failed" 關鍵字導致日誌顯示為紅色
      const summary = result.failed > 0
        ? `Job completed: ${result.synced} synced, ${result.failed} errors, ${result.dailyStatsUpdated} daily stats updated`
        : `Job completed: ${result.synced} synced, ${result.dailyStatsUpdated} daily stats updated`;

      logger.info("ChannelStatsSync", summary);

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
   * P0 Fix: 加入 activeSessionMap 參數，避免 N+1 查詢
   */
  private async syncChannelStats(
    channel: {
      id: string;
      channelName: string;
      twitchChannelId: string;
    },
    activeSessionMap: Map<string, {
      id: string;
      channelId: string;
      peakViewers: number | null;
      avgViewers: number | null;
    }>
  ): Promise<void> {
    // 使用 twitchChannelId 查詢（ID 永不改變，避免用戶改名後找不到）
    const channelInfo = await unifiedTwitchService.getChannelInfoById(channel.twitchChannelId);

    if (!channelInfo) {
      logger.warn("ChannelStatsSync", `Could not get channel info for ID: ${channel.twitchChannelId} (${channel.channelName})`);
      return;
    }

    // 如果頻道名稱有變更，更新資料庫
    if (channelInfo.login !== channel.channelName) {
      logger.info("ChannelStatsSync", `Channel renamed: ${channel.channelName} -> ${channelInfo.login}`);
      await prisma.channel.update({
        where: { id: channel.id },
        data: { channelName: channelInfo.login },
      });
    }

    // If live, update active session
    if (channelInfo.isLive) {
      // P0 Fix: 使用預先查詢的 Map 取代迴圈內查詢
      const activeSession = activeSessionMap.get(channel.id);

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

  }

  /**
   * Update/Create daily stats
   */
  private async updateDailyStats(): Promise<number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

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

    // Update or create daily stats (parallel batch)
    const entries = Array.from(channelStats.entries());
    let updated = 0;

    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
      const batch = entries.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(async ([channelId, stats]) => {
          const avgViewers =
            stats.streamCount > 0 ? Math.round(stats.totalViewers / stats.streamCount) : null;

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
        })
      );
      updated += batch.length;
    }

    return updated;
  }
}

// 匯出單例
export const channelStatsSyncJob = new ChannelStatsSyncJob();
