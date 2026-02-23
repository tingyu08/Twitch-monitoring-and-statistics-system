import { Prisma } from "@prisma/client";

import { prisma } from "../db/prisma";

async function main(): Promise<void> {
  console.log("\n[SCHEMA-03] 套用 channels_isMonitored_id_idx\n");

  try {
    await prisma.$executeRaw(Prisma.sql`
      CREATE INDEX IF NOT EXISTS "channels_isMonitored_id_idx"
        ON "channels"("isMonitored", "id")
    `);
  } catch (error) {
    console.error("索引建立失敗。請確認目前連線到正確資料庫且 channels 表存在。", error);
    process.exitCode = 1;
    return;
  }

  const indexRows = await prisma.$queryRaw<Array<{ name: string }>>(Prisma.sql`
    SELECT name
    FROM sqlite_master
    WHERE type = 'index'
      AND name = 'channels_isMonitored_id_idx'
  `);

  if (indexRows.length === 0) {
    console.error("索引建立後仍查無結果，請手動檢查資料庫權限/連線。\n");
    process.exitCode = 1;
    return;
  }

  console.log("索引已建立: channels_isMonitored_id_idx\n");
}

main()
  .catch((error) => {
    console.error("SCHEMA-03 執行失敗:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
