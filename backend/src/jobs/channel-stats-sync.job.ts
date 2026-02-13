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
import { captureJobError } from "./job-error-tracker";
import { runWithWriteGuard } from "./job-write-guard";

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

      // P0 Fix: 使用批次處理同步頻道統計
      for (let i = 0; i < channels.length; i += BATCH_SIZE) {
        const batch = channels.slice(i, i + BATCH_SIZE);
        const channelInfoByTwitchId = await unifiedTwitchService.getChannelInfoByIds(
          batch.map((channel) => channel.twitchChannelId)
        );
        
        const batchResults = await Promise.all(
          batch.map(async (channel) => {
            try {
              await this.syncChannelStats(
                channel,
                channelInfoByTwitchId.get(channel.twitchChannelId) || null
              );
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
      captureJobError("channel-stats-sync", error);
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
    channelInfo: {
      login: string;
      isLive: boolean;
      streamTitle?: string;
      currentGame?: string;
    } | null
  ): Promise<void> {
    if (!channelInfo) {
      logger.warn("ChannelStatsSync", `Could not get channel info for ID: ${channel.twitchChannelId} (${channel.channelName})`);
      return;
    }

    // 如果頻道名稱有變更，更新資料庫
    if (channelInfo.login !== channel.channelName) {
      logger.info("ChannelStatsSync", `Channel renamed: ${channel.channelName} -> ${channelInfo.login}`);
      await runWithWriteGuard("channel-stats-sync:rename-channel", () =>
        prisma.channel.update({
          where: { id: channel.id },
          data: { channelName: channelInfo.login },
        })
      );
    }

    // Session title/category 寫入已收斂至 stream-status/EventSub 權威路徑。
  }

  /**
   * Update/Create daily stats
   */
  private async updateDailyStats(): Promise<number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let groupedStats: Array<{
      channelId: string;
      _sum: { durationSeconds: number | null; avgViewers: number | null };
      _max: { peakViewers: number | null };
      _count: { _all: number };
    }> = [];

    if (typeof prisma.streamSession.groupBy === "function") {
      // 直接在 DB 端聚合，避免將所有 session 拉回應用層做 JS 分組
      const groupedStatsRaw = await prisma.streamSession.groupBy({
        by: ["channelId"],
        where: {
          startedAt: { gte: today },
          endedAt: { not: null },
        },
        _sum: {
          durationSeconds: true,
          avgViewers: true,
        },
        _max: {
          peakViewers: true,
        },
        _count: {
          _all: true,
        },
      });

      groupedStats = groupedStatsRaw.map((row) => ({
        channelId: row.channelId,
        _sum: {
          durationSeconds: row._sum.durationSeconds ?? null,
          avgViewers: row._sum.avgViewers ?? null,
        },
        _max: {
          peakViewers: row._max.peakViewers ?? null,
        },
        _count: {
          _all: row._count._all,
        },
      }));
    } else {
      // 測試 mock 或舊 client fallback：維持相容性
      const sessions = await prisma.streamSession.findMany({
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

      const aggMap = new Map<
        string,
        { durationSeconds: number; avgViewersSum: number; peakViewers: number; count: number }
      >();

      for (const session of sessions) {
        const current = aggMap.get(session.channelId) || {
          durationSeconds: 0,
          avgViewersSum: 0,
          peakViewers: 0,
          count: 0,
        };

        current.durationSeconds += session.durationSeconds || 0;
        current.avgViewersSum += session.avgViewers || 0;
        current.peakViewers = Math.max(current.peakViewers, session.peakViewers || 0);
        current.count += 1;

        aggMap.set(session.channelId, current);
      }

      groupedStats = Array.from(aggMap.entries()).map(([channelId, value]) => ({
        channelId,
        _sum: {
          durationSeconds: value.durationSeconds,
          avgViewers: value.avgViewersSum,
        },
        _max: {
          peakViewers: value.peakViewers,
        },
        _count: {
          _all: value.count,
        },
      }));
    }

    // Update or create daily stats (parallel batch)
    const entries = groupedStats;
    let updated = 0;

    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
      const batch = entries.slice(i, i + BATCH_SIZE);
      await runWithWriteGuard("channel-stats-sync:daily-stats-upsert", () =>
        Promise.all(
          batch.map(async (stats) => {
            const avgViewers =
              stats._count._all > 0
                ? Math.round((stats._sum.avgViewers ?? 0) / stats._count._all)
                : null;

            await prisma.channelDailyStat.upsert({
              where: {
                channelId_date: {
                  channelId: stats.channelId,
                  date: today,
                },
              },
              create: {
                channelId: stats.channelId,
                date: today,
                streamSeconds: stats._sum.durationSeconds ?? 0,
                streamCount: stats._count._all,
                avgViewers,
                peakViewers: stats._max.peakViewers ?? 0,
              },
              update: {
                streamSeconds: stats._sum.durationSeconds ?? 0,
                streamCount: stats._count._all,
                avgViewers,
                peakViewers: stats._max.peakViewers ?? 0,
              },
            });
          })
        )
      );
      updated += batch.length;
    }

    return updated;
  }
}

// 匯出單例
export const channelStatsSyncJob = new ChannelStatsSyncJob();
