/**
 * stream_metrics 降採樣
 *
 * stream-status job 每 10 分鐘為每個直播中的頻道寫一筆，從沒清過：
 * 2026-01 到 10 月累積約 139 萬筆、近 400MB，是 Supabase 免費版 0.5GB 被塞滿的主因。
 * 唯一的讀取端是單場直播的觀眾曲線（StreamHourlyDialog，X 軸只標到整點），
 * 直接刪除會讓它退回模擬曲線，所以改成把舊資料合併為「每場每小時一筆」，保留真實曲線。
 */

import { Prisma } from "@prisma/client";

/**
 * 產生一批降採樣 SQL：挑出 before 之前「同一場、同一小時有多筆」的區段，最多 batchSize 個，
 * 刪掉原始資料並插入一筆合併結果（平均觀眾數四捨五入、聊天數加總、時間取該小時最早一筆）。
 *
 * - 回傳筆數（executeRaw）= 本批合併的小時區段數；不足 batchSize 代表已處理完
 * - 冪等：合併後每個區段只剩一筆，不會再被 HAVING count(*) > 1 挑中
 * - 所有子句共用同一個 snapshot，merged 讀到的是刪除前的資料，DELETE 也看不到新插入的列
 */
export function buildStreamMetricDownsampleSql(before: Date, batchSize: number): Prisma.Sql {
  return Prisma.sql`
    WITH target AS (
      SELECT "streamSessionId" AS session_id, date_trunc('hour', "timestamp") AS hour
      FROM stream_metrics
      WHERE "timestamp" < ${before}
      GROUP BY 1, 2
      HAVING count(*) > 1
      LIMIT ${batchSize}
    ),
    merged AS (
      SELECT m."streamSessionId" AS session_id,
             min(m."timestamp") AS sampled_at,
             round(avg(m."viewerCount"))::int AS viewer_count,
             sum(m."chatCount")::int AS chat_count
      FROM stream_metrics m
      JOIN target t
        ON t.session_id = m."streamSessionId" AND t.hour = date_trunc('hour', m."timestamp")
      GROUP BY m."streamSessionId", t.hour
    ),
    removed AS (
      DELETE FROM stream_metrics m
      USING target t
      WHERE m."streamSessionId" = t.session_id AND date_trunc('hour', m."timestamp") = t.hour
    )
    INSERT INTO stream_metrics (id, "streamSessionId", "timestamp", "viewerCount", "chatCount")
    SELECT gen_random_uuid()::text, session_id, sampled_at, viewer_count, chat_count
    FROM merged
  `;
}
