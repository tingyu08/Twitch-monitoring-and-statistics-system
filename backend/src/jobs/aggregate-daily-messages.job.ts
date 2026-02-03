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
import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { logger } from "../utils/logger";

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

    const todayDate = new Date(now.toISOString().split("T")[0]);

    const rows = await prisma.$queryRaw<{ count: number }[]>(Prisma.sql`
      SELECT COUNT(*) AS count
      FROM (
        SELECT viewerId, channelId
        FROM viewer_channel_messages
        WHERE timestamp >= ${yesterday} AND timestamp < ${now}
        GROUP BY viewerId, channelId
      )
    `);

    const upsertCount = rows[0]?.count ?? 0;

    if (upsertCount === 0) {
      logger.info("Cron", "沒有需要聚合的資料");
      return;
    }

    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO viewer_channel_message_daily_aggs (
        viewerId,
        channelId,
        date,
        totalMessages,
        chatMessages,
        subscriptions,
        cheers,
        giftSubs,
        raids,
        totalBits,
        updatedAt
      )
      SELECT
        viewerId,
        channelId,
        ${todayDate} AS date,
        COUNT(*) AS totalMessages,
        SUM(CASE WHEN messageType = 'CHAT' THEN 1 ELSE 0 END) AS chatMessages,
        SUM(CASE WHEN messageType = 'SUBSCRIPTION' THEN 1 ELSE 0 END) AS subscriptions,
        SUM(CASE WHEN messageType = 'CHEER' THEN 1 ELSE 0 END) AS cheers,
        SUM(CASE WHEN messageType = 'GIFT_SUBSCRIPTION' THEN 1 ELSE 0 END) AS giftSubs,
        SUM(CASE WHEN messageType = 'RAID' THEN 1 ELSE 0 END) AS raids,
        SUM(CASE WHEN messageType = 'CHEER' THEN COALESCE(bitsAmount, 0) ELSE 0 END) AS totalBits,
        CURRENT_TIMESTAMP AS updatedAt
      FROM viewer_channel_messages
      WHERE timestamp >= ${yesterday} AND timestamp < ${now}
      GROUP BY viewerId, channelId
      ON CONFLICT(viewerId, channelId, date) DO UPDATE SET
        totalMessages = excluded.totalMessages,
        chatMessages = excluded.chatMessages,
        subscriptions = excluded.subscriptions,
        cheers = excluded.cheers,
        giftSubs = excluded.giftSubs,
        raids = excluded.raids,
        totalBits = excluded.totalBits,
        updatedAt = CURRENT_TIMESTAMP
    `);

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
