import { prisma } from "../db/prisma";
import { twurpleAuthService } from "../services/twurple-auth.service";
import { webSocketGateway } from "../services/websocket.gateway";
import { logger } from "../utils/logger";

import cron from "node-cron";

/**
 * 更新所有頻道的即時直播狀態
 * 頻率：每 1 分鐘由 cron 觸發
 */
export const updateLiveStatusJob = cron.schedule("* * * * *", async () => {
  await updateLiveStatusFn();
});

export async function updateLiveStatusFn() {
  logger.debug("Jobs", "🔄 Starting Update Live Status Job...");

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
    const previousStatusMap = new Map(
      channels.map((c) => [c.twitchChannelId, c.isLive]),
    );

    if (channels.length === 0) {
      logger.warn(
        "Jobs",
        "⚠️ No monitored channels found (isMonitored=true). Check if channels are correctly synced.",
      );
      return;
    }

    logger.debug(
      "Jobs",
      `📊 Found ${channels.length} monitored channels to check`,
    );

    // 2. 初始化 API Client
    const { ApiClient } = await new Function('return import("@twurple/api")')();
    const authProvider = await twurpleAuthService.getAppAuthProvider();
    const apiClient = new ApiClient({ authProvider });

    // 3. 分批處理 (Twitch API 上限通常為 100)
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
        const streams = await apiClient.streams.getStreamsByUserIds(twitchIds);

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
              viewerCount: stream.viewers,
              title: stream.title,
              gameName: stream.gameName,
              startedAt: stream.startDate,
            });
          } else {
            // 未開台
            updates.push({
              channelId: channel.id,
              channelName: channel.channelName,
              twitchId: channel.twitchChannelId,
              isLive: false,
              viewerCount: 0,
              title: "", // 或保留最後標題? 這裡先清空或設為 null
              gameName: "",
              startedAt: null,
            });
          }
        }
      } catch (err) {
        logger.error("Jobs", `Failed to fetch streams for batch ${i}`, err);
      }
    }

    // 4. 批量更新 DB (使用 Transaction 以提高效能)
    // 雖然 Prisma 沒有原生的 bulkUpdate，但我們可以用 $transaction 這裡包裝多個 update
    // 若數量大多，建議用 SQL raw query，但這裡先用 $transaction

    const updatePromises = updates.map((update) =>
      prisma.channel.update({
        where: { twitchChannelId: update.twitchId },
        data: {
          isLive: update.isLive,
          currentViewerCount: update.viewerCount,
          currentTitle: update.title || undefined, // undefined 代表不更新? 不，未開台時可能想保留標題。但這裡我們先簡單處理
          currentGameName: update.gameName || undefined,
          currentStreamStartedAt: update.startedAt,
          lastLiveCheckAt: now,
        },
      }),
    );

    // 分批執行 Transaction 避免過大
    const TX_BATCH_SIZE = 50;
    for (let i = 0; i < updatePromises.length; i += TX_BATCH_SIZE) {
      const txBatch = updatePromises.slice(i, i + TX_BATCH_SIZE);
      await prisma.$transaction(txBatch);
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
        `Update Live Status: ${onlineChanges} went online, ${offlineChanges} went offline (${liveCount} live, ${offlineCount} offline)`,
      );
    } else {
      logger.debug(
        "Jobs",
        `✅ Update Live Status: ${updates.length} channels checked, ${liveCount} LIVE, ${offlineCount} offline`,
      );
    }
  } catch (error) {
    logger.error("Jobs", "Update Live Status Job failed", error);
  }
}
