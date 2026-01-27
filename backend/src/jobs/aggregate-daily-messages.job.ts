/**
 * Cron Job: 每日訊息聚合任務
 *
 * 功能：
 * - 從 ViewerChannelMessage 表聚合資料到 ViewerChannelMessageDailyAgg 表
 * - 統計每日的留言數、訂閱數、Cheers 數等
 *
 * 排程：每小時執行一次（聚合過去 24 小時的資料）
 */

import cron from "node-cron";
import { prisma } from "../db/prisma";
import { logger } from "../utils/logger";

interface AggregationResult {
  viewerId: string;
  channelId: string;
  date: Date;
  totalMessages: number;
  chatMessages: number;
  subscriptions: number;
  cheers: number;
  giftSubs: number;
  raids: number;
  totalBits: number;
}

/**
 * 執行訊息聚合
 */
export async function aggregateDailyMessages(): Promise<void> {
  const startTime = Date.now();
  logger.info("Cron", "開始執行每日訊息聚合任務...");

  try {
    // 計算聚合時間範圍（過去 24 小時）
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // 一次查詢所有資料，包含 messageType（修復 N+1 問題）
    const allMessages = await prisma.viewerChannelMessage.groupBy({
      by: ["viewerId", "channelId", "messageType"],
      where: {
        timestamp: {
          gte: yesterday,
          lt: now,
        },
      },
      _count: {
        id: true,
      },
      _sum: {
        bitsAmount: true,
      },
    });

    if (allMessages.length === 0) {
      logger.info("Cron", "沒有需要聚合的資料");
      return;
    }

    // 在記憶體中聚合資料
    const aggregatedMap = new Map<string, AggregationResult>();
    const todayDate = new Date(now.toISOString().split("T")[0]);

    for (const msg of allMessages) {
      const key = `${msg.viewerId}|${msg.channelId}`;
      let stats = aggregatedMap.get(key);

      if (!stats) {
        stats = {
          viewerId: msg.viewerId,
          channelId: msg.channelId,
          date: todayDate,
          totalMessages: 0,
          chatMessages: 0,
          subscriptions: 0,
          cheers: 0,
          giftSubs: 0,
          raids: 0,
          totalBits: 0,
        };
        aggregatedMap.set(key, stats);
      }

      const count = msg._count.id;
      stats.totalMessages += count;

      switch (msg.messageType) {
        case "CHAT":
          stats.chatMessages += count;
          break;
        case "SUBSCRIPTION":
          stats.subscriptions += count;
          break;
        case "CHEER":
          stats.cheers += count;
          stats.totalBits += msg._sum.bitsAmount || 0;
          break;
        case "GIFT_SUBSCRIPTION":
          stats.giftSubs += count;
          break;
        case "RAID":
          stats.raids += count;
          break;
      }
    }

    // 批次 Upsert 到聚合表
    let upsertCount = 0;
    const statsArray = Array.from(aggregatedMap.values());

    // 使用 transaction 批次處理，每批 50 筆
    const BATCH_SIZE = 50;
    for (let i = 0; i < statsArray.length; i += BATCH_SIZE) {
      const batch = statsArray.slice(i, i + BATCH_SIZE);

      await prisma.$transaction(
        batch.map((stats) =>
          prisma.viewerChannelMessageDailyAgg.upsert({
            where: {
              viewerId_channelId_date: {
                viewerId: stats.viewerId,
                channelId: stats.channelId,
                date: stats.date,
              },
            },
            update: {
              totalMessages: stats.totalMessages,
              chatMessages: stats.chatMessages,
              subscriptions: stats.subscriptions,
              cheers: stats.cheers,
              giftSubs: stats.giftSubs,
              raids: stats.raids,
              totalBits: stats.totalBits,
            },
            create: stats,
          })
        )
      );

      upsertCount += batch.length;
    }

    const duration = Date.now() - startTime;
    logger.info("Cron", `訊息聚合完成: ${upsertCount} 筆記錄已更新 (耗時 ${duration}ms)`);
  } catch (error) {
    logger.error("Cron", "訊息聚合失敗:", error);
    throw error;
  }
}

/**
 * 啟動定時任務
 */
export function startMessageAggregationJob(): void {
  // 每小時執行一次（在每小時的第 5 分鐘執行）
  cron.schedule("5 * * * *", async () => {
    try {
      await aggregateDailyMessages();
    } catch (error) {
      logger.error("Cron", "訊息聚合任務執行失敗:", error);
    }
  });

  logger.info("Cron", "訊息聚合任務已啟動 (每小時執行)");
}

/**
 * 手動觸發聚合（用於測試或管理員操作）
 */
export async function manualAggregation(): Promise<{
  success: boolean;
  message: string;
}> {
  try {
    await aggregateDailyMessages();
    return { success: true, message: "聚合任務執行成功" };
  } catch (error) {
    return {
      success: false,
      message: `聚合任務執行失敗: ${error instanceof Error ? error.message : "未知錯誤"}`,
    };
  }
}
