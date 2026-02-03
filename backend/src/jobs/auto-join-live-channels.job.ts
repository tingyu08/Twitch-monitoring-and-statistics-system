import cron from "node-cron";
import { prisma } from "../db/prisma";
import { twurpleHelixService } from "../services/twitch-helix.service";
import { chatListenerManager } from "../services/chat-listener-manager";
import { logger } from "../utils/logger";

// 每 5 分鐘執行，在第 2 分鐘觸發（錯開 Stream Status Job）
const CHECK_LIVE_CRON = process.env.CHECK_LIVE_CRON || "0 2-59/5 * * * *";

// 超時時間（毫秒）- 2 分鐘
//  const JOB_TIMEOUT_MS = 2 * 60 * 1000;

export class AutoJoinLiveChannelsJob {
  private isRunning = false;
  // P2 Note: timeoutHandle 保留供未來超時功能使用
  // private timeoutHandle: NodeJS.Timeout | null = null;

  start(): void {
    logger.info("Jobs", `📋 Auto Join Live Channels Job 已排程: ${CHECK_LIVE_CRON}`);

    // 啟動時立即執行一次
    this.execute().catch((err) => logger.error("Jobs", "初始 Auto Join 執行失敗", err));

    cron.schedule(CHECK_LIVE_CRON, async () => {
      await this.execute();
    });
  }

  async execute(): Promise<void> {
    if (this.isRunning) {
      logger.debug("Jobs", "Auto Join Job 正在執行中，跳過...");
      return;
    }

    this.isRunning = true;
    logger.debug("Jobs", "開始檢查直播頻道並加入聊天室...");

    try {
      // 1. 獲取所有受監控的頻道
      const monitoredChannels = await prisma.channel.findMany({
        where: { isMonitored: true },
        select: {
          id: true,
          twitchChannelId: true,
          channelName: true,
          isLive: true,
        },
      });

      if (monitoredChannels.length === 0) {
        logger.debug("Jobs", "沒有受監控的頻道");
        return;
      }

      // 2. 批量檢查直播狀態 (每次 100 個)
      const batchSize = 100;
      // let liveCount = 0;
      // let joinedCount = 0;

      for (let i = 0; i < monitoredChannels.length; i += batchSize) {
        const batch = monitoredChannels.slice(i, i + batchSize);
        const twitchIds = batch.map((c: { twitchChannelId: string }) => c.twitchChannelId);

        try {
          const streams = await twurpleHelixService.getStreamsByUserIds(twitchIds);
          const liveStreamMap = new Map(streams.map((s) => [s.userId, s]));

          // P0 Fix: 批次查詢所有活躍的 StreamSession，避免 N+1 查詢
          const batchChannelIds = batch.map((c) => c.id);
          const activeSessions = await prisma.streamSession.findMany({
            where: {
              channelId: { in: batchChannelIds },
              endedAt: null,
            },
            select: {
              id: true,
              channelId: true,
              twitchStreamId: true,
            },
          });
          const activeSessionMap = new Map(activeSessions.map((s) => [s.channelId, s]));

          // 3. 更新狀態並加入聊天室
          for (const channel of batch) {
            const stream = liveStreamMap.get(channel.twitchChannelId);
            const isLive = !!stream;

            if (isLive) {
              // liveCount++;

              // 加入聊天室監聽
              await chatListenerManager.requestListen(channel.channelName, {
                isLive: true,
                priority: 10, // Live 頻道優先級較高
              });

              // if (joined) joinedCount++;

              // 避免觸發 Twitch IRC 速率限制和超時錯誤
              // Twitch 限制: 20 joins/10 seconds (authenticated) or 50 joins/15 seconds (verified bot)
              await new Promise((resolve) => setTimeout(resolve, 300)); // 300ms 延遲

              // 更新 Channel Live 狀態 (如果變更)
              if (!channel.isLive) {
                await prisma.channel.update({
                  where: { id: channel.id },
                  data: { isLive: true },
                });
              }

              // P0 Fix: 使用預先查詢的 Map 取代迴圈內查詢
              const activeSession = activeSessionMap.get(channel.id);

              if (!activeSession && stream) {
                // 使用 upsert 避免唯一約束衝突
                await prisma.streamSession.upsert({
                  where: { twitchStreamId: stream.id },
                  update: {
                    // 如果已存在，更新相關資訊
                    title: stream.title,
                    category: stream.gameName,
                  },
                  create: {
                    channelId: channel.id,
                    twitchStreamId: stream.id,
                    startedAt: stream.startedAt,
                    title: stream.title,
                    category: stream.gameName,
                  },
                });
              }
            } else {
              // 頻道離線
              // 停止監聯 (可選，或讓 manager 自動清理)
              // await chatListenerManager.stopListening(channel.channelName);

              // 更新 Channel Live 狀態
              if (channel.isLive) {
                await prisma.channel.update({
                  where: { id: channel.id },
                  data: { isLive: false },
                });

                // 結束 Session
                await prisma.streamSession.updateMany({
                  where: { channelId: channel.id, endedAt: null },
                  data: { endedAt: new Date() },
                });
              }
            }
          }
        } catch (error) {
          logger.error("Jobs", `批次檢查直播狀態失敗: ${error}`);
        }
      }

      // logger.info(
      //   "Jobs",
      //   `✅ 直播檢查完成: 發現 ${liveCount} 個直播中, 加入 ${joinedCount} 個聊天室`
      // );
    } catch (error) {
      logger.error("Jobs", "❌ Auto Join Job 執行失敗", error);
    } finally {
      this.isRunning = false;
    }
  }
}

export const autoJoinLiveChannelsJob = new AutoJoinLiveChannelsJob();
