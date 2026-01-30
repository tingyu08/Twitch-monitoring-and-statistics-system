import { prisma } from "../db/prisma";

import { webSocketGateway } from "../services/websocket.gateway";
import { logger } from "../utils/logger";
import { retryDatabaseOperation } from "../utils/db-retry";

import cron from "node-cron";

/**
 * 更新所有頻道的即時直播狀態
 * 頻率：每 1 分鐘由 cron 觸發
 */
export const updateLiveStatusJob = cron.schedule("* * * * *", async () => {
  await updateLiveStatusFn();
});

export async function updateLiveStatusFn() {
  logger.debug("Jobs", "🔄 開始執行 Update Live Status Job...");

  try {
    // 1. 獲取所有需要監控的頻道 (有設定 Twitch ID 的)，包含當前狀態
    const channels = await prisma.channel.findMany({
      where: {
        twitchChannelId: { not: "" },
        isMonitored: true,
      },
      select: {
        id: true,
        twitchChannelId: true,
        channelName: true,
        isLive: true, // 獲取當前狀態以便比較變更
      },
    });

    // 建立當前狀態 Map 用於比較
    const previousStatusMap = new Map(channels.map((c) => [c.twitchChannelId, c.isLive]));

    if (channels.length === 0) {
      logger.warn("Jobs", "⚠️ 找不到受監控的頻道 (isMonitored=true)，請檢查頻道是否正確同步");
      return;
    }

    logger.debug("Jobs", `📊 找到 ${channels.length} 個受監控的頻道需要檢查`);

    // 2. 初始化 API Client (使用單例模式或確保釋放)
    // 這裡我們直接使用 twurpleHelixService 封裝好的方法，它已經處理了 ApiClient 的生命週期
    // 但是這裡需要批量查詢，twurpleHelixService.getStreamsByUserIds 已經有實現
    // 所以我們不需要在這裡手動初始化 ApiClient

    const { twurpleHelixService } = await import("../services/twitch-helix.service");

    // 3. 分批處理 (減少 Batch Size 讓系統有機會喘息)
    const BATCH_SIZE = 100;
    const now = new Date();

    // 用來儲存需要更新的數據
    const updates: {
      channelId: string;
      channelName: string;
      twitchId: string;
      isLive: boolean;
      viewerCount: number;
      title: string;
      gameName: string;
      startedAt: Date | null;
    }[] = [];

    for (let i = 0; i < channels.length; i += BATCH_SIZE) {
      const batch = channels.slice(i, i + BATCH_SIZE);
      const twitchIds = batch.map((c) => c.twitchChannelId);

      try {
        // 使用 twurpleHelixService (內部已管理 ApiClient)
        const streams = await twurpleHelixService.getStreamsByUserIds(twitchIds);

        // 建立一個 Map 方便查詢
        const streamMap = new Map();
        for (const stream of streams) {
          streamMap.set(stream.userId, stream);
        }

        // 遍歷這一批的所有頻道，判斷是否開台
        for (const channel of batch) {
          const stream = streamMap.get(channel.twitchChannelId);

          if (stream) {
            updates.push({
              channelId: channel.id,
              channelName: channel.channelName,
              twitchId: channel.twitchChannelId,
              isLive: true,
              viewerCount: stream.viewerCount, // 注意：TwurpleHelixService 返回的結構屬性名可能不同
              title: stream.title,
              gameName: stream.gameName,
              startedAt: stream.startedAt,
            });
          } else {
            // 未開台
            updates.push({
              channelId: channel.id,
              channelName: channel.channelName,
              twitchId: channel.twitchChannelId,
              isLive: false,
              viewerCount: 0,
              title: "",
              gameName: "",
              startedAt: null,
            });
          }
        }
      } catch (err) {
        logger.error("Jobs", `第 ${i} 批次獲取直播狀態失敗`, err);
      }

      // 記憶體/CPU 優化：批次之間休息一下
      if (i + BATCH_SIZE < channels.length) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    // 4. 批量更新 DB (使用 Transaction 以提高效能)
    // Turso Free Tier 優化：大幅減小批次大小以避免資料庫連線池耗盡
    const TX_BATCH_SIZE = 5; // 從 10 降到 5
    let updateSuccessCount = 0;
    let updateFailCount = 0;

    // 檢查資料庫連線狀態
    const { isConnectionReady } = await import("../db/prisma");
    if (!isConnectionReady()) {
      logger.warn("Jobs", "資料庫連線尚未預熱，跳過 DB 更新以避免超時");
      return;
    }

    for (let i = 0; i < updates.length; i += TX_BATCH_SIZE) {
      // 記憶體保護：如果記憶體過高，中止剩餘更新
      const { memoryMonitor } = await import("../utils/memory-monitor");
      if (memoryMonitor.isOverLimit()) {
        logger.warn("Jobs", "記憶體不足，中止剩餘的狀態更新");
        break;
      }

      const batch = updates.slice(i, i + TX_BATCH_SIZE);
      const batchIndex = Math.floor(i / TX_BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(updates.length / TX_BATCH_SIZE);

      try {
        // 使用重試機制執行批次更新
        await retryDatabaseOperation(async () => {
          const updatePromises = batch.map((update) =>
            prisma.channel.update({
              where: { twitchChannelId: update.twitchId },
              data: {
                isLive: update.isLive,
                currentViewerCount: update.viewerCount,
                currentTitle: update.title || undefined,
                currentGameName: update.gameName || undefined,
                currentStreamStartedAt: update.startedAt,
                lastLiveCheckAt: now,
              },
            })
          );

          await prisma.$transaction(updatePromises);
        });

        updateSuccessCount += batch.length;
      } catch (error) {
        updateFailCount += batch.length;
        logger.error(
          "Jobs",
          `批次更新失敗 (${batchIndex}/${totalBatches}):`,
          error instanceof Error ? error.message : String(error)
        );
        // 繼續處理下一批，不中斷整個流程
      }

      // 批次之間大幅延遲，避免壓垮 Turso 和 Render CPU
      if (i + TX_BATCH_SIZE < updates.length) {
        await new Promise((resolve) => setTimeout(resolve, 1000)); // 從 300ms 增加到 1000ms
      }
    }

    // 記錄更新結果
    if (updateFailCount > 0) {
      logger.warn(
        "Jobs",
        `批次更新完成: 成功 ${updateSuccessCount}/${updates.length}, 失敗 ${updateFailCount}`
      );
    }

    // 5. 推送 WebSocket 事件（只推送狀態有變更的頻道）
    let onlineChanges = 0;
    let offlineChanges = 0;

    for (const update of updates) {
      const previousStatus = previousStatusMap.get(update.twitchId);

      // 狀態從 offline -> online
      if (!previousStatus && update.isLive) {
        webSocketGateway.emit("stream.online", {
          channelId: update.channelId,
          channelName: update.channelName,
          twitchChannelId: update.twitchId,
          title: update.title,
          gameName: update.gameName,
          viewerCount: update.viewerCount,
          startedAt: update.startedAt,
        });
        onlineChanges++;
      }
      // 狀態從 online -> offline
      else if (previousStatus && !update.isLive) {
        webSocketGateway.emit("stream.offline", {
          channelId: update.channelId,
          channelName: update.channelName,
          twitchChannelId: update.twitchId,
        });
        offlineChanges++;
      }
      // 持續開台中，推送觀眾數更新
      else if (previousStatus && update.isLive) {
        webSocketGateway.emit("channel.update", {
          channelId: update.channelId,
          channelName: update.channelName,
          twitchChannelId: update.twitchId,
          isLive: true,
          viewerCount: update.viewerCount,
          title: update.title,
          gameName: update.gameName,
        });
      }
    }

    // 統計開台與未開台頻道數量
    const liveCount = updates.filter((u) => u.isLive).length;
    const offlineCount = updates.filter((u) => !u.isLive).length;

    // 只在有狀態變更時輸出 info
    if (onlineChanges > 0 || offlineChanges > 0) {
      logger.info(
        "Jobs",
        `直播狀態更新: ${onlineChanges} 個上線, ${offlineChanges} 個下線 (${liveCount} 直播中, ${offlineCount} 離線)`
      );
    } else {
      logger.debug(
        "Jobs",
        `✅ 直播狀態更新完成: 已檢查 ${updates.length} 個頻道, ${liveCount} 個直播中, ${offlineCount} 個離線`
      );
    }
  } catch (error) {
    logger.error("Jobs", "Update Live Status Job 執行失敗", error);
  }
}
