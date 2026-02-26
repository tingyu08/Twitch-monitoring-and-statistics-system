/**
 * Watch Time Service
 *
 * 根據聊天訊息推算觀看時間
 * 使用「自然分段計時」邏輯
 */

import { prisma } from "../db/prisma";
import { logger } from "../utils/logger";

// 配置常數
const PRE_MESSAGE_BUFFER_MIN = 10; // 第一則訊息前假設看了 10 分鐘
const POST_MESSAGE_BUFFER_MIN = 30; // 最後一則訊息後假設繼續看 30 分鐘

interface WatchTimeAccumulator {
  currentStart: Date | null;
  lastMessage: Date | null;
  totalSeconds: number;
}

function accumulateWatchTime(
  accumulator: WatchTimeAccumulator,
  msgTime: Date,
  streamStartTime?: Date,
  streamEndTime?: Date
): WatchTimeAccumulator {
  if (!accumulator.currentStart || !accumulator.lastMessage) {
    let startTime = new Date(msgTime.getTime() - PRE_MESSAGE_BUFFER_MIN * 60 * 1000);

    if (streamStartTime && startTime < streamStartTime) {
      startTime = streamStartTime;
    }

    return {
      currentStart: startTime,
      lastMessage: msgTime,
      totalSeconds: accumulator.totalSeconds,
    };
  }

  const previousSessionEnd = new Date(
    accumulator.lastMessage.getTime() + POST_MESSAGE_BUFFER_MIN * 60 * 1000
  );

  if (msgTime > previousSessionEnd) {
    let endTime = previousSessionEnd;
    if (streamEndTime && endTime > streamEndTime) {
      endTime = streamEndTime;
    }

    const durationSeconds = Math.max(0, (endTime.getTime() - accumulator.currentStart.getTime()) / 1000);

    let nextStart = new Date(msgTime.getTime() - PRE_MESSAGE_BUFFER_MIN * 60 * 1000);
    if (streamStartTime && nextStart < streamStartTime) {
      nextStart = streamStartTime;
    }

    return {
      currentStart: nextStart,
      lastMessage: msgTime,
      totalSeconds: accumulator.totalSeconds + durationSeconds,
    };
  }

  return {
    currentStart: accumulator.currentStart,
    lastMessage: msgTime,
    totalSeconds: accumulator.totalSeconds,
  };
}

/**
 * 更新使用者在特定頻道特定日期的觀看時間
 *
 * ⚠️ Single-Writer 策略說明：
 * 為避免資料不一致，本系統採用單一寫入源策略：
 *
 * - **Primary Writer**: watch-time-increment.job
 *   - 每 6 分鐘增量更新在線觀眾的 watchSeconds
 *   - 使用 SQL 的 `UPDATE SET watchSeconds = watchSeconds + 360`
 *   - 這是唯一的生產環境寫入路徑
 *
 * - **Recalculation Mode**: 僅用於修正/對帳（需明確啟用）
 *   - 設定 `allowOverwrite: true` 時，會從訊息重新計算並覆蓋現有資料
 *   - 使用場景：手動資料修正、夜間對帳任務
 *   - ⚠️ 不應在常規業務流程中使用，會導致與 increment job 的競態條件
 *
 * @param viewerId - 觀眾 ID
 * @param channelId - 頻道 ID
 * @param date - 日期（會被正規化到當天 00:00:00）
 * @param options.allowOverwrite - 是否允許覆蓋現有資料（預設 false，保護資料完整性）
 *   - `false` (預設): 跳過重算，保護 Primary Writer 的資料
 *   - `true`: 從訊息重新計算，用於手動修正或對帳任務
 */
export async function updateViewerWatchTime(
  viewerId: string,
  channelId: string,
  date: Date,
  options?: { allowOverwrite?: boolean }
): Promise<void> {
  try {
    // Single-writer strategy:
    // - Primary writer: watch-time-increment.job (incremental updates)
    // - Recalculation overwrite: opt-in only (manual/nightly reconciliation)
    if (!options?.allowOverwrite) {
      logger.debug(
        "WatchTime",
        `Skip overwrite recalculation for viewer ${viewerId} channel ${channelId} (single writer mode)`
      );
      return;
    }

    // 正規化日期到當天開始
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);

    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    // 嘗試獲取該頻道當天的直播 Session（如果有的話）
    let streamStartTime: Date | undefined;
    let streamEndTime: Date | undefined;

    const streamSession = await prisma.streamSession.findFirst({
      where: {
        channelId,
        startedAt: {
          gte: dayStart,
          lt: dayEnd,
        },
      },
      select: {
        startedAt: true,
        endedAt: true,
      },
      orderBy: {
        startedAt: "asc",
      },
    });

    if (streamSession) {
      streamStartTime = streamSession.startedAt;
      streamEndTime = streamSession.endedAt || undefined;
    }

    let accumulator: WatchTimeAccumulator = {
      currentStart: null,
      lastMessage: null,
      totalSeconds: 0,
    };
    let totalMessages = 0;

    // B4 優化：單次查詢取代分頁 + OR keyset 條件，降低 DB round-trip
    const messages = await prisma.viewerChannelMessage.findMany({
      where: {
        viewerId,
        channelId,
        timestamp: {
          gte: dayStart,
          lt: dayEnd,
        },
      },
      select: {
        timestamp: true,
      },
      orderBy: [{ timestamp: "asc" }, { id: "asc" }],
    });

    for (const message of messages) {
      totalMessages++;
      accumulator = accumulateWatchTime(
        accumulator,
        message.timestamp,
        streamStartTime,
        streamEndTime
      );
    }

    if (totalMessages === 0) {
      return;
    }

    if (accumulator.currentStart && accumulator.lastMessage) {
      let endTime = new Date(
        accumulator.lastMessage.getTime() + POST_MESSAGE_BUFFER_MIN * 60 * 1000
      );

      if (streamEndTime && endTime > streamEndTime) {
        endTime = streamEndTime;
      }

      accumulator.totalSeconds += Math.max(
        0,
        (endTime.getTime() - accumulator.currentStart.getTime()) / 1000
      );
    }

    const totalWatchSeconds = accumulator.totalSeconds;

    // 更新資料庫
    await prisma.viewerChannelDailyStat.upsert({
      where: {
        viewerId_channelId_date: {
          viewerId,
          channelId,
          date: dayStart,
        },
      },
      create: {
        viewerId,
        channelId,
        date: dayStart,
        watchSeconds: Math.round(totalWatchSeconds),
        messageCount: totalMessages,
        emoteCount: 0,
      },
      update: {
        watchSeconds: Math.round(totalWatchSeconds),
      },
    });

    logger.debug(
      "WatchTime",
      `Updated watch time for viewer ${viewerId} in channel ${channelId}: ${Math.round(
        totalWatchSeconds / 60
      )} min`
    );
  } catch (error) {
    logger.error("WatchTime", "Failed to update watch time", error);
  }
}
