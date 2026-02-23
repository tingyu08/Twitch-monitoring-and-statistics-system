import cron from "node-cron";
import { prisma } from "../db/prisma";
import { chatListenerManager } from "../services/chat-listener-manager";
import { logger } from "../utils/logger";
import { captureJobError } from "./job-error-tracker";

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
    this.execute().catch((err) => {
      logger.error("Jobs", "初始 Auto Join 執行失敗", err);
      captureJobError("auto-join-live-channels-initial", err);
    });

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
    logger.debug("Jobs", "開始同步聊天室監聽狀態...");

    try {
      // 直接從 DB 讀取已知的直播狀態（reconciliation 用途）
      // update-live-status.job 每分鐘已維護此狀態，無需重複呼叫 Twitch API
      const monitoredChannels = await prisma.channel.findMany({
        where: { isMonitored: true },
        select: {
          channelName: true,
          isLive: true,
        },
      });

      if (monitoredChannels.length === 0) {
        logger.debug("Jobs", "沒有受監控的頻道");
        return;
      }

      for (const channel of monitoredChannels) {
        if (channel.isLive) {
          await chatListenerManager.requestListen(channel.channelName, {
            isLive: true,
            priority: 10,
          });
          // 避免觸發 Twitch IRC 速率限制
          // Twitch 限制: 20 joins/10 seconds (authenticated) or 50 joins/15 seconds (verified bot)
          await new Promise((resolve) => setTimeout(resolve, 300));
        } else {
          await chatListenerManager.stopListening(channel.channelName);
        }
      }
    } catch (error) {
      logger.error("Jobs", "❌ Auto Join Job 執行失敗", error);
      captureJobError("auto-join-live-channels", error);
    } finally {
      this.isRunning = false;
    }
  }
}

export const autoJoinLiveChannelsJob = new AutoJoinLiveChannelsJob();
