import cron from "node-cron";
import pLimit from "p-limit";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { logger } from "../utils/logger";
import { lifetimeStatsAggregator } from "../services/lifetime-stats-aggregator.service";
import { refreshViewerChannelSummaryForViewer } from "../modules/viewer/viewer.service";
import { captureJobError } from "./job-error-tracker";

// 批次處理大小
const BATCH_SIZE = 50;

// 查詢批次大小（避免一次性 findMany 造成記憶體尖峰）
const TARGET_QUERY_BATCH_SIZE = 2000;

// P0 Fix: 限制並行度，避免同時發送過多 DB 查詢
const CONCURRENCY_LIMIT = 5;

function appendPairTarget(targets: Set<string>, viewerId: string, channelId: string): void {
  targets.add(`${viewerId}|${channelId}`);
}

async function collectTargetsFromDailyStats(
  targets: Set<string>,
  where?: Prisma.ViewerChannelDailyStatWhereInput
): Promise<void> {
  let cursorId: string | undefined;

  while (true) {
    const rows = await prisma.viewerChannelDailyStat.findMany({
      where,
      select: {
        id: true,
        viewerId: true,
        channelId: true,
      },
      orderBy: { id: "asc" },
      take: TARGET_QUERY_BATCH_SIZE,
      ...(cursorId
        ? {
            cursor: { id: cursorId },
            skip: 1,
          }
        : {}),
    });

    if (rows.length === 0) break;

    for (const row of rows) {
      appendPairTarget(targets, row.viewerId, row.channelId);
    }

    cursorId = rows[rows.length - 1]?.id;
    if (rows.length < TARGET_QUERY_BATCH_SIZE) break;
  }
}

async function collectTargetsFromMessageAgg(
  targets: Set<string>,
  where?: Prisma.ViewerChannelMessageDailyAggWhereInput
): Promise<void> {
  let cursorId: string | undefined;

  while (true) {
    const rows = await prisma.viewerChannelMessageDailyAgg.findMany({
      where,
      select: {
        id: true,
        viewerId: true,
        channelId: true,
      },
      orderBy: { id: "asc" },
      take: TARGET_QUERY_BATCH_SIZE,
      ...(cursorId
        ? {
            cursor: { id: cursorId },
            skip: 1,
          }
        : {}),
    });

    if (rows.length === 0) break;

    for (const row of rows) {
      appendPairTarget(targets, row.viewerId, row.channelId);
    }

    cursorId = rows[rows.length - 1]?.id;
    if (rows.length < TARGET_QUERY_BATCH_SIZE) break;
  }
}

export const updateLifetimeStatsJob = () => {
  // 每天凌晨 2 點執行
  cron.schedule("0 2 * * *", async () => {
    await runLifetimeStatsUpdate();
  });
};

export const runLifetimeStatsUpdate = async (fullUpdate = false) => {
  logger.info("CronJob", `開始執行 Lifetime Stats 更新 (完整更新: ${fullUpdate})...`);
  const startTime = Date.now();

  try {
    let targets = new Set<string>();

    if (fullUpdate) {
      // 全量更新：使用分頁掃描，避免無上限查詢導致 OOM
      await Promise.all([
        collectTargetsFromDailyStats(targets),
        collectTargetsFromMessageAgg(targets),
      ]);
    } else {
      // 增量更新：找出過去 26 小時有變動的 (多留一點緩衝)
      const checkTime = new Date(Date.now() - 26 * 60 * 60 * 1000);

      await Promise.all([
        collectTargetsFromDailyStats(targets, { updatedAt: { gte: checkTime } }),
        collectTargetsFromMessageAgg(targets, { updatedAt: { gte: checkTime } }),
      ]);
    }

    logger.info("CronJob", `找到 ${targets.size} 組觀眾-頻道配對需要更新`);

    const affectedChannels = new Set<string>();
    const affectedViewers = new Set<string>();

    // 批次並行處理 Stats（修復 N+1 問題）
    // P0 Fix: 使用 p-limit 限制並行度
    const limit = pLimit(CONCURRENCY_LIMIT);
    let processed = 0;
    const targetArray = Array.from(targets);

    for (let i = 0; i < targetArray.length; i += BATCH_SIZE) {
      const batch = targetArray.slice(i, i + BATCH_SIZE);

      await Promise.all(
        batch.map((target) =>
          limit(async () => {
            const [viewerId, channelId] = target.split("|");
            await lifetimeStatsAggregator.aggregateStats(viewerId, channelId);
            affectedChannels.add(channelId);
            affectedViewers.add(viewerId);
          })
        )
      );

      processed += batch.length;
      if (processed % 100 === 0 || processed === targetArray.length) {
        logger.info("CronJob", `已處理 ${processed}/${targets.size} 組配對...`);
      }

      // P0 Fix: 批次間延遲，讓系統喘息
      if (i + BATCH_SIZE < targetArray.length) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }

    // 批次更新受影響頻道的 Ranking
    // P0 Fix: 使用 p-limit 限制並行度
    logger.info("CronJob", `正在更新 ${affectedChannels.size} 個頻道的排名...`);
    const channelArray = Array.from(affectedChannels);

    for (let i = 0; i < channelArray.length; i += BATCH_SIZE) {
      const batch = channelArray.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map((channelId) =>
          limit(() => lifetimeStatsAggregator.updatePercentileRankings(channelId))
        )
      );

      // P0 Fix: 批次間延遲
      if (i + BATCH_SIZE < channelArray.length) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }

    // 刷新受影響觀眾的摘要表（viewer_channel_summary）
    const viewerArray = Array.from(affectedViewers);
    logger.info("CronJob", `正在刷新 ${viewerArray.length} 位觀眾的頻道摘要...`);

    for (let i = 0; i < viewerArray.length; i += BATCH_SIZE) {
      const batch = viewerArray.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map((viewerId) => limit(() => refreshViewerChannelSummaryForViewer(viewerId))));

      if (i + BATCH_SIZE < viewerArray.length) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }

    const duration = Date.now() - startTime;
    logger.info("CronJob", `Lifetime Stats 更新完成，耗時 ${duration}ms`);
  } catch (error) {
    logger.error("CronJob", "Lifetime Stats 更新失敗:", error);
    captureJobError("update-lifetime-stats", error, { fullUpdate });
  }
};
