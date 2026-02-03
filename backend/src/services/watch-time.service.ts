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
const MESSAGE_PAGE_SIZE = 1000; // 分段查詢訊息（降低記憶體峰值）

interface WatchSession {
  startTime: Date;
  endTime: Date;
  durationSeconds: number;
}

interface WatchTimeAccumulator {
  currentStart: Date | null;
  lastMessage: Date | null;
  totalSeconds: number;
}

/**
 * 根據訊息時間戳計算觀看區段
 * @param messageTimestamps - 訊息時間戳陣列（已排序）
 * @param streamStartTime - 直播開始時間（可選，用於限制開始時間）
 * @param streamEndTime - 直播結束時間（可選，用於限制結束時間）
 */
export function calculateWatchSessions(
  messageTimestamps: Date[],
  streamStartTime?: Date,
  streamEndTime?: Date
): WatchSession[] {
  if (messageTimestamps.length === 0) {
    return [];
  }

  // 確保訊息按時間排序
  const sorted = [...messageTimestamps].sort((a, b) => a.getTime() - b.getTime());

  const sessions: WatchSession[] = [];
  let currentSession: { start: Date; lastMessage: Date } | null = null;

  for (const msgTime of sorted) {
    if (!currentSession) {
      // 開始新區段
      let startTime = new Date(msgTime.getTime() - PRE_MESSAGE_BUFFER_MIN * 60 * 1000);

      // 不早於直播開始時間
      if (streamStartTime && startTime < streamStartTime) {
        startTime = streamStartTime;
      }

      currentSession = {
        start: startTime,
        lastMessage: msgTime,
      };
    } else {
      // 檢查是否需要開始新區段
      const previousSessionEnd = new Date(
        currentSession.lastMessage.getTime() + POST_MESSAGE_BUFFER_MIN * 60 * 1000
      );

      if (msgTime > previousSessionEnd) {
        // 上一區段已結束，儲存並開始新區段
        let endTime = previousSessionEnd;

        // 不晚於直播結束時間
        if (streamEndTime && endTime > streamEndTime) {
          endTime = streamEndTime;
        }

        sessions.push({
          startTime: currentSession.start,
          endTime,
          durationSeconds: Math.max(0, (endTime.getTime() - currentSession.start.getTime()) / 1000),
        });

        // 開始新區段
        let startTime = new Date(msgTime.getTime() - PRE_MESSAGE_BUFFER_MIN * 60 * 1000);
        if (streamStartTime && startTime < streamStartTime) {
          startTime = streamStartTime;
        }

        currentSession = {
          start: startTime,
          lastMessage: msgTime,
        };
      } else {
        // 延長當前區段
        currentSession.lastMessage = msgTime;
      }
    }
  }

  // 處理最後一個區段
  if (currentSession) {
    let endTime = new Date(
      currentSession.lastMessage.getTime() + POST_MESSAGE_BUFFER_MIN * 60 * 1000
    );

    if (streamEndTime && endTime > streamEndTime) {
      endTime = streamEndTime;
    }

    sessions.push({
      startTime: currentSession.start,
      endTime,
      durationSeconds: Math.max(0, (endTime.getTime() - currentSession.start.getTime()) / 1000),
    });
  }

  return sessions;
}

/**
 * 計算總觀看秒數
 */
export function calculateTotalWatchSeconds(sessions: WatchSession[]): number {
  return sessions.reduce((sum, s) => sum + s.durationSeconds, 0);
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
 * @param viewerId - 觀眾 ID
 * @param channelId - 頻道 ID
 * @param date - 日期（會被正規化到當天 00:00:00）
 */
export async function updateViewerWatchTime(
  viewerId: string,
  channelId: string,
  date: Date
): Promise<void> {
  try {
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
    let lastTimestamp: Date | null = null;
    let lastId: string | null = null;

    while (true) {
      const messages = await prisma.viewerChannelMessage.findMany({
        where: {
          viewerId,
          channelId,
          timestamp: {
            gte: dayStart,
            lt: dayEnd,
          },
          ...(lastTimestamp && lastId
            ? {
                OR: [
                  { timestamp: { gt: lastTimestamp } },
                  { timestamp: lastTimestamp, id: { gt: lastId } },
                ],
              }
            : {}),
        },
        select: {
          id: true,
          timestamp: true,
        },
        orderBy: [{ timestamp: "asc" }, { id: "asc" }],
        take: MESSAGE_PAGE_SIZE,
      });

      if (messages.length === 0) {
        break;
      }

      for (const message of messages) {
        totalMessages++;
        accumulator = accumulateWatchTime(
          accumulator,
          message.timestamp,
          streamStartTime,
          streamEndTime
        );
        lastTimestamp = message.timestamp;
        lastId = message.id;
      }
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

export const watchTimeService = {
  calculateWatchSessions,
  calculateTotalWatchSeconds,
  updateViewerWatchTime,
};
