import { Prisma } from "@prisma/client";

import { prisma } from "../db/prisma";
import { lifetimeStatsAggregator } from "../services/lifetime-stats-aggregator.service";

type ChannelRow = {
  channelId: string;
  count: number;
};

function toMb(bytes: number): number {
  return Math.round((bytes / 1024 / 1024) * 100) / 100;
}

async function getTopChannels(limit: number): Promise<ChannelRow[]> {
  const rows = await prisma.$queryRaw<Array<{ channelId: string; cnt: number | string }>>(Prisma.sql`
    SELECT channelId, COUNT(*) AS cnt
    FROM viewer_channel_lifetime_stats
    GROUP BY channelId
    ORDER BY cnt DESC
    LIMIT ${limit}
  `);

  return rows.map((row) => ({
    channelId: row.channelId,
    count: Number(row.cnt),
  }));
}

async function main(): Promise<void> {
  const sampleChannels = Number(process.env.LIFETIME_RANKING_VERIFY_CHANNELS || 3);
  const maxAllowedDeltaMb = Number(process.env.LIFETIME_RANKING_MAX_DELTA_MB || 80);

  console.log("\n[MEM-02] lifetime ranking memory verification\n");
  const channels = await getTopChannels(sampleChannels);

  if (channels.length === 0) {
    console.log("No lifetime stats data found; skip verification.");
    return;
  }

  let worstDelta = 0;
  for (const channel of channels) {
    const beforeRss = process.memoryUsage().rss;
    const started = Date.now();

    await lifetimeStatsAggregator.updatePercentileRankings(channel.channelId);

    const durationMs = Date.now() - started;
    const afterRss = process.memoryUsage().rss;
    const delta = Math.max(0, afterRss - beforeRss);
    worstDelta = Math.max(worstDelta, delta);

    console.log(
      `- channel=${channel.channelId} rows=${channel.count} duration=${durationMs}ms rssDelta=${toMb(delta)}MB`
    );
  }

  const worstDeltaMb = toMb(worstDelta);
  const passed = worstDeltaMb <= maxAllowedDeltaMb;
  console.log(`\nworstDelta=${worstDeltaMb}MB, threshold=${maxAllowedDeltaMb}MB, passed=${passed}\n`);

  if (!passed) {
    process.exitCode = 1;
  }
}

void main()
  .catch((error) => {
    console.error("verify-lifetime-ranking-memory failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
