import { Prisma } from "@prisma/client";

import { prisma } from "../db/prisma";

type SqliteIndexRow = { name: string };

const REQUIRED_INDEX = "channels_isMonitored_id_idx";

async function main(): Promise<void> {
  console.log("\n[SCHEMA-02] 檢查 update-live-status 索引\n");

  const indexRows = await prisma.$queryRaw<SqliteIndexRow[]>(Prisma.sql`
    SELECT indexname AS name
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = ${REQUIRED_INDEX}
  `);

  if (indexRows.length === 0) {
    console.error(`缺少索引: ${REQUIRED_INDEX}`);
    console.error(
      "請在目標資料庫套用 prisma/migrations/manual_20260219_channels_isMonitored_id_idx.sql"
    );
    process.exitCode = 1;
    return;
  }

  console.log(`索引已存在: ${REQUIRED_INDEX}`);

  const planRows = await prisma.$queryRaw<Array<{ "QUERY PLAN": string }>>(Prisma.sql`
    EXPLAIN
    SELECT id, "twitchChannelId"
    FROM channels
    WHERE "isMonitored" = true
      AND "twitchChannelId" != ''
    ORDER BY id ASC
    LIMIT 50
  `);

  console.log(`Query plan: ${planRows.map((row) => row["QUERY PLAN"]).join(" | ")}`);
  console.log("\nSCHEMA-02 驗證通過。\n");
}

main()
  .catch((error) => {
    console.error("SCHEMA-02 驗證腳本執行失敗:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
