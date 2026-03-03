import { Prisma } from "@prisma/client";

import { prisma } from "../db/prisma";

type CountRow = { c: number | bigint | string };
type ColumnRow = { name: string };

function toNumber(value: number | bigint | string | null | undefined): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

async function queryCount(sql: Prisma.Sql): Promise<number> {
  const rows = await prisma.$queryRaw<CountRow[]>(sql);
  return toNumber(rows[0]?.c);
}

async function hasSourceColumn(): Promise<boolean> {
  const columns = await prisma.$queryRaw<ColumnRow[]>(Prisma.sql`
    SELECT name
    FROM pragma_table_info('viewer_channel_daily_stats')
  `);

  return columns.some((col) => col.name === "source");
}

async function main(): Promise<void> {
  console.log("[DB] Start normalizing viewer_channel_daily_stats");

  const beforeTotal = await queryCount(
    Prisma.sql`SELECT COUNT(*) AS c FROM viewer_channel_daily_stats`
  );
  const beforeDuplicateDays = await queryCount(Prisma.sql`
    SELECT COUNT(*) AS c
    FROM (
      SELECT viewerId, channelId, date(date) AS day, COUNT(*) AS rowsPerDay
      FROM viewer_channel_daily_stats
      GROUP BY viewerId, channelId, date(date)
      HAVING rowsPerDay > 1
    ) t
  `);

  const withSource = await hasSourceColumn();

  console.log(
    `[DB] Before cleanup: totalRows=${beforeTotal}, duplicateDays=${beforeDuplicateDays}, hasSource=${withSource}`
  );

  if (beforeTotal === 0 || beforeDuplicateDays === 0) {
    console.log("[DB] No duplicate days found. Skip cleanup.");
    return;
  }

  await prisma.$transaction(async (tx) => {
    if (withSource) {
      await tx.$executeRaw(Prisma.sql`
        CREATE TEMP TABLE tmp_viewer_daily_stats_agg AS
        SELECT
          viewerId,
          channelId,
          date(date) AS day,
          SUM(COALESCE(watchSeconds, 0)) AS watchSeconds,
          SUM(COALESCE(messageCount, 0)) AS messageCount,
          SUM(COALESCE(emoteCount, 0)) AS emoteCount,
          CASE
            WHEN SUM(CASE WHEN source = 'extension' THEN 1 ELSE 0 END) > 0 THEN 'extension'
            ELSE 'chat'
          END AS source,
          MIN(createdAt) AS createdAt,
          MAX(updatedAt) AS updatedAt
        FROM viewer_channel_daily_stats
        GROUP BY viewerId, channelId, date(date)
      `);

      await tx.$executeRaw(Prisma.sql`DELETE FROM viewer_channel_daily_stats`);

      await tx.$executeRaw(Prisma.sql`
        INSERT INTO viewer_channel_daily_stats (
          id,
          viewerId,
          channelId,
          date,
          watchSeconds,
          messageCount,
          emoteCount,
          source,
          createdAt,
          updatedAt
        )
        SELECT
          lower(hex(randomblob(16))) AS id,
          viewerId,
          channelId,
          day || 'T00:00:00.000+00:00' AS date,
          CAST(watchSeconds AS INTEGER) AS watchSeconds,
          CAST(messageCount AS INTEGER) AS messageCount,
          CAST(emoteCount AS INTEGER) AS emoteCount,
          source,
          createdAt,
          updatedAt
        FROM tmp_viewer_daily_stats_agg
      `);

      await tx.$executeRaw(Prisma.sql`DROP TABLE tmp_viewer_daily_stats_agg`);
    } else {
      await tx.$executeRaw(Prisma.sql`
        CREATE TEMP TABLE tmp_viewer_daily_stats_agg AS
        SELECT
          viewerId,
          channelId,
          date(date) AS day,
          SUM(COALESCE(watchSeconds, 0)) AS watchSeconds,
          SUM(COALESCE(messageCount, 0)) AS messageCount,
          SUM(COALESCE(emoteCount, 0)) AS emoteCount,
          MIN(createdAt) AS createdAt,
          MAX(updatedAt) AS updatedAt
        FROM viewer_channel_daily_stats
        GROUP BY viewerId, channelId, date(date)
      `);

      await tx.$executeRaw(Prisma.sql`DELETE FROM viewer_channel_daily_stats`);

      await tx.$executeRaw(Prisma.sql`
        INSERT INTO viewer_channel_daily_stats (
          id,
          viewerId,
          channelId,
          date,
          watchSeconds,
          messageCount,
          emoteCount,
          createdAt,
          updatedAt
        )
        SELECT
          lower(hex(randomblob(16))) AS id,
          viewerId,
          channelId,
          day || 'T00:00:00.000+00:00' AS date,
          CAST(watchSeconds AS INTEGER) AS watchSeconds,
          CAST(messageCount AS INTEGER) AS messageCount,
          CAST(emoteCount AS INTEGER) AS emoteCount,
          createdAt,
          updatedAt
        FROM tmp_viewer_daily_stats_agg
      `);

      await tx.$executeRaw(Prisma.sql`DROP TABLE tmp_viewer_daily_stats_agg`);
    }
  });

  const afterTotal = await queryCount(Prisma.sql`SELECT COUNT(*) AS c FROM viewer_channel_daily_stats`);
  const afterDuplicateDays = await queryCount(Prisma.sql`
    SELECT COUNT(*) AS c
    FROM (
      SELECT viewerId, channelId, date(date) AS day, COUNT(*) AS rowsPerDay
      FROM viewer_channel_daily_stats
      GROUP BY viewerId, channelId, date(date)
      HAVING rowsPerDay > 1
    ) t
  `);

  console.log(
    `[DB] Cleanup complete: totalRows=${afterTotal}, duplicateDays=${afterDuplicateDays}, reducedRows=${beforeTotal - afterTotal}`
  );
}

main()
  .catch((error) => {
    console.error("[DB] normalize-viewer-daily-stats failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
