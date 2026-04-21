import { Prisma } from "@prisma/client";

import { prisma } from "../db/prisma";

const REMOVED_INDEX_NAMES = [
  "channel_daily_stats_channelId_date_idx",
  "viewer_channel_daily_stats_viewerId_channelId_date_idx",
  "user_follows_channelId_userType_idx",
  "idx_user_follows_channelId_userType",
  "viewer_channel_lifetime_stats_channelId_watchTimePercentile_idx",
  "viewer_channel_lifetime_stats_channelId_messagePercentile_idx",
  "idx_viewer_channel_lifetime_stats_channelId_watchTimePercentile",
  "idx_viewer_channel_lifetime_stats_channelId_messagePercentile",
] as const;

type PgIndexRow = { name: string };

async function main(): Promise<void> {
  console.log("\n[SCHEMA-01] 檢查索引清理狀態\n");

  const indexRows = await prisma.$queryRaw<PgIndexRow[]>(Prisma.sql`
    SELECT indexname AS name
    FROM pg_indexes
    WHERE schemaname = 'public'
    ORDER BY indexname
  `);

  const existing = new Set(indexRows.map((row) => row.name));
  const stillPresent = REMOVED_INDEX_NAMES.filter((indexName) => existing.has(indexName));

  if (stillPresent.length > 0) {
    console.error("以下冗餘索引仍存在，請先套用 manual_20260210_index_cleanup.sql:");
    stillPresent.forEach((indexName) => console.error(`  - ${indexName}`));
    process.exitCode = 1;
  } else {
    console.log("冗餘索引已清理完成。\n");
  }

  console.log("查詢計畫檢查（請確認有使用索引）:");

  const plan1 = await prisma.$queryRaw<Array<{ "QUERY PLAN": string }>>(Prisma.sql`
    EXPLAIN SELECT id, "twitchChannelId"
    FROM channel_daily_stats
    WHERE "channelId" = ${"demo-channel"}
      AND date = ${"2026-02-13"}
    LIMIT 1
  `);
  console.log(`- channel_daily_stats(channelId, date): ${plan1.map((r) => r["QUERY PLAN"]).join(" | ")}`);

  const plan2 = await prisma.$queryRaw<Array<{ "QUERY PLAN": string }>>(Prisma.sql`
    EXPLAIN SELECT id
    FROM viewer_channel_daily_stats
    WHERE "viewerId" = ${"demo-viewer"}
      AND "channelId" = ${"demo-channel"}
      AND date = ${"2026-02-13"}
    LIMIT 1
  `);
  console.log(`- viewer_channel_daily_stats(viewerId, channelId, date): ${plan2.map((r) => r["QUERY PLAN"]).join(" | ")}`);

  if (process.exitCode === 1) {
    console.error("\nSCHEMA-01 驗證未通過。\n");
    return;
  }

  console.log("\nSCHEMA-01 驗證通過。\n");
}

main()
  .catch((error) => {
    console.error("SCHEMA-01 驗證腳本執行失敗:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
