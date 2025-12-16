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
  console.log("📊 [Cron] 開始執行每日訊息聚合任務...");

  try {
    // 計算聚合時間範圍（過去 24 小時）
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // 查詢需要聚合的資料
    const rawData = await prisma.viewerChannelMessage.groupBy({
      by: ["viewerId", "channelId"],
      where: {
        timestamp: {
          gte: yesterday,
          lt: now,
        },
      },
      _count: {
        id: true,
      },
    });

    if (rawData.length === 0) {
      console.log("📊 [Cron] 沒有需要聚合的資料");
      return;
    }

    // 對每個 viewer-channel 組合進行詳細聚合
    let upsertCount = 0;

    for (const group of rawData) {
      const { viewerId, channelId } = group;

      // 獲取該組合的詳細統計
      const detailedStats = await prisma.viewerChannelMessage.groupBy({
        by: ["messageType"],
        where: {
          viewerId,
          channelId,
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

      // 計算各類型數量
      const stats: AggregationResult = {
        viewerId,
        channelId,
        date: new Date(now.toISOString().split("T")[0]), // 今天的日期
        totalMessages: 0,
        chatMessages: 0,
        subscriptions: 0,
        cheers: 0,
        giftSubs: 0,
        raids: 0,
        totalBits: 0,
      };

      for (const stat of detailedStats) {
        const count = stat._count.id;
        stats.totalMessages += count;

        switch (stat.messageType) {
          case "CHAT":
            stats.chatMessages = count;
            break;
          case "SUBSCRIPTION":
            stats.subscriptions = count;
            break;
          case "CHEER":
            stats.cheers = count;
            stats.totalBits = stat._sum.bitsAmount || 0;
            break;
          case "GIFT_SUBSCRIPTION":
            stats.giftSubs = count;
            break;
          case "RAID":
            stats.raids = count;
            break;
        }
      }

      // Upsert 到聚合表
      await prisma.viewerChannelMessageDailyAgg.upsert({
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
      });

      upsertCount++;
    }

    const duration = Date.now() - startTime;
    console.log(
      `✅ [Cron] 訊息聚合完成: ${upsertCount} 筆記錄已更新 (耗時 ${duration}ms)`
    );
  } catch (error) {
    console.error("❌ [Cron] 訊息聚合失敗:", error);
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
      console.error("❌ [Cron] 訊息聚合任務執行失敗:", error);
    }
  });

  console.log("🕐 [Cron] 訊息聚合任務已啟動 (每小時執行)");
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
      message: `聚合任務執行失敗: ${
        error instanceof Error ? error.message : "未知錯誤"
      }`,
    };
  }
}
