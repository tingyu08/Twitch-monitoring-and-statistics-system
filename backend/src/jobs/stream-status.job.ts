/**
 * Stream Status Job
 * 定時檢查實況主開播狀態並更新資料庫
 *
 * Story 3.3: 定時資料抓取與 EventSub 整合
 */

import cron from "node-cron";
import { prisma } from "../db/prisma";
import { unifiedTwitchService } from "../services/unified-twitch.service";
import { logger } from "../utils/logger";
import { memoryMonitor } from "../utils/memory-monitor";
import { captureJobError } from "./job-error-tracker";
import { runWithWriteGuard } from "./job-write-guard";

// 每 5 分鐘執行（第 0 秒觸發）
const STREAM_STATUS_CRON = process.env.STREAM_STATUS_CRON || "20 */5 * * * *";

// Twitch API 單次查詢最大頻道數
const MAX_CHANNELS_PER_BATCH = 100;

// P0-6: Active session 查詢批次大小
const SESSION_QUERY_BATCH_SIZE = 20;

// P0-6: 批次間休息時間
const BATCH_DELAY_MS = 1000;

// 超時時間（毫秒）- 優化：增加到 4 分鐘以處理大量頻道（286+）
const JOB_TIMEOUT_MS = 4 * 60 * 1000; // 4 分鐘

// 降低 stream_metrics 寫入頻率（預設每 10 分鐘採樣一次）
const METRIC_SAMPLE_MINUTES = Number(process.env.STREAM_METRIC_SAMPLE_MINUTES || 10);

// 避免循環依賴和類型錯誤，定義本地介面
interface MonitoredChannel {
  id: string;
  twitchChannelId: string;
  channelName: string;
}

interface ActiveStreamSession {
  id: string;
  channelId: string;
  startedAt: Date;
  avgViewers: number | null;
  peakViewers: number | null;
}

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
    logger.info("JOB", `Stream Status Job 已排程: ${STREAM_STATUS_CRON}`);

    cron.schedule(STREAM_STATUS_CRON, async () => {
      await this.execute();
    });
  }

  /**
   * 執行開播狀態檢查（含超時機制）
   */
  async execute(): Promise<StreamStatusResult> {
    if (this.isRunning) {
      logger.debug("JOB", "Stream Status Job 正在執行中，跳過...");
      return {
        checked: 0,
        online: 0,
        offline: 0,
        newSessions: 0,
        endedSessions: 0,
      };
    }

    // 記憶體檢查：如果記憶體不足，跳過此次執行
    if (memoryMonitor.isOverLimit()) {
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
    logger.debug("JOB", "開始檢查開播狀態...");

    const result: StreamStatusResult = {
      checked: 0,
      online: 0,
      offline: 0,
      newSessions: 0,
      endedSessions: 0,
    };

    // 設定超時保護 - 使用 AbortController 模式
    let timeoutTriggered = false;
    this.timeoutHandle = setTimeout(() => {
      timeoutTriggered = true;
    }, JOB_TIMEOUT_MS);

    try {
      await this.doExecute(result, () => timeoutTriggered);

      const duration = Date.now() - startTime;

      // 檢查是否因超時而提前結束
      if (timeoutTriggered) {
        logger.warn(
          "JOB",
          `Stream Status Job 超時 (${duration}ms, 已處理 ${result.checked} 個頻道)，將在下次執行時繼續`
        );
      } else if (result.newSessions > 0 || result.endedSessions > 0) {
        // 只在有新場次或結束場次時輸出 info
        logger.info(
          "JOB",
          `Stream Status Job 完成 (${duration}ms): ${result.online} 開播, ${result.offline} 離線, ${result.newSessions} 新場次, ${result.endedSessions} 結束場次`
        );
      } else {
        logger.debug(
          "JOB",
          `Stream Status Job 完成 (${duration}ms): ${result.online} 開播, ${result.offline} 離線`
        );
      }

      return result;
    } catch (error) {
      logger.error("JOB", "Stream Status Job 執行失敗:", error);
      captureJobError("stream-status", error);
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
   * 實際執行邏輯（優化版：並行處理 + 減少 DB 查詢）
   * @param result 結果物件
   * @param isTimedOut 檢查是否已超時的函數
   */
  private async doExecute(
    result: StreamStatusResult,
    isTimedOut: () => boolean = () => false
  ): Promise<void> {
    // 1. 資料庫連線檢查已移除
    // 理由：
    // - Turso 冷啟動可能需要 30-60 秒，健康檢查會頻繁超時
    // - 每個 Prisma 查詢都有自己的錯誤處理和重試機制
    // - 跳過健康檢查可減少不必要的等待時間
    // 如果 DB 真的無法連線，後續查詢會失敗並被捕獲

    // 2. 獲取所有需要監控的頻道
    const channels = await this.getActiveChannels();
    result.checked = channels.length;

    if (channels.length === 0) {
      logger.debug("JOB", "沒有需要監控的頻道");
      return;
    }

    // 3. 批次查詢開播狀態
    const twitchChannelIds = channels.map((c) => c.twitchChannelId);
    const liveStreams = await this.fetchStreamStatuses(twitchChannelIds);
    const liveStreamMap = new Map(liveStreams.map((s) => [s.userId, s]));

    logger.debug("JOB", `正在監控 ${channels.length} 個頻道，發現 ${liveStreams.length} 個直播中`);

    // 4. 分批查詢所有 active sessions
    const channelIds = channels.map((c) => c.id);
    const activeSessions = await this.fetchActiveSessions(channelIds);
    const activeSessionMap = new Map(activeSessions.map((s) => [s.channelId, s]));

    // 5. 處理每個頻道的狀態變化（並行處理，限制並發數）
    // 優化：並發上限可調，預設提升以降低排程延遲
    const envLimit = Number(process.env.STREAM_STATUS_CONCURRENCY_LIMIT);
    const defaultLimit = process.env.NODE_ENV === "production" ? 4 : 4;
    const CONCURRENCY_LIMIT = Number.isFinite(envLimit) && envLimit > 0 ? envLimit : defaultLimit;

    // 將任務分組進行並行處理
    const tasks = channels.map((channel) => async () => {
      // 檢查是否已超時
      if (isTimedOut()) return;

      const stream = liveStreamMap.get(channel.twitchChannelId);
      const isLive = !!stream;
      const activeSession = activeSessionMap.get(channel.id);

      try {
        if (isLive && stream && !activeSession) {
          // 新開播：建立 session
          await this.createStreamSession(channel, stream);
          result.newSessions++;
          result.online++;
        } else if (isLive && stream && activeSession) {
          // 持續開播：更新 session 資訊 (直接使用 activeSession 物件，不需再查詢)
          await this.updateStreamSession(activeSession, stream);
          result.online++;
        } else if (!isLive && activeSession) {
          // 已下播：結束 session (直接使用 activeSession 物件)
          await this.endStreamSession(activeSession);
          result.endedSessions++;
          result.offline++;
        } else {
          // 未開播且無進行中 session
          result.offline++;
        }
      } catch (err) {
        logger.error("JOB", `處理頻道 ${channel.channelName} 狀態失敗:`, err);
      }
    });

    // 執行並發控制
    await this.runWithConcurrency(tasks, CONCURRENCY_LIMIT);

    // 6. 清理大型物件以釋放記憶體
    liveStreamMap.clear();
    activeSessionMap.clear();

    // 7. 執行後觸發 GC（如果記憶體使用較高）
      if (memoryMonitor.isNearLimit() && global.gc) {
        global.gc();
      }
  }

  /**
   * 簡單的並發控制器
   */
  private async runWithConcurrency<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<void> {
    const results: Promise<T>[] = [];
    const executing = new Set<Promise<void>>();

    for (const task of tasks) {
      const p = Promise.resolve().then(task);
      results.push(p);

      if (limit <= tasks.length) {
        const wrapper = p.then(() => {
          executing.delete(wrapper);
        });
        executing.add(wrapper);

        if (executing.size >= limit) {
          await Promise.race(executing);
        }
      }
    }
    await Promise.all(results);
  }

  /**
   * 獲取所有需要監控的頻道
   */
  private async getActiveChannels(): Promise<MonitoredChannel[]> {
    const totalChannels = await prisma.channel.count();
    const monitoredChannels = await prisma.channel.count({
      where: { isMonitored: true },
    });

    // 只在 debug 模式顯示詳細統計
    if (process.env.NODE_ENV !== "production") {
      logger.debug(
        "JOB",
        `頻道統計: 總共 ${totalChannels} 個頻道, 其中 ${monitoredChannels} 個正在監控`
      );
    }

    return (await prisma.channel.findMany({
      where: { isMonitored: true },
      select: {
        id: true,
        twitchChannelId: true,
        channelName: true,
      },
    })) as MonitoredChannel[];
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
        logger.error("JOB", `批次查詢失敗 (${i}-${i + batch.length}):`, error);
      }

      // 記憶體/CPU 優化：僅在記憶體壓力高時短暫休息
      if (i + MAX_CHANNELS_PER_BATCH < twitchChannelIds.length && memoryMonitor.isNearLimit()) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }

    return allStreams;
  }

  /**
   * 分批查詢 active sessions（降低 DB 壓力）
   */
  private async fetchActiveSessions(channelIds: string[]): Promise<ActiveStreamSession[]> {
    const sessions: ActiveStreamSession[] = [];

    for (let i = 0; i < channelIds.length; i += SESSION_QUERY_BATCH_SIZE) {
      const batch = channelIds.slice(i, i + SESSION_QUERY_BATCH_SIZE);

      const batchSessions = (await prisma.streamSession.findMany({
        where: {
          channelId: { in: batch },
          endedAt: null,
        },
        select: {
          id: true,
          channelId: true,
          startedAt: true,
          avgViewers: true,
          peakViewers: true,
        },
      })) as ActiveStreamSession[];

      sessions.push(...batchSessions);

      if (i + SESSION_QUERY_BATCH_SIZE < channelIds.length) {
        await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
      }
    }

    return sessions;
  }

  /**
   * 建立新的 StreamSession（優化版：減少 DB 查詢）
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
    await runWithWriteGuard("stream-status:create-session", async () => {
      // Upsert 並直接返回結果
      const session = await prisma.streamSession.upsert({
        where: { twitchStreamId: stream.id },
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
          title: stream.title,
          category: stream.gameName,
          peakViewers: { set: stream.viewerCount },
        },
      });

      // 直接使用 session.id 建立 metric
      await prisma.streamMetric.create({
        data: {
          streamSessionId: session.id,
          viewerCount: stream.viewerCount,
          timestamp: new Date(),
        },
      });
    });

    logger.info("JOB", `新開播: ${channel.channelName} - ${stream.title}`);
  }

  /**
   * 更新進行中的 StreamSession（優化版：使用已有的 session 物件）
   */
  private async updateStreamSession(
    activeSession: { id: string; peakViewers: number | null; avgViewers: number | null },
    stream: {
      title: string;
      gameName: string;
      viewerCount: number;
    }
  ): Promise<void> {
    // 計算數值
    const newPeak = Math.max(activeSession.peakViewers || 0, stream.viewerCount);
    const currentAvg = activeSession.avgViewers || stream.viewerCount;
    const newAvg = Math.round((currentAvg + stream.viewerCount) / 2);

    await runWithWriteGuard("stream-status:update-session", async () => {
      // 直接更新
      await prisma.streamSession.update({
        where: { id: activeSession.id },
        data: {
          title: stream.title,
          category: stream.gameName,
          avgViewers: newAvg,
          peakViewers: newPeak,
        },
      });

      const now = new Date();
      const shouldSampleMetric =
        METRIC_SAMPLE_MINUTES <= 1 || now.getMinutes() % METRIC_SAMPLE_MINUTES === 0;

      if (shouldSampleMetric) {
        await prisma.streamMetric.create({
          data: {
            streamSessionId: activeSession.id,
            viewerCount: stream.viewerCount,
            timestamp: now,
          },
        });
      }
    });
  }

  /**
   * 結束 StreamSession（優化版：直接更新）
   */
  private async endStreamSession(activeSession: { id: string; startedAt: Date }): Promise<void> {
    const endedAt = new Date();
    const durationSeconds = Math.floor(
      (endedAt.getTime() - activeSession.startedAt.getTime()) / 1000
    );

    await runWithWriteGuard("stream-status:end-session", () =>
      prisma.streamSession.update({
        where: { id: activeSession.id },
        data: {
          endedAt,
          durationSeconds,
        },
      })
    );

    logger.info(
      "JOB",
      `下播: Session ${activeSession.id} (${Math.floor(durationSeconds / 60)} 分鐘)`
    );
  }
}

// 匯出單例
export const streamStatusJob = new StreamStatusJob();
