import cron from "node-cron";
import { prisma } from "../db/prisma";
import { logger } from "../utils/logger";
import { lifetimeStatsAggregator } from "../services/lifetime-stats-aggregator.service";

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
      // 全量更新：從所有 Daily Stats 獲取
      const allStats = await prisma.viewerChannelDailyStat.findMany({
        select: { viewerId: true, channelId: true },
        distinct: ["viewerId", "channelId"],
      });
      const allMsgs = await prisma.viewerChannelMessageDailyAgg.findMany({
        select: { viewerId: true, channelId: true },
        distinct: ["viewerId", "channelId"],
      });

      allStats.forEach((s) => targets.add(`${s.viewerId}|${s.channelId}`));
      allMsgs.forEach((s) => targets.add(`${s.viewerId}|${s.channelId}`));
    } else {
      // 增量更新：找出過去 26 小時有變動的 (多留一點緩衝)
      const checkTime = new Date(Date.now() - 26 * 60 * 60 * 1000);

      const activeStats = await prisma.viewerChannelDailyStat.findMany({
        where: { updatedAt: { gte: checkTime } },
        select: { viewerId: true, channelId: true },
        distinct: ["viewerId", "channelId"],
      });

      const activeMsgs = await prisma.viewerChannelMessageDailyAgg.findMany({
        where: { updatedAt: { gte: checkTime } },
        select: { viewerId: true, channelId: true },
        distinct: ["viewerId", "channelId"],
      });

      activeStats.forEach((s) => targets.add(`${s.viewerId}|${s.channelId}`));
      activeMsgs.forEach((s) => targets.add(`${s.viewerId}|${s.channelId}`));
    }

    logger.info("CronJob", `找到 ${targets.size} 組觀眾-頻道配對需要更新`);

    const affectedChannels = new Set<string>();

    // 更新 Stats
    let processed = 0;
    for (const target of targets) {
      const [viewerId, channelId] = target.split("|");
      await lifetimeStatsAggregator.aggregateStats(viewerId, channelId);
      affectedChannels.add(channelId);

      processed++;
      if (processed % 100 === 0) {
        logger.info("CronJob", `已處理 ${processed}/${targets.size} 組配對...`);
      }
    }

    // 更新受影響頻道的 Ranking
    logger.info("CronJob", `正在更新 ${affectedChannels.size} 個頻道的排名...`);
    for (const channelId of affectedChannels) {
      await lifetimeStatsAggregator.updatePercentileRankings(channelId);
    }

    const duration = Date.now() - startTime;
    logger.info("CronJob", `Lifetime Stats 更新完成，耗時 ${duration}ms`);
  } catch (error) {
    logger.error("CronJob", "Lifetime Stats 更新失敗:", error);
  }
};
