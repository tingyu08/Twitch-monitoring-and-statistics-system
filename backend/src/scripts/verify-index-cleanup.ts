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

type SqliteIndexRow = { name: string };
type QueryPlanRow = { detail: string };

async function printQueryPlan(label: string, query: Prisma.Sql): Promise<void> {
  const rows = await prisma.$queryRaw<QueryPlanRow[]>(query);
  const details = rows.map((row) => row.detail).join(" | ");
  console.log(`- ${label}: ${details}`);
}

async function main(): Promise<void> {
  console.log("\n[SCHEMA-01] 檢查索引清理狀態\n");

  const indexRows = await prisma.$queryRaw<SqliteIndexRow[]>(Prisma.sql`
    SELECT name
    FROM sqlite_master
    WHERE type = 'index'
      AND name NOT LIKE 'sqlite_%'
    ORDER BY name
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
  await printQueryPlan(
    "channel_daily_stats(channelId, date)",
    Prisma.sql`EXPLAIN QUERY PLAN SELECT * FROM channel_daily_stats WHERE channelId = ${"demo-channel"} AND date = ${"2026-02-13"} LIMIT 1`
  );
  await printQueryPlan(
    "viewer_channel_daily_stats(viewerId, channelId, date)",
    Prisma.sql`EXPLAIN QUERY PLAN SELECT * FROM viewer_channel_daily_stats WHERE viewerId = ${"demo-viewer"} AND channelId = ${"demo-channel"} AND date = ${"2026-02-13"} LIMIT 1`
  );

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
