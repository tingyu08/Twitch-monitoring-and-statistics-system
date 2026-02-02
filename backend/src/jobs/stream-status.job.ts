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

// 每 5 分鐘執行（第 0 秒觸發）
const STREAM_STATUS_CRON = process.env.STREAM_STATUS_CRON || "0 */5 * * * *";

// Twitch API 單次查詢最大頻道數
const MAX_CHANNELS_PER_BATCH = 100;

// 超時時間（毫秒）- Render Free Tier 優化：縮短超時以避免長時間佔用資源
const JOB_TIMEOUT_MS = 2 * 60 * 1000; // 從 5 分鐘縮短到 2 分鐘

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
      logger.warn("JOB", "記憶體不足，跳過 Stream Status Job");
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
      // 只在有新場次或結束場次時輸出 info，否則輸出 debug
      if (result.newSessions > 0 || result.endedSessions > 0) {
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
      // 如果是超時錯誤，降級為警告（允許繼續運行）
      if (error instanceof Error && error.message.includes("超時")) {
        logger.warn(
          "JOB",
          `Stream Status Job 超時 (已處理 ${result.checked} 個頻道)，將在下次執行時繼續`
        );
        return result; // 返回部分結果而不是拋出錯誤
      }
      logger.error("JOB", "Stream Status Job 執行失敗:", error);
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
   */
  private async doExecute(result: StreamStatusResult): Promise<void> {
    // 1. 資料庫連線檢查（優化版：支援預熱檢測 + 更長超時）
    const { isConnectionReady } = await import("../db/prisma");
    const maxRetries = 3; // 從 2 增加到 3
    const timeoutMs = isConnectionReady() ? 10000 : 20000; // 預熱後用 10s，冷啟動用 20s
    let connected = false;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await Promise.race([
          prisma.$queryRaw`SELECT 1`,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("DB connection timeout")), timeoutMs)
          ),
        ]);
        connected = true;
        break;
      } catch (error) {
        logger.warn(
          "JOB",
          `資料庫連線失敗 (嘗試 ${attempt}/${maxRetries}, timeout=${timeoutMs}ms)`,
          error
        );
        if (attempt < maxRetries) {
          // 指數退避：1s, 2s, 4s
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 4000);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    if (!connected) {
      logger.error("JOB", `資料庫連線失敗，已重試 ${maxRetries} 次，跳過此次執行`);
      return;
    }

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

    // 4. 一次查詢所有 active sessions
    const channelIds = channels.map((c) => c.id);
    const activeSessions = await prisma.streamSession.findMany({
      where: {
        channelId: { in: channelIds },
        endedAt: null,
      },
    });
    const activeSessionMap = new Map(activeSessions.map((s) => [s.channelId, s]));

    // 5. 處理每個頻道的狀態變化（並行處理，限制並發數）
    // Render Free Tier 優化：大幅降低並發以減少記憶體使用
    const CONCURRENCY_LIMIT = process.env.NODE_ENV === "production" ? 2 : 5;

    // 將任務分組進行並行處理
    const tasks = channels.map(async (channel) => {
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
      logger.debug("JOB", "Job 執行後觸發 GC");
    }
  }

  /**
   * 簡單的並發控制器
   */
  private async runWithConcurrency<T>(tasks: Promise<T>[], limit: number): Promise<void> {
    const results: Promise<T>[] = [];
    const executing = new Set<Promise<void>>();

    for (const task of tasks) {
      const p = Promise.resolve().then(() => task);
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
  private async getActiveChannels() {
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

    return prisma.channel.findMany({
      where: { isMonitored: true },
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
        logger.error("JOB", `批次查詢失敗 (${i}-${i + batch.length}):`, error);
      }

      // 記憶體/CPU 優化：批次之間休息一下（Render Free Tier 優化：增加延遲）
      if (i + MAX_CHANNELS_PER_BATCH < twitchChannelIds.length) {
        await new Promise((resolve) => setTimeout(resolve, 500)); // 從 100ms 增加到 500ms
      }
    }

    return allStreams;
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

    // 記錄 Metric
    await prisma.streamMetric.create({
      data: {
        streamSessionId: activeSession.id,
        viewerCount: stream.viewerCount,
        timestamp: new Date(),
      },
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

    await prisma.streamSession.update({
      where: { id: activeSession.id },
      data: {
        endedAt,
        durationSeconds,
      },
    });

    logger.info(
      "JOB",
      `下播: Session ${activeSession.id} (${Math.floor(durationSeconds / 60)} 分鐘)`
    );
  }
}

// 匯出單例
export const streamStatusJob = new StreamStatusJob();
