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
import { captureJobError } from "./job-error-tracker";

const LAST_AGGREGATED_AT_KEY = "message_agg_last_aggregated_at";
const AGGREGATE_DAILY_MESSAGES_CRON = process.env.AGGREGATE_DAILY_MESSAGES_CRON || "15 * * * *";

/**
 * 執行訊息聚合
 */
export async function aggregateDailyMessages(): Promise<void> {
  const startTime = Date.now();
  logger.info("Cron", "開始執行每日訊息聚合任務...");

  try {
    const now = new Date();
    const defaultFrom = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const setting = await prisma.systemSetting.findUnique({
      where: { key: LAST_AGGREGATED_AT_KEY },
      select: { value: true },
    });

    const parsed = setting ? new Date(setting.value) : null;
    const fromDate = parsed && !Number.isNaN(parsed.getTime()) && parsed < now ? parsed : defaultFrom;

    if (fromDate >= now) {
      logger.info("Cron", "聚合時間區間為空，跳過");
      return;
    }

    const rows = await prisma.$queryRaw<{ count: number }[]>(Prisma.sql`
      SELECT COUNT(*) AS count
      FROM (
        SELECT viewerId, channelId
        FROM viewer_channel_messages
        WHERE timestamp >= ${fromDate} AND timestamp < ${now}
        GROUP BY viewerId, channelId, datetime(date(timestamp))
      )
    `);

    const upsertCount = rows[0]?.count ?? 0;

    if (upsertCount === 0) {
      await prisma.systemSetting.upsert({
        where: { key: LAST_AGGREGATED_AT_KEY },
        create: { key: LAST_AGGREGATED_AT_KEY, value: now.toISOString() },
        update: { value: now.toISOString() },
      });
      logger.info("Cron", "沒有需要聚合的資料");
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO viewer_channel_message_daily_aggs (
          id,
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
          lower(hex(randomblob(16))) AS id,
          viewerId,
          channelId,
          datetime(date(timestamp)) AS date,
          COUNT(*) AS totalMessages,
          SUM(CASE WHEN messageType = 'CHAT' THEN 1 ELSE 0 END) AS chatMessages,
          SUM(CASE WHEN messageType = 'SUBSCRIPTION' THEN 1 ELSE 0 END) AS subscriptions,
          SUM(CASE WHEN messageType = 'CHEER' THEN 1 ELSE 0 END) AS cheers,
          SUM(CASE WHEN messageType = 'GIFT_SUBSCRIPTION' THEN 1 ELSE 0 END) AS giftSubs,
          SUM(CASE WHEN messageType = 'RAID' THEN 1 ELSE 0 END) AS raids,
          SUM(CASE WHEN messageType = 'CHEER' THEN COALESCE(bitsAmount, 0) ELSE 0 END) AS totalBits,
          CURRENT_TIMESTAMP AS updatedAt
        FROM viewer_channel_messages
        WHERE timestamp >= ${fromDate} AND timestamp < ${now}
        GROUP BY viewerId, channelId, datetime(date(timestamp))
        ON CONFLICT(viewerId, channelId, date) DO UPDATE SET
          totalMessages = viewer_channel_message_daily_aggs.totalMessages + excluded.totalMessages,
          chatMessages = viewer_channel_message_daily_aggs.chatMessages + excluded.chatMessages,
          subscriptions = viewer_channel_message_daily_aggs.subscriptions + excluded.subscriptions,
          cheers = viewer_channel_message_daily_aggs.cheers + excluded.cheers,
          giftSubs = viewer_channel_message_daily_aggs.giftSubs + excluded.giftSubs,
          raids = viewer_channel_message_daily_aggs.raids + excluded.raids,
          totalBits = COALESCE(viewer_channel_message_daily_aggs.totalBits, 0) + COALESCE(excluded.totalBits, 0),
          updatedAt = CURRENT_TIMESTAMP
      `);

      await tx.systemSetting.upsert({
        where: { key: LAST_AGGREGATED_AT_KEY },
        create: { key: LAST_AGGREGATED_AT_KEY, value: now.toISOString() },
        update: { value: now.toISOString() },
      });
    });

    const duration = Date.now() - startTime;
    logger.info("Cron", `訊息聚合完成: ${upsertCount} 筆記錄已更新 (耗時 ${duration}ms)`);
  } catch (error) {
    logger.error("Cron", "訊息聚合失敗:", error);
    captureJobError("aggregate-daily-messages", error);
    throw error;
  }
}

/**
 * 啟動定時任務
 */
export function startMessageAggregationJob(): void {
  // 每小時執行一次（預設每小時第 15 分鐘）
  cron.schedule(AGGREGATE_DAILY_MESSAGES_CRON, async () => {
    try {
      await aggregateDailyMessages();
    } catch (error) {
      logger.error("Cron", "訊息聚合任務執行失敗:", error);
      captureJobError("aggregate-daily-messages-scheduler", error);
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
