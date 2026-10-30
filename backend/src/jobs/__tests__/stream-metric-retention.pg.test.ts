/**
 * stream_metrics 降採樣 SQL 的整合測試（需要真的 PostgreSQL）
 *
 * 單元測試 mock 掉 prisma，驗證不到 SQL 本身；這支在 TEST_POSTGRES_URL 有設定時才執行：
 *   docker run --rm -d -p 55432:5432 -e POSTGRES_PASSWORD=test --name pg-test postgres:17
 *   TEST_POSTGRES_URL=postgresql://postgres:test@localhost:55432/postgres \
 *     npx jest src/jobs/__tests__/stream-metric-retention.pg.test.ts
 * 每次在獨立 schema 建表，跑完整個 drop 掉。
 */

import { Client, defaults } from "pg";

import { buildStreamMetricDownsampleSql } from "../stream-metric-retention";

const TEST_POSTGRES_URL = process.env.TEST_POSTGRES_URL;
const describePg = TEST_POSTGRES_URL ? describe : describe.skip;

// 欄位是 timestamp(3) without time zone（Prisma 預設），測試資料一律以 UTC 表示
defaults.parseInputDatesAsUTC = true;

const CUTOFF = new Date("2026-09-30T00:00:00Z");

interface MetricRow {
  id: string;
  streamSessionId: string;
  timestamp: string;
  viewerCount: number;
  chatCount: number | null;
}

describePg("buildStreamMetricDownsampleSql（PostgreSQL）", () => {
  const schema = `retention_test_${process.pid}_${Date.now()}`;
  let client: Client;

  async function insertMetric(
    id: string,
    sessionId: string,
    isoTimestamp: string,
    viewerCount: number,
    chatCount: number | null = 0
  ): Promise<void> {
    await client.query(
      `INSERT INTO stream_metrics (id, "streamSessionId", "timestamp", "viewerCount", "chatCount")
       VALUES ($1, $2, $3::timestamp, $4, $5)`,
      [id, sessionId, isoTimestamp, viewerCount, chatCount]
    );
  }

  async function runDownsample(batchSize = 2000): Promise<number> {
    const sql = buildStreamMetricDownsampleSql(CUTOFF, batchSize);
    const result = await client.query(sql.text, sql.values as unknown[]);
    return result.rowCount ?? 0;
  }

  async function rowsOf(sessionId: string): Promise<MetricRow[]> {
    const result = await client.query<MetricRow>(
      `SELECT id, "streamSessionId",
              to_char("timestamp", 'YYYY-MM-DD"T"HH24:MI:SS') AS "timestamp",
              "viewerCount", "chatCount"
         FROM stream_metrics WHERE "streamSessionId" = $1 ORDER BY "timestamp", id`,
      [sessionId]
    );
    return result.rows;
  }

  beforeAll(async () => {
    client = new Client({ connectionString: TEST_POSTGRES_URL });
    await client.connect();
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
  });

  afterAll(async () => {
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.end();
  });

  beforeEach(async () => {
    await client.query(`DROP TABLE IF EXISTS stream_metrics`);
    // 與正式環境（Prisma 產生）的欄位型別一致
    await client.query(`
      CREATE TABLE stream_metrics (
        id text PRIMARY KEY,
        "streamSessionId" text NOT NULL,
        "timestamp" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "viewerCount" integer NOT NULL DEFAULT 0,
        "chatCount" integer DEFAULT 0
      )`);
  });

  it("把截止日前同一場、同一小時的多筆合併成一筆（平均觀眾、加總聊天、取最早時間）", async () => {
    const viewers = [10, 20, 30, 40, 50, 60];
    for (const [i, v] of viewers.entries()) {
      await insertMetric(
        `a-${i}`,
        "session-a",
        `2026-09-20T10:${String(i * 10).padStart(2, "0")}:00`,
        v,
        1
      );
    }

    const merged = await runDownsample();

    expect(merged).toBe(1);
    const rows = await rowsOf("session-a");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      timestamp: "2026-09-20T10:00:00",
      viewerCount: 35,
      chatCount: 6,
    });
  });

  it("不同場次、不同小時分開合併；一小時只有一筆的不動", async () => {
    await insertMetric("a-1", "session-a", "2026-09-20T10:00:00", 10);
    await insertMetric("a-2", "session-a", "2026-09-20T10:30:00", 20);
    await insertMetric("a-single", "session-a", "2026-09-20T11:10:00", 99);
    await insertMetric("b-1", "session-b", "2026-09-20T10:00:00", 100);
    await insertMetric("b-2", "session-b", "2026-09-20T10:50:00", 300);

    const merged = await runDownsample();

    expect(merged).toBe(2);
    const sessionA = await rowsOf("session-a");
    expect(sessionA.map((r) => r.viewerCount)).toEqual([15, 99]);
    expect(sessionA[1].id).toBe("a-single");
    expect((await rowsOf("session-b")).map((r) => r.viewerCount)).toEqual([200]);
  });

  it("截止日之後的資料完全不動", async () => {
    for (let i = 0; i < 6; i++) {
      await insertMetric(`recent-${i}`, "session-recent", `2026-10-02T10:${i}0:00`, i);
    }

    expect(await runDownsample()).toBe(0);
    expect(await rowsOf("session-recent")).toHaveLength(6);
  });

  it("重跑是冪等的：第二次沒有東西可合併，資料不變", async () => {
    await insertMetric("a-1", "session-a", "2026-09-20T10:00:00", 10);
    await insertMetric("a-2", "session-a", "2026-09-20T10:10:00", 20);

    expect(await runDownsample()).toBe(1);
    const afterFirst = await rowsOf("session-a");

    expect(await runDownsample()).toBe(0);
    expect(await rowsOf("session-a")).toEqual(afterFirst);
  });

  it("每批最多處理 batchSize 個小時區段，分批跑完的結果與一次跑完相同", async () => {
    for (const hour of ["10", "11", "12"]) {
      await insertMetric(`a-${hour}-1`, "session-a", `2026-09-20T${hour}:00:00`, 10);
      await insertMetric(`a-${hour}-2`, "session-a", `2026-09-20T${hour}:30:00`, 30);
    }

    expect(await runDownsample(2)).toBe(2);
    expect(await runDownsample(2)).toBe(1);
    expect(await runDownsample(2)).toBe(0);
    const rows = await rowsOf("session-a");
    expect(rows.map((r) => [r.timestamp, r.viewerCount])).toEqual([
      ["2026-09-20T10:00:00", 20],
      ["2026-09-20T11:00:00", 20],
      ["2026-09-20T12:00:00", 20],
    ]);
  });

  it("chatCount 全為 NULL 時合併結果仍是 NULL", async () => {
    await insertMetric("a-1", "session-a", "2026-09-20T10:00:00", 10, null);
    await insertMetric("a-2", "session-a", "2026-09-20T10:10:00", 20, null);

    await runDownsample();

    expect((await rowsOf("session-a"))[0].chatCount).toBeNull();
  });
});
