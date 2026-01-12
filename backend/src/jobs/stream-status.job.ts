/**
 * Stream Status Job
 * 定時檢查實況主開播狀態並更新資料庫
 *
 * Story 3.3: 定時資料抓取與 EventSub 整合
 */

import cron from "node-cron";
import { prisma } from "../db/prisma";
import { unifiedTwitchService } from "../services/unified-twitch.service";

// 每 5 分鐘執行（第 0 秒觸發）
const STREAM_STATUS_CRON = process.env.STREAM_STATUS_CRON || "0 */5 * * * *";

// Twitch API 單次查詢最大頻道數
const MAX_CHANNELS_PER_BATCH = 100;

// 超時時間（毫秒）- 3 分鐘
const JOB_TIMEOUT_MS = 3 * 60 * 1000;

export interface StreamStatusResult {
  checked: number;
  online: number;
  offline: number;
  newSessions: number;
  endedSessions: number;
}

export class StreamStatusJob {
  private isRunning = false;
  private timeoutHandle: NodeJS.Timeout | null = null;

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
   * 執行開播狀態檢查（含超時機制）
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
    const startTime = Date.now();
    console.log("📡 開始檢查開播狀態...");

    // 設定超時保護
    const timeoutPromise = new Promise<never>((_, reject) => {
      this.timeoutHandle = setTimeout(() => {
        reject(new Error(`Job 超時 (>${JOB_TIMEOUT_MS / 1000}秒)`));
      }, JOB_TIMEOUT_MS);
    });

    const result: StreamStatusResult = {
      checked: 0,
      online: 0,
      offline: 0,
      newSessions: 0,
      endedSessions: 0,
    };

    try {
      // 使用 Promise.race 實現超時
      await Promise.race([this.doExecute(result), timeoutPromise]);

      const duration = Date.now() - startTime;
      console.log(
        `✅ Stream Status Job 完成 (${duration}ms): ${result.online} 開播, ${result.offline} 離線, ${result.newSessions} 新場次, ${result.endedSessions} 結束場次`
      );

      return result;
    } catch (error) {
      console.error("❌ Stream Status Job 執行失敗:", error);
      throw error;
    } finally {
      if (this.timeoutHandle) {
        clearTimeout(this.timeoutHandle);
        this.timeoutHandle = null;
      }
      this.isRunning = false;
    }
  }

  /**
   * 實際執行邏輯（優化版：批次查詢避免 N+1）
   */
  private async doExecute(result: StreamStatusResult): Promise<void> {
    // 1. 獲取所有需要監控的頻道
    const channels = await this.getActiveChannels();
    result.checked = channels.length;

    if (channels.length === 0) {
      console.log("ℹ️ 沒有需要監控的頻道");
      return;
    }

    // 2. 批次查詢開播狀態
    const twitchChannelIds = channels.map((c) => c.twitchChannelId);
    const liveStreams = await this.fetchStreamStatuses(twitchChannelIds);
    const liveStreamMap = new Map(liveStreams.map((s) => [s.userId, s]));

    // 診斷日誌：顯示監控頻道數和直播中頻道
    console.log(
      `📊 正在監控 ${channels.length} 個頻道，發現 ${liveStreams.length} 個直播中`
    );
    if (liveStreams.length > 0) {
      console.log(
        `🔴 直播中: ${liveStreams.map((s) => s.userName).join(", ")}`
      );
    }

    // 3. 【優化】一次查詢所有 active sessions，避免 N+1
    const channelIds = channels.map((c) => c.id);
    const activeSessions = await prisma.streamSession.findMany({
      where: {
        channelId: { in: channelIds },
        endedAt: null,
      },
    });
    const activeSessionMap = new Map(
      activeSessions.map((s) => [s.channelId, s])
    );

    // 4. 處理每個頻道的狀態變化
    for (const channel of channels) {
      const stream = liveStreamMap.get(channel.twitchChannelId);
      const isLive = !!stream;
      const activeSession = activeSessionMap.get(channel.id);

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
  }

  /**
   * 獲取所有需要監控的頻道
   * Story 3.6: 現在包含 platform 與 external 頻道，只要 isMonitored=true
   */
  private async getActiveChannels() {
    // 診斷：檢查總頻道數與監控頻道數
    const totalChannels = await prisma.channel.count();
    const monitoredChannels = await prisma.channel.count({
      where: { isMonitored: true },
    });
    console.log(
      `📊 頻道統計: 總共 ${totalChannels} 個頻道, 其中 ${monitoredChannels} 個正在監控`
    );

    return prisma.channel.findMany({
      where: {
        isMonitored: true,
      },
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
   * 建立新的 StreamSession（使用 upsert 防止重複）
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
    // 使用 upsert 防止 UNIQUE constraint 錯誤
    await prisma.streamSession.upsert({
      where: {
        twitchStreamId: stream.id,
      },
      create: {
        channelId: channel.id,
        twitchStreamId: stream.id,
        startedAt: stream.startedAt,
        title: stream.title,
        category: stream.gameName,
        avgViewers: stream.viewerCount,
        peakViewers: stream.viewerCount,
      },
      update: {
        // 如果已存在，更新資訊
        title: stream.title,
        category: stream.gameName,
        peakViewers: {
          // 只更新峰值如果當前更高
          set: stream.viewerCount,
        },
      },
    });

    // 新開播：同時記錄第一筆 StreamMetric (Realtime Viewer Data)
    // 我們需要先獲取這個 Session 的 ID (如果是新建的)
    const session = await prisma.streamSession.findUnique({
      where: { twitchStreamId: stream.id },
    });

    if (session) {
      await prisma.streamMetric.create({
        data: {
          streamSessionId: session.id,
          viewerCount: stream.viewerCount,
          timestamp: new Date(),
        },
      });
    }

    console.log(
      `🔴 新開播: ${channel.channelName} - ${stream.title} (Metric recorded)`
    );
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

    // 記錄真實每小時數據點 (StreamMetric)
    await prisma.streamMetric.create({
      data: {
        streamSessionId: sessionId,
        viewerCount: stream.viewerCount,
        timestamp: new Date(),
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
