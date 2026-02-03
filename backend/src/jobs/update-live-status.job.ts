import { prisma } from "../db/prisma";

import { webSocketGateway } from "../services/websocket.gateway";
import { logger } from "../utils/logger";
import { retryDatabaseOperation } from "../utils/db-retry";

import cron from "node-cron";

// 防止重複執行的鎖
let isRunning = false;

// P0 Optimization: 只在必要時更新 lastLiveCheckAt，減少 80% 資料庫寫入
const LAST_CHECK_UPDATE_INTERVAL_MS = 5 * 60 * 1000; // 5 分鐘

/**
 * 更新所有頻道的即時直播狀態
 * 頻率：每 1 分鐘由 cron 觸發（優化後執行時間大幅縮短）
 */
export const updateLiveStatusJob = cron.schedule("* * * * *", async () => {
  await updateLiveStatusFn();
});

export async function updateLiveStatusFn() {
  // 防止重複執行：如果上一次執行還沒完成，跳過此次執行
  if (isRunning) {
    logger.debug("Jobs", "Update Live Status Job 正在執行中，跳過此次執行");
    return;
  }

  isRunning = true;
  const startTime = Date.now();
  logger.debug("Jobs", "🔄 開始執行 Update Live Status Job...");

  try {
    // 1. 獲取所有需要監控的頻道 (有設定 Twitch ID 的)，包含當前狀態
    const channels = await retryDatabaseOperation(() =>
      prisma.channel.findMany({
        where: {
          twitchChannelId: { not: "" },
          isMonitored: true,
        },
        select: {
          id: true,
          twitchChannelId: true,
          channelName: true,
          isLive: true, // 獲取當前狀態以便比較變更
          lastLiveCheckAt: true, // P0: 用於判斷是否需要更新檢查時間
        },
      })
    );

    // 建立當前狀態 Map 用於比較
    const previousStatusMap = new Map(
      channels.map((c: { twitchChannelId: string; isLive: boolean }) => [c.twitchChannelId, c.isLive])
    );

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
      const twitchIds = batch.map((c: { twitchChannelId: string }) => c.twitchChannelId);

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

    // 4. 過濾：只更新狀態有變化的頻道（大幅減少 DB 寫入）
    const changedUpdates = updates.filter((update) => {
      const wasLive = previousStatusMap.get(update.twitchId);
      return typeof wasLive === "undefined" || wasLive !== update.isLive;
    });
    const changedTwitchIds = new Set(changedUpdates.map((update) => update.twitchId));

    // 5. 批量更新 DB（只更新有變化的頻道）
    // 優化：增加批次大小、減少延遲，因為只處理變化的頻道
    const TX_BATCH_SIZE = 15; // 從 5 增加到 15（因為只處理變化的頻道，數量少很多）
    let updateSuccessCount = 0;
    let updateFailCount = 0;

    // 檢查資料庫連線狀態
    const { isConnectionReady } = await import("../db/prisma");
    if (!isConnectionReady()) {
      logger.warn("Jobs", "資料庫連線尚未預熱，跳過 DB 更新以避免超時");
      return;
    }

    // P0 Optimization: 只更新超過 5 分鐘未檢查的頻道，減少 80% 寫入
    const channelsNeedingCheckUpdate = channels.filter(
      (c) =>
        !c.lastLiveCheckAt ||
        now.getTime() - c.lastLiveCheckAt.getTime() > LAST_CHECK_UPDATE_INTERVAL_MS
    );

    // 如果沒有狀態變化，只更新需要更新檢查時間的頻道
    if (changedUpdates.length === 0 && channelsNeedingCheckUpdate.length > 0) {
      await retryDatabaseOperation(() =>
        prisma.channel.updateMany({
          where: {
            id: { in: channelsNeedingCheckUpdate.map((c) => c.id) },
          },
          data: {
            lastLiveCheckAt: now,
          },
        })
      );

      logger.debug(
        "Jobs",
        `✅ 已更新 ${channelsNeedingCheckUpdate.length}/${channels.length} 個頻道的檢查時間`
      );
    } else if (changedUpdates.length > 0) {
      // 有變化的頻道：完整更新
      for (let i = 0; i < changedUpdates.length; i += TX_BATCH_SIZE) {
        // 記憶體保護：如果記憶體過高，中止剩餘更新
        const { memoryMonitor } = await import("../utils/memory-monitor");
        if (memoryMonitor.isOverLimit()) {
          break;
        }

        const batch = changedUpdates.slice(i, i + TX_BATCH_SIZE);
        const batchIndex = Math.floor(i / TX_BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(changedUpdates.length / TX_BATCH_SIZE);

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

        // 批次之間短暫延遲（從 1000ms 降到 150ms，因為批次數量大幅減少）
        if (i + TX_BATCH_SIZE < changedUpdates.length) {
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
      }

      // P0 Optimization: 只更新超過 5 分鐘未檢查的未變化頻道
      const unchangedChannelsNeedingUpdate = channelsNeedingCheckUpdate.filter((c) => {
        const update = updates.find((u) => u.twitchId === c.twitchChannelId);
        return update && !changedTwitchIds.has(update.twitchId);
      });

      if (unchangedChannelsNeedingUpdate.length > 0) {
        await retryDatabaseOperation(() =>
          prisma.channel.updateMany({
            where: {
              id: { in: unchangedChannelsNeedingUpdate.map((c) => c.id) },
            },
            data: {
              lastLiveCheckAt: now,
            },
          })
        );

        logger.debug(
          "Jobs",
          `✅ 已更新 ${unchangedChannelsNeedingUpdate.length} 個未變化頻道的檢查時間`
        );
      }
    }

    // 記錄更新結果
    if (updateFailCount > 0) {
      logger.warn(
        "Jobs",
        `批次更新完成: 成功 ${updateSuccessCount}/${changedUpdates.length}, 失敗 ${updateFailCount}`
      );
    }

    // 5. 推送 WebSocket 事件（只推送狀態變更：online/offline）
    // P1 Optimization: Removed channel.update broadcast - now handled by React Query refetchInterval
    let onlineChanges = 0;
    let offlineChanges = 0;

    for (const update of updates) {
      const previousStatus = previousStatusMap.get(update.twitchId);

      // 狀態從 offline -> online
      if (!previousStatus && update.isLive) {
        webSocketGateway.broadcastStreamStatus("stream.online", {
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
        webSocketGateway.broadcastStreamStatus("stream.offline", {
          channelId: update.channelId,
          channelName: update.channelName,
          twitchChannelId: update.twitchId,
        });
        offlineChanges++;
      }
      // P1 Optimization: Removed channel.update for continuous live streams
      // Viewer counts are now fetched via React Query refetchInterval (every 60s)
    }

    // 統計開台與未開台頻道數量
    const liveCount = updates.filter((u) => u.isLive).length;
    const offlineCount = updates.filter((u) => !u.isLive).length;

    // 只在有狀態變更時輸出 info
    const duration = Date.now() - startTime;
    if (onlineChanges > 0 || offlineChanges > 0) {
      logger.info(
        "Jobs",
        `直播狀態更新: ${onlineChanges} 個上線, ${offlineChanges} 個下線 (${liveCount} 直播中, ${offlineCount} 離線, DB寫入: ${changedUpdates.length}/${updates.length}) [${duration}ms]`
      );
    } else {
      logger.debug(
        "Jobs",
        `✅ 直播狀態更新完成: 已檢查 ${updates.length} 個頻道, ${liveCount} 直播中, ${offlineCount} 離線, DB寫入: ${changedUpdates.length} [${duration}ms]`
      );
    }
  } catch (error) {
    logger.error("Jobs", "Update Live Status Job 執行失敗", error);
  } finally {
    // 確保解鎖，即使發生錯誤
    isRunning = false;
  }
}
