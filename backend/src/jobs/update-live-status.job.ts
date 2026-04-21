import { prisma, isConnectionReady } from "../db/prisma";
import { Prisma } from "@prisma/client";

import { webSocketGateway } from "../services/websocket.gateway";
import { logger } from "../utils/logger";
import { retryDatabaseOperation } from "../utils/db-retry";
import { cacheManager } from "../utils/cache-manager";
import { memoryMonitor } from "../utils/memory-monitor";
import { runWithWriteGuard } from "./job-write-guard";
import { CacheTags, WriteGuardKeys } from "../constants";
import {
  recordJobFailure,
  recordJobSuccess,
  shouldSkipForCircuitBreaker,
} from "../utils/job-circuit-breaker";

import cron from "node-cron";

// 防止重複執行的鎖
let isRunning = false;

// P0 Optimization: 只在必要時更新 lastLiveCheckAt，減少 80% 資料庫寫入
const LAST_CHECK_UPDATE_INTERVAL_MS = 5 * 60 * 1000; // 5 分鐘

// 每分鐘第 30 秒執行（不是每 30 秒）。
// 目的：錯開多數整分鐘觸發的 job，降低同秒 DB/Twitch API 峰值競爭。
const UPDATE_LIVE_STATUS_CRON = process.env.UPDATE_LIVE_STATUS_CRON || "30 * * * * *";
const CRON_JITTER_MAX_MS = Number.parseInt(process.env.UPDATE_LIVE_STATUS_CRON_JITTER_MAX_MS || "3000", 10);
const JOB_CIRCUIT_BREAKER_NAME = "update-live-status";

// 活躍頻道判斷窗口（超過此時間未開台則進入低頻輪詢）
const SLOW_POLL_GROUPS = 5;
const MAX_SLOW_POLL_GROUPS = 12;
const TARGET_SLOW_CHANNELS_PER_CYCLE = 250;
const MAX_UNCHANGED_CHECK_WRITES_PER_CYCLE = 300;
const BASE_API_BATCH_SIZE = 100;
const CHANNEL_QUERY_BATCH_SIZE = 500;
const CHANNEL_UPDATE_MIN_INTERVAL_MS = Number(
  process.env.CHANNEL_UPDATE_MIN_INTERVAL_MS || 15000
);
// stream.online 防抖：同一頻道在此窗口內不重複發送通知，避免 EventSub 假 offline/online 造成重複 toast
const STREAM_ONLINE_DEBOUNCE_MS = Number(
  process.env.STREAM_ONLINE_DEBOUNCE_MS || 10 * 60 * 1000 // 預設 10 分鐘
);
let slowPollIndex = 0;
const channelUpdateLastEmittedAt = new Map<string, number>();
const streamOnlineLastEmittedAt = new Map<string, number>();
// 重啟後第一輪掃描跳過 stream.online 通知，避免 server 重啟對所有已在播頻道發送 toast
let isFirstRun = true;

type MonitoredChannelRow = {
  id: string;
  twitchChannelId: string;
  channelName: string;
  isLive: boolean;
  lastLiveCheckAt: Date | null;
  currentViewerCount: number | null;
  currentTitle: string | null;
  currentGameName: string | null;
  currentStreamStartedAt: Date | null;
};

function getPollGroup(channelId: string, groups: number): number {
  let sum = 0;
  for (let i = 0; i < channelId.length; i++) {
    sum += channelId.charCodeAt(i);
  }
  return Math.abs(sum) % groups;
}

function getAdaptiveSlowPollGroups(slowChannelCount: number): number {
  const dynamicGroups = Math.ceil(slowChannelCount / TARGET_SLOW_CHANNELS_PER_CYCLE);
  return Math.max(SLOW_POLL_GROUPS, Math.min(MAX_SLOW_POLL_GROUPS, dynamicGroups || SLOW_POLL_GROUPS));
}

function shouldEmitStreamOnline(channelId: string, nowMs: number): boolean {
  // 重啟後第一輪：把目前已在播的頻道記入 Map（不送通知），避免重啟時 toast 爆炸
  if (isFirstRun) {
    streamOnlineLastEmittedAt.set(channelId, nowMs);
    return false;
  }

  // 清理過期記錄，避免 Map 無限成長
  if (streamOnlineLastEmittedAt.size > 10000) {
    const staleBefore = nowMs - STREAM_ONLINE_DEBOUNCE_MS * 2;
    for (const [id, emittedAt] of streamOnlineLastEmittedAt) {
      if (emittedAt < staleBefore) {
        streamOnlineLastEmittedAt.delete(id);
      }
    }
  }

  const lastEmittedAt = streamOnlineLastEmittedAt.get(channelId) ?? 0;
  if (nowMs - lastEmittedAt < STREAM_ONLINE_DEBOUNCE_MS) {
    return false;
  }

  streamOnlineLastEmittedAt.set(channelId, nowMs);
  return true;
}

function shouldEmitChannelUpdate(channelId: string, force: boolean, nowMs: number): boolean {
  if (channelUpdateLastEmittedAt.size > 50000) {
    const staleBefore = nowMs - CHANNEL_UPDATE_MIN_INTERVAL_MS * 10;
    for (const [id, emittedAt] of channelUpdateLastEmittedAt) {
      if (emittedAt < staleBefore) {
        channelUpdateLastEmittedAt.delete(id);
      }
    }
  }

  if (force) {
    channelUpdateLastEmittedAt.set(channelId, nowMs);
    return true;
  }

  const lastEmittedAt = channelUpdateLastEmittedAt.get(channelId) ?? 0;
  if (nowMs - lastEmittedAt < CHANNEL_UPDATE_MIN_INTERVAL_MS) {
    return false;
  }

  channelUpdateLastEmittedAt.set(channelId, nowMs);
  return true;
}

function selectChannelsForCheckUpdate(
  channels: Array<{ id: string; twitchChannelId: string }>,
  groups: number,
  currentIndex: number,
  maxItems: number = MAX_UNCHANGED_CHECK_WRITES_PER_CYCLE
) {
  const filtered = channels.filter(
    (channel) => getPollGroup(channel.twitchChannelId, groups) === currentIndex
  );

  if (filtered.length <= maxItems) {
    return filtered;
  }

  return filtered.slice(0, maxItems);
}

async function fetchMonitoredChannelBatch(cursorId?: string): Promise<MonitoredChannelRow[]> {
  return retryDatabaseOperation(() =>
    prisma.channel.findMany({
      where: {
        twitchChannelId: { not: "" },
        isMonitored: true,
      },
      select: {
        id: true,
        twitchChannelId: true,
        channelName: true,
        isLive: true,
        lastLiveCheckAt: true,
        currentViewerCount: true,
        currentTitle: true,
        currentGameName: true,
        currentStreamStartedAt: true,
      },
      orderBy: { id: "asc" },
      take: CHANNEL_QUERY_BATCH_SIZE,
      ...(cursorId
        ? {
            cursor: { id: cursorId },
            skip: 1,
          }
        : {}),
    })
  ) as Promise<MonitoredChannelRow[]>;
}

/**
 * 場景 1: 只更新檢查時間（無狀態變化）
 */
async function updateChannelsCheckTimeOnly(
  checkUpdateCandidates: Array<{ id: string }>,
  now: Date,
  totalChannels: number
): Promise<void> {
  if (checkUpdateCandidates.length === 0) return;

  await runWithWriteGuard(WriteGuardKeys.LIVE_STATUS_CHECK_TIME, () =>
    retryDatabaseOperation(() =>
      prisma.channel.updateMany({
        where: {
          id: { in: checkUpdateCandidates.map((c) => c.id) },
        },
        data: {
          lastLiveCheckAt: now,
        },
      })
    )
  );

  logger.debug(
    "Jobs",
    `✅ 已更新 ${checkUpdateCandidates.length}/${totalChannels} 個頻道的檢查時間`
  );
}

/**
 * 場景 2: 更新有變化的頻道（狀態變更 + 元數據更新）
 */
async function updateChannelsWithChanges(
  changedUpdates: Array<{
    channelId: string;
    twitchId: string;
    isLive?: boolean;
    viewerCount: number;
    title: string;
    gameName: string;
    startedAt: Date | null;
  }>,
  liveUpdates: Array<{
    channelId: string;
    twitchId: string;
    viewerCount: number;
    title: string;
    gameName: string;
    startedAt: Date | null;
  }>,
  checkUpdateCandidates: Array<{ id: string; twitchChannelId: string }>,
  changedTwitchIds: Set<string>,
  now: Date
): Promise<{ successCount: number; failCount: number }> {
  let successCount = 0;
  let failCount = 0;

  const mergedUpdatesByTwitchId = new Map<
    string,
    {
      twitchId: string;
      isLive?: boolean;
      viewerCount: number;
      title: string;
      gameName: string;
      startedAt: Date | null;
    }
  >();

  for (const update of [...changedUpdates, ...liveUpdates]) {
    const nextIsLive =
      typeof (update as { isLive?: unknown }).isLive === "boolean"
        ? ((update as { isLive?: boolean }).isLive ?? undefined)
        : undefined;

    const existing = mergedUpdatesByTwitchId.get(update.twitchId);

    if (!existing) {
      mergedUpdatesByTwitchId.set(update.twitchId, {
        twitchId: update.twitchId,
        isLive: nextIsLive,
        viewerCount: update.viewerCount,
        title: update.title,
        gameName: update.gameName,
        startedAt: update.startedAt,
      });
      continue;
    }

    existing.viewerCount = update.viewerCount;
    existing.title = update.title;
    existing.gameName = update.gameName;
    existing.startedAt = update.startedAt;

    if (typeof nextIsLive === "boolean") {
      existing.isLive = nextIsLive;
    }
  }

  const combinedUpdates = Array.from(mergedUpdatesByTwitchId.values());
  const TX_BATCH_SIZE =
    combinedUpdates.length > 800 ? 10 : combinedUpdates.length > 300 ? 12 : 15;

  for (let i = 0; i < combinedUpdates.length; i += TX_BATCH_SIZE) {
    // 記憶體保護：如果記憶體過高，中止剩餘更新
    if (memoryMonitor.isOverLimit()) {
      logger.warn(
        "Jobs",
        `記憶體超限，跳過剩餘 ${combinedUpdates.length - i} 個頻道的 DB 更新`
      );
      break;
    }

    const batch = combinedUpdates.slice(i, i + TX_BATCH_SIZE);
    const batchIndex = Math.floor(i / TX_BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(combinedUpdates.length / TX_BATCH_SIZE);

    try {
      await runWithWriteGuard(WriteGuardKeys.LIVE_STATUS_BATCH_UPDATE, () =>
        retryDatabaseOperation(async () => {
          if (batch.length === 0) {
            return;
          }

          const values = batch.map((update) => {
            const isLiveValue =
              typeof update.isLive === "boolean" ? update.isLive : null;

            return Prisma.sql`(
              ${update.twitchId}::text,
              ${isLiveValue}::boolean,
              ${update.viewerCount}::integer,
              ${update.title || null}::text,
              ${update.gameName || null}::text,
              ${update.startedAt}::timestamptz,
              ${now}::timestamptz
            )`;
          });

          await prisma.$executeRaw(buildChangedChannelUpdateQuery(values));
        })
      );

      successCount += batch.length;
    } catch (error) {
      failCount += batch.length;
      logger.error(
        "Jobs",
        `批次更新失敗 (${batchIndex}/${totalBatches}):`,
        error instanceof Error ? error.message : String(error)
      );
    }

    // 批次之間短暫延遲
    if (i + TX_BATCH_SIZE < combinedUpdates.length) {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  // 清除快取
  if (liveUpdates.length > 0) {
    await cacheManager.invalidateTag(CacheTags.VIEWER_CHANNELS);
  }

  // 更新未變化但需要更新檢查時間的頻道
  const unchangedChannelsNeedingUpdate = checkUpdateCandidates.filter(
    (c) => !changedTwitchIds.has(c.twitchChannelId)
  );

  if (unchangedChannelsNeedingUpdate.length > 0) {
    await runWithWriteGuard(WriteGuardKeys.LIVE_STATUS_UNCHANGED_CHECK, () =>
      retryDatabaseOperation(() =>
        prisma.channel.updateMany({
          where: {
            id: { in: unchangedChannelsNeedingUpdate.map((c) => c.id) },
          },
          data: {
            lastLiveCheckAt: now,
          },
        })
      )
    );

    logger.debug(
      "Jobs",
      `✅ 已更新 ${unchangedChannelsNeedingUpdate.length} 個未變化頻道的檢查時間`
    );
  }

  return { successCount, failCount };
}

export function buildChangedChannelUpdateQuery(values: ReturnType<typeof Prisma.sql>[]) {
  return Prisma.sql`
    WITH updates (
      "twitchChannelId",
      "isLiveValue",
      "viewerCount",
      "titleValue",
      "gameNameValue",
      "startedAtValue",
      "checkedAt"
    ) AS (
      VALUES ${Prisma.join(values)}
    )
    UPDATE channels
    SET
      "isLive" = COALESCE(
        (
          SELECT updates."isLiveValue"
          FROM updates
          WHERE updates."twitchChannelId" = channels."twitchChannelId"
        ),
        "isLive"
      ),
      "currentViewerCount" = (
        SELECT updates."viewerCount"
        FROM updates
        WHERE updates."twitchChannelId" = channels."twitchChannelId"
      ),
      "currentTitle" = COALESCE(
        (
          SELECT updates."titleValue"
          FROM updates
          WHERE updates."twitchChannelId" = channels."twitchChannelId"
        ),
        "currentTitle"
      ),
      "currentGameName" = COALESCE(
        (
          SELECT updates."gameNameValue"
          FROM updates
          WHERE updates."twitchChannelId" = channels."twitchChannelId"
        ),
        "currentGameName"
      ),
      "currentStreamStartedAt" = (
        SELECT updates."startedAtValue"
        FROM updates
        WHERE updates."twitchChannelId" = channels."twitchChannelId"
      ),
      "lastLiveCheckAt" = (
        SELECT updates."checkedAt"
        FROM updates
        WHERE updates."twitchChannelId" = channels."twitchChannelId"
      )
    WHERE "twitchChannelId" IN (SELECT "twitchChannelId" FROM updates)
      AND EXISTS (
        SELECT 1
        FROM updates
        WHERE updates."twitchChannelId" = channels."twitchChannelId"
          AND (
            (updates."isLiveValue" IS NOT NULL AND "isLive" IS DISTINCT FROM updates."isLiveValue")
            OR "currentViewerCount" IS DISTINCT FROM updates."viewerCount"::integer
            OR "currentTitle" IS DISTINCT FROM updates."titleValue"::text
            OR "currentGameName" IS DISTINCT FROM updates."gameNameValue"::text
            OR "currentStreamStartedAt" IS DISTINCT FROM updates."startedAtValue"::timestamptz
          )
      )
  `;
}

/**
 * 更新所有頻道的即時直播狀態
 * 頻率：每 1 分鐘由 cron 觸發（優化後執行時間大幅縮短）
 */
export const updateLiveStatusJob = cron.schedule(UPDATE_LIVE_STATUS_CRON, async () => {
  if (CRON_JITTER_MAX_MS > 0) {
    const jitterMs = Math.floor(Math.random() * CRON_JITTER_MAX_MS);
    if (jitterMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, jitterMs));
    }
  }
  await updateLiveStatusFn();
});

export async function updateLiveStatusFn() {
  // 防止重複執行：如果上一次執行還沒完成，跳過此次執行
  if (isRunning) {
    logger.debug("Jobs", "直播狀態更新任務正在執行中，略過此次觸發");
    return;
  }

  isRunning = true;
  const startTime = Date.now();
  logger.debug("Jobs", "🔄 開始執行直播狀態更新任務...");

  if (shouldSkipForCircuitBreaker(JOB_CIRCUIT_BREAKER_NAME)) {
    logger.warn("Jobs", "直播狀態更新任務暫停中（circuit breaker），跳過本輪");
    isRunning = false;
    return;
  }

  try {
    // 1. 一次 groupBy 同時取得監控總量與慢速輪詢總量（省一次 Turso 網路往返）
    const countRows = await retryDatabaseOperation(() =>
      prisma.channel.groupBy({
        by: ["isLive"],
        where: {
          twitchChannelId: { not: "" },
          isMonitored: true,
        },
        _count: { id: true },
      })
    );
    const scannedCount = countRows.reduce((sum, row) => sum + row._count.id, 0);
    const slowChannelCount = countRows.find((r) => !r.isLive)?._count.id ?? 0;

    if (scannedCount === 0) {
      logger.warn("Jobs", "⚠️ 找不到受監控的頻道（isMonitored=true），請檢查頻道是否正確同步");
      return;
    }

    logger.debug("Jobs", `📊 找到 ${scannedCount} 個受監控的頻道需要檢查`);

    // 2. 初始化 API Client (使用單例模式或確保釋放)
    // 這裡我們直接使用 twurpleHelixService 封裝好的方法，它已經處理了 ApiClient 的生命週期
    // 但是這裡需要批量查詢，twurpleHelixService.getStreamsByUserIds 已經有實現
    // 所以我們不需要在這裡手動初始化 ApiClient

    const { twurpleHelixService } = await import("../services/twitch-helix.service");

    // 3. 分批處理
    const BATCH_SIZE =
      scannedCount > 2000
        ? 60
        : scannedCount > 1000
          ? 80
          : BASE_API_BATCH_SIZE;
    const now = new Date();

    const adaptiveSlowPollGroups = getAdaptiveSlowPollGroups(slowChannelCount);
    slowPollIndex = (slowPollIndex + 1) % adaptiveSlowPollGroups;

    // 3. 分頁串流處理，避免累積全量頻道資料
    let updateSuccessCount = 0;
    let updateFailCount = 0;
    let totalChangedUpdates = 0;
    let liveCount = 0;
    let offlineCount = 0;
    let processedCount = 0;
    let onlineChanges = 0;
    let offlineChanges = 0;
    let checkUpdateBudget = MAX_UNCHANGED_CHECK_WRITES_PER_CYCLE;

    let cursorId: string | undefined;

    // 檢查資料庫連線狀態
    if (!isConnectionReady()) {
      logger.warn("Jobs", "資料庫連線尚未預熱，跳過 DB 更新以避免超時");
      return;
    }

    while (true) {
      const fetchedBatch = await fetchMonitoredChannelBatch(cursorId);
      if (fetchedBatch.length === 0) {
        break;
      }

      cursorId = fetchedBatch[fetchedBatch.length - 1]?.id;

      const channels = fetchedBatch.filter(
        (channel) =>
          channel.isLive ||
          getPollGroup(channel.twitchChannelId, adaptiveSlowPollGroups) === slowPollIndex
      );

      if (channels.length === 0) {
        if (fetchedBatch.length < CHANNEL_QUERY_BATCH_SIZE) {
          break;
        }
        continue;
      }

      processedCount += channels.length;

      for (let i = 0; i < channels.length; i += BATCH_SIZE) {
        const batch = channels.slice(i, i + BATCH_SIZE);
        const twitchIds = batch.map((c: { twitchChannelId: string }) => c.twitchChannelId);

        const changedUpdates: {
          channelId: string;
          channelName: string;
          twitchId: string;
          wasLive: boolean;
          isLive: boolean;
          viewerCount: number;
          title: string;
          gameName: string;
          startedAt: Date | null;
        }[] = [];
        const liveUpdates: {
          channelId: string;
          twitchId: string;
          viewerCount: number;
          title: string;
          gameName: string;
          startedAt: Date | null;
        }[] = [];
        const changedTwitchIds = new Set<string>();

        try {
          const streams = await twurpleHelixService.getStreamsByUserIds(twitchIds);
          const streamMap = new Map(streams.map((stream) => [stream.userId, stream]));

          for (const channel of batch) {
            const stream = streamMap.get(channel.twitchChannelId);
            const isLive = !!stream;
            const wasLive = channel.isLive;

            if (isLive) {
              liveCount++;
              const viewerCount = stream.viewerCount;
              const title = stream.title;
              const gameName = stream.gameName;
              const startedAt = stream.startedAt ?? null;
              const nowMs = Date.now();
              const metadataChanged =
                channel.currentViewerCount !== viewerCount ||
                channel.currentTitle !== title ||
                channel.currentGameName !== gameName ||
                channel.currentStreamStartedAt?.getTime() !== startedAt?.getTime();

              if (
                (!wasLive || metadataChanged) &&
                shouldEmitChannelUpdate(channel.id, !wasLive, nowMs)
              ) {
                webSocketGateway.broadcastStreamStatus("channel.update", {
                  channelId: channel.id,
                  channelName: channel.channelName,
                  twitchChannelId: channel.twitchChannelId,
                  title,
                  gameName,
                  viewerCount,
                  startedAt,
                });
              }

              if (metadataChanged) {
                liveUpdates.push({
                  channelId: channel.id,
                  twitchId: channel.twitchChannelId,
                  viewerCount,
                  title,
                  gameName,
                  startedAt,
                });
              }
            } else {
              offlineCount++;
            }

            if (wasLive !== isLive) {
              changedUpdates.push({
                channelId: channel.id,
                channelName: channel.channelName,
                twitchId: channel.twitchChannelId,
                wasLive,
                isLive,
                viewerCount: isLive ? stream.viewerCount : 0,
                title: isLive ? stream.title : "",
                gameName: isLive ? stream.gameName : "",
                startedAt: isLive ? stream.startedAt : null,
              });
              changedTwitchIds.add(channel.twitchChannelId);
            }
          }

          const channelsNeedingCheckUpdate = batch.filter(
            (c) =>
              !c.lastLiveCheckAt ||
              now.getTime() - c.lastLiveCheckAt.getTime() > LAST_CHECK_UPDATE_INTERVAL_MS
          );
          const checkUpdateCandidates = selectChannelsForCheckUpdate(
            channelsNeedingCheckUpdate,
            adaptiveSlowPollGroups,
            slowPollIndex,
            Math.max(0, checkUpdateBudget)
          );
          checkUpdateBudget = Math.max(0, checkUpdateBudget - checkUpdateCandidates.length);

          if (changedUpdates.length === 0 && liveUpdates.length === 0) {
            await updateChannelsCheckTimeOnly(checkUpdateCandidates, now, batch.length);
          } else {
            const result = await updateChannelsWithChanges(
              changedUpdates,
              liveUpdates,
              checkUpdateCandidates,
              changedTwitchIds,
              now
            );
            updateSuccessCount += result.successCount;
            updateFailCount += result.failCount;
            totalChangedUpdates += changedUpdates.length;
          }

          if (changedUpdates.length > 0) {
            const nowMs = Date.now();
            for (const update of changedUpdates) {
              if (!update.wasLive && update.isLive) {
                if (shouldEmitStreamOnline(update.channelId, nowMs)) {
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
                } else {
                  logger.debug(
                    "Jobs",
                    `stream.online 防抖跳過: ${update.channelName} (距上次通知未滿 ${STREAM_ONLINE_DEBOUNCE_MS / 1000}s)`
                  );
                }
              } else if (update.wasLive && !update.isLive) {
                webSocketGateway.broadcastStreamStatus("stream.offline", {
                  channelId: update.channelId,
                  channelName: update.channelName,
                  twitchChannelId: update.twitchId,
                });
                offlineChanges++;
              }
            }
          }
        } catch (err) {
          logger.error("Jobs", `批次取得直播狀態失敗（cursor=${cursorId ?? "start"}）`, err);
        }

        if (i + BATCH_SIZE < channels.length) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }

      if (fetchedBatch.length < CHANNEL_QUERY_BATCH_SIZE) {
        break;
      }
    }

    if (processedCount === 0) {
      logger.debug("Jobs", "本輪慢速輪詢未命中任何頻道，略過更新");
      return;
    }

    // 記錄更新結果
    if (updateFailCount > 0) {
      logger.warn(
        "Jobs",
        `批次更新完成: 成功 ${updateSuccessCount}/${processedCount}, 失敗 ${updateFailCount}`
      );
    }

    // 4. 輸出結果
    const duration = Date.now() - startTime;
    if (onlineChanges > 0 || offlineChanges > 0) {
      logger.info(
        "Jobs",
        `直播狀態更新: ${onlineChanges} 個上線, ${offlineChanges} 個下線 (${liveCount} 直播中, ${offlineCount} 離線, DB寫入: ${totalChangedUpdates}/${processedCount}) [${duration}ms]`
      );
    } else {
      logger.debug(
        "Jobs",
        `✅ 直播狀態更新完成: 已檢查 ${processedCount} 個頻道, ${liveCount} 直播中, ${offlineCount} 離線, DB寫入: ${totalChangedUpdates} [${duration}ms]`
      );
    }

    recordJobSuccess(JOB_CIRCUIT_BREAKER_NAME);
  } catch (error) {
    logger.error("Jobs", "直播狀態更新任務執行失敗", error);
    recordJobFailure(JOB_CIRCUIT_BREAKER_NAME, error);
  } finally {
    // 確保解鎖，即使發生錯誤
    isRunning = false;
    // 第一輪完成後解除限制，後續正常發送通知
    if (isFirstRun) {
      isFirstRun = false;
    }
  }
}

