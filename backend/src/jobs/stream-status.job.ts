/**
 * Stream Status Job
 * 定時檢查實況主開播狀態並更新資料庫
 *
 * Story 3.3: 定時資料抓取與 EventSub 整合
 */

import cron from "node-cron";
import { prisma } from "../db/prisma";
import { unifiedTwitchService } from "../services/unified-twitch.service";

// 每 5 分鐘執行
const STREAM_STATUS_CRON = process.env.STREAM_STATUS_CRON || "*/5 * * * *";

// Twitch API 單次查詢最大頻道數
const MAX_CHANNELS_PER_BATCH = 100;

export interface StreamStatusResult {
  checked: number;
  online: number;
  offline: number;
  newSessions: number;
  endedSessions: number;
}

export class StreamStatusJob {
  private isRunning = false;

  /**
   * 啟動 Cron Job
   */
  start(): void {
    console.log(`📡 Stream Status Job 已排程: ${STREAM_STATUS_CRON}`);

    cron.schedule(STREAM_STATUS_CRON, async () => {
      await this.execute();
    });
  }

  /**
   * 執行開播狀態檢查
   */
  async execute(): Promise<StreamStatusResult> {
    if (this.isRunning) {
      console.log("⚠️ Stream Status Job 正在執行中，跳過...");
      return {
        checked: 0,
        online: 0,
        offline: 0,
        newSessions: 0,
        endedSessions: 0,
      };
    }

    this.isRunning = true;
    console.log("📡 開始檢查開播狀態...");

    const result: StreamStatusResult = {
      checked: 0,
      online: 0,
      offline: 0,
      newSessions: 0,
      endedSessions: 0,
    };

    try {
      // 1. 獲取所有需要監控的頻道
      const channels = await this.getActiveChannels();
      result.checked = channels.length;

      if (channels.length === 0) {
        console.log("ℹ️ 沒有需要監控的頻道");
        return result;
      }

      // 2. 批次查詢開播狀態
      const twitchChannelIds = channels.map((c) => c.twitchChannelId);
      const liveStreams = await this.fetchStreamStatuses(twitchChannelIds);

      // 建立 lookup map
      const liveStreamMap = new Map(liveStreams.map((s) => [s.userId, s]));

      // 3. 處理每個頻道的狀態變化
      for (const channel of channels) {
        const stream = liveStreamMap.get(channel.twitchChannelId);
        const isLive = !!stream;

        // 檢查是否有進行中的 session
        const activeSession = await prisma.streamSession.findFirst({
          where: {
            channelId: channel.id,
            endedAt: null,
          },
          orderBy: { startedAt: "desc" },
        });

        if (isLive && stream && !activeSession) {
          // 新開播：建立 session
          await this.createStreamSession(channel, stream);
          result.newSessions++;
          result.online++;
        } else if (isLive && stream && activeSession) {
          // 持續開播：更新 session 資訊
          await this.updateStreamSession(activeSession.id, stream);
          result.online++;
        } else if (!isLive && activeSession) {
          // 已下播：結束 session
          await this.endStreamSession(activeSession.id);
          result.endedSessions++;
          result.offline++;
        } else {
          // 未開播且無進行中 session
          result.offline++;
        }
      }

      console.log(
        `✅ Stream Status Job 完成: ${result.online} 開播, ${result.offline} 離線, ${result.newSessions} 新場次, ${result.endedSessions} 結束場次`
      );

      return result;
    } catch (error) {
      console.error("❌ Stream Status Job 執行失敗:", error);
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * 獲取所有需要監控的頻道
   * Story 3.6: 現在包含 platform 與 external 頻道，只要 isMonitored=true
   */
  private async getActiveChannels() {
    return prisma.channel.findMany({
      where: {
        isMonitored: true,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      select: {
        id: true,
        twitchChannelId: true,
        channelName: true,
      },
    });
  }

  /**
   * 批次查詢開播狀態
   */
  private async fetchStreamStatuses(twitchChannelIds: string[]) {
    const allStreams: Array<{
      id: string;
      userId: string;
      userName: string;
      title: string;
      gameName: string;
      viewerCount: number;
      startedAt: Date;
    }> = [];

    // 分批查詢 (每批最多 100 個)
    for (let i = 0; i < twitchChannelIds.length; i += MAX_CHANNELS_PER_BATCH) {
      const batch = twitchChannelIds.slice(i, i + MAX_CHANNELS_PER_BATCH);

      try {
        const streams = await unifiedTwitchService.getStreamsByUserIds(batch);
        allStreams.push(...streams);
      } catch (error) {
        console.error(`❌ 批次查詢失敗 (${i}-${i + batch.length}):`, error);
        // 繼續處理下一批
      }
    }

    return allStreams;
  }

  /**
   * 建立新的 StreamSession
   */
  private async createStreamSession(
    channel: { id: string; channelName: string },
    stream: {
      id: string;
      title: string;
      gameName: string;
      viewerCount: number;
      startedAt: Date;
    }
  ): Promise<void> {
    await prisma.streamSession.create({
      data: {
        channelId: channel.id,
        twitchStreamId: stream.id,
        startedAt: stream.startedAt,
        title: stream.title,
        category: stream.gameName,
        avgViewers: stream.viewerCount,
        peakViewers: stream.viewerCount,
      },
    });

    console.log(`🔴 新開播: ${channel.channelName} - ${stream.title}`);
  }

  /**
   * 更新進行中的 StreamSession
   */
  private async updateStreamSession(
    sessionId: string,
    stream: {
      title: string;
      gameName: string;
      viewerCount: number;
    }
  ): Promise<void> {
    const session = await prisma.streamSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) return;

    // 更新 peak viewers
    const newPeak = Math.max(session.peakViewers || 0, stream.viewerCount);

    // 計算平均觀看人數 (簡化版：移動平均)
    const currentAvg = session.avgViewers || stream.viewerCount;
    const newAvg = Math.round((currentAvg + stream.viewerCount) / 2);

    await prisma.streamSession.update({
      where: { id: sessionId },
      data: {
        title: stream.title,
        category: stream.gameName,
        avgViewers: newAvg,
        peakViewers: newPeak,
      },
    });
  }

  /**
   * 結束 StreamSession
   */
  private async endStreamSession(sessionId: string): Promise<void> {
    const session = await prisma.streamSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) return;

    const endedAt = new Date();
    const durationSeconds = Math.floor(
      (endedAt.getTime() - session.startedAt.getTime()) / 1000
    );

    await prisma.streamSession.update({
      where: { id: sessionId },
      data: {
        endedAt,
        durationSeconds,
      },
    });

    console.log(
      `⚫ 下播: Session ${sessionId} (${Math.floor(durationSeconds / 60)} 分鐘)`
    );
  }
}

// 匯出單例
export const streamStatusJob = new StreamStatusJob();
