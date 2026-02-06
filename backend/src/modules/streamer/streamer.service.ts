import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";

export interface StreamerSummary {
  totalStreamHours: number;
  totalStreamSessions: number;
  avgStreamDurationMinutes: number;
  range: string; // '7d' | '30d' | '90d'
  isEstimated?: boolean;
}

export interface TimeSeriesDataPoint {
  date: string; // ISO date string (YYYY-MM-DD)
  totalHours: number;
  sessionCount: number;
}

export interface TimeSeriesResponse {
  range: string;
  granularity: "day" | "week";
  data: TimeSeriesDataPoint[];
  isEstimated?: boolean;
}

export interface HeatmapCell {
  dayOfWeek: number; // 0=週日, 1=週一, ..., 6=週六
  hour: number; // 0-23
  value: number; // 開台時數
}

export interface HeatmapResponse {
  range: string;
  data: HeatmapCell[];
  maxValue: number;
  minValue: number;
  isEstimated?: boolean;
}

interface HeatmapAggregateRow {
  dayOfWeek: number;
  hour: number;
  totalHours: number | string;
  updatedAt: string | Date;
}

interface StreamerSummaryRow {
  totalSeconds: number | bigint | string | null;
  sessionCount: number | bigint | string | null;
}

interface TimeSeriesAggregateRow {
  bucketDate: string;
  totalSeconds: number | bigint | string | null;
  sessionCount: number | bigint | string | null;
}

const HEATMAP_AGGREGATE_MAX_AGE_MS = 10 * 60 * 1000;

function resolveRangeDays(range: string): number {
  if (range === "7d") return 7;
  if (range === "90d") return 90;
  return 30;
}

async function getChannelIdByStreamerId(streamerId: string): Promise<string | null> {
  const channel = await prisma.channel.findFirst({
    where: { streamerId },
    select: { id: true },
  });

  return channel?.id ?? null;
}

function buildHeatmapResponseFromCells(range: string, cells: HeatmapCell[]): HeatmapResponse {
  let maxValue = 0;
  let minValue = Number.MAX_VALUE;

  for (const cell of cells) {
    if (cell.value > 0) {
      maxValue = Math.max(maxValue, cell.value);
      minValue = Math.min(minValue, cell.value);
    }
  }

  if (minValue === Number.MAX_VALUE) {
    minValue = 0;
  }

  return {
    range,
    data: cells,
    maxValue,
    minValue,
    isEstimated: false,
  };
}

function buildHeatmapFromSessions(
  range: string,
  sessions: Array<{ durationSeconds: number | null; startedAt: Date }>
): HeatmapResponse {
  const heatmapMatrix = new Map<string, number>();
  for (let day = 0; day < 7; day++) {
    for (let hour = 0; hour < 24; hour++) {
      heatmapMatrix.set(`${day}-${hour}`, 0);
    }
  }

  sessions.forEach((session) => {
    const startDate = new Date(session.startedAt);
    let remainingSeconds = session.durationSeconds || 0;
    let currentTempDate = new Date(startDate);

    while (remainingSeconds > 0) {
      const dWeek = currentTempDate.getDay();
      const hr = currentTempDate.getHours();
      const key = `${dWeek}-${hr}`;

      const secondsToNextHour =
        3600 - currentTempDate.getMinutes() * 60 - currentTempDate.getSeconds();
      const secondsInThisHour = Math.min(remainingSeconds, secondsToNextHour);
      const contribution = secondsInThisHour / 3600;

      const val = heatmapMatrix.get(key) || 0;
      heatmapMatrix.set(key, val + contribution);

      remainingSeconds -= secondsInThisHour;
      currentTempDate = new Date(currentTempDate.getTime() + secondsInThisHour * 1000 + 100);
    }
  });

  const data: HeatmapCell[] = [];
  for (let day = 0; day < 7; day++) {
    for (let hour = 0; hour < 24; hour++) {
      const key = `${day}-${hour}`;
      const value = heatmapMatrix.get(key) || 0;
      data.push({
        dayOfWeek: day,
        hour,
        value: Math.round(value * 10) / 10,
      });
    }
  }

  return buildHeatmapResponseFromCells(range, data);
}

async function loadHeatmapAggregate(
  channelId: string,
  range: string
): Promise<HeatmapResponse | null> {
  try {
    const rows = await prisma.$queryRaw<HeatmapAggregateRow[]>(Prisma.sql`
      SELECT dayOfWeek, hour, totalHours, updatedAt
      FROM channel_hourly_stats
      WHERE channelId = ${channelId}
        AND range = ${range}
      ORDER BY dayOfWeek ASC, hour ASC
    `);

    if (rows.length !== 7 * 24) {
      return null;
    }

    const latestUpdatedAt = rows.reduce<number>((max, row) => {
      const ts = row.updatedAt instanceof Date ? row.updatedAt.getTime() : new Date(row.updatedAt).getTime();
      return Number.isFinite(ts) ? Math.max(max, ts) : max;
    }, 0);

    if (!latestUpdatedAt || Date.now() - latestUpdatedAt > HEATMAP_AGGREGATE_MAX_AGE_MS) {
      return null;
    }

    const data: HeatmapCell[] = rows.map((row) => ({
      dayOfWeek: row.dayOfWeek,
      hour: row.hour,
      value: Math.round(Number(row.totalHours) * 10) / 10,
    }));

    return buildHeatmapResponseFromCells(range, data);
  } catch {
    return null;
  }
}

async function persistHeatmapAggregate(
  channelId: string,
  range: string,
  cells: HeatmapCell[]
): Promise<void> {
  try {
    const values = cells.map((cell) =>
      Prisma.sql`(${channelId}, ${cell.dayOfWeek}, ${cell.hour}, ${cell.value}, ${range}, CURRENT_TIMESTAMP)`
    );

    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO channel_hourly_stats (
        channelId,
        dayOfWeek,
        hour,
        totalHours,
        range,
        updatedAt
      )
      VALUES ${Prisma.join(values)}
      ON CONFLICT(channelId, dayOfWeek, hour, range) DO UPDATE SET
        totalHours = excluded.totalHours,
        updatedAt = CURRENT_TIMESTAMP
    `);
  } catch {
    // 聚合表不存在或寫入失敗時，不影響主流程
  }
}

/**
 * 取得實況主在指定期間的開台統計總覽
 * @param streamerId - 實況主 ID
 * @param range - 時間範圍 ('7d' | '30d' | '90d')
 * @returns 開台統計總覽
 */
export async function getStreamerSummary(
  streamerId: string,
  range: string = "30d"
): Promise<StreamerSummary> {
  const now = new Date();
  const days = resolveRangeDays(range);

  const cutoffDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  const channelId = await getChannelIdByStreamerId(streamerId);

  if (!channelId) {
    return {
      range,
      totalStreamHours: 0,
      totalStreamSessions: 0,
      avgStreamDurationMinutes: 0,
      isEstimated: false,
    };
  }

  const rows = await prisma.$queryRaw<StreamerSummaryRow[]>(Prisma.sql`
    SELECT
      SUM(COALESCE(durationSeconds, 0)) AS totalSeconds,
      COUNT(*) AS sessionCount
    FROM stream_sessions
    WHERE channelId = ${channelId}
      AND startedAt >= ${cutoffDate}
  `);

  const totalSeconds = toNumber(rows[0]?.totalSeconds);
  const totalStreamSessions = toNumber(rows[0]?.sessionCount);
  const totalStreamHours = Math.round((totalSeconds / 3600) * 10) / 10;
  const avgStreamDurationMinutes =
    totalStreamSessions > 0 ? Math.round(totalSeconds / 60 / totalStreamSessions) : 0;

  return {
    range,
    totalStreamHours,
    totalStreamSessions,
    avgStreamDurationMinutes,
    isEstimated: false,
  };
}

/**
 * 取得實況主時間序列資料（每日或每週開台統計）
 * @param streamerId - 實況主 ID
 * @param range - 時間範圍 ('7d' | '30d' | '90d')
 * @param granularity - 時間粒度 ('day' | 'week')
 * @returns 時間序列資料
 */
export async function getStreamerTimeSeries(
  streamerId: string,
  range: string = "30d",
  granularity: "day" | "week" = "day"
): Promise<TimeSeriesResponse> {
  const now = new Date();
  const days = resolveRangeDays(range);

  const cutoffDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  const channelId = await getChannelIdByStreamerId(streamerId);

  if (!channelId) {
    return {
      range,
      granularity,
      data: [],
      isEstimated: false,
    };
  }

  if (granularity === "day") {
    const rows = await prisma.$queryRaw<TimeSeriesAggregateRow[]>(Prisma.sql`
      SELECT
        date(startedAt) AS bucketDate,
        SUM(COALESCE(durationSeconds, 0)) AS totalSeconds,
        COUNT(*) AS sessionCount
      FROM stream_sessions
      WHERE channelId = ${channelId}
        AND startedAt >= ${cutoffDate}
      GROUP BY date(startedAt)
      ORDER BY bucketDate ASC
    `);

    return buildDailyTimeSeries(rows, range, cutoffDate, now);
  }

  const rows = await prisma.$queryRaw<TimeSeriesAggregateRow[]>(Prisma.sql`
    SELECT
      date(startedAt, '-' || ((CAST(strftime('%w', startedAt) AS INTEGER) + 6) % 7) || ' days') AS bucketDate,
      SUM(COALESCE(durationSeconds, 0)) AS totalSeconds,
      COUNT(*) AS sessionCount
    FROM stream_sessions
    WHERE channelId = ${channelId}
      AND startedAt >= ${cutoffDate}
    GROUP BY date(startedAt, '-' || ((CAST(strftime('%w', startedAt) AS INTEGER) + 6) % 7) || ' days')
    ORDER BY bucketDate ASC
  `);

  return buildWeeklyTimeSeries(rows, range, cutoffDate, now);
}

function buildDailyTimeSeries(
  rows: TimeSeriesAggregateRow[],
  range: string,
  startDate: Date,
  endDate: Date
): TimeSeriesResponse {
  const dataMap = new Map<string, { totalSeconds: number; count: number }>();

  const dayCount = Math.ceil((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000));
  for (let i = 0; i < dayCount; i++) {
    const date = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
    const dateKey = date.toISOString().split("T")[0];
    dataMap.set(dateKey, { totalSeconds: 0, count: 0 });
  }

  for (const row of rows) {
    const dateKey = row.bucketDate;
    if (!dataMap.has(dateKey)) continue;
    dataMap.set(dateKey, {
      totalSeconds: toNumber(row.totalSeconds),
      count: toNumber(row.sessionCount),
    });
  }

  const data: TimeSeriesDataPoint[] = Array.from(dataMap.entries())
    .map(([date, stats]) => ({
      date,
      totalHours: Math.round((stats.totalSeconds / 3600) * 10) / 10,
      sessionCount: stats.count,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    range,
    granularity: "day",
    data,
    isEstimated: false,
  };
}

function getWeekStartIso(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().split("T")[0];
}

function buildWeeklyTimeSeries(
  rows: TimeSeriesAggregateRow[],
  range: string,
  startDate: Date,
  endDate: Date
): TimeSeriesResponse {
  const dataMap = new Map<string, { totalSeconds: number; count: number }>();

  const weekCount = Math.ceil(
    (endDate.getTime() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000)
  );
  for (let i = 0; i < weekCount; i++) {
    const date = new Date(startDate.getTime() + i * 7 * 24 * 60 * 60 * 1000);
    const weekKey = getWeekStartIso(date);
    if (!dataMap.has(weekKey)) {
      dataMap.set(weekKey, { totalSeconds: 0, count: 0 });
    }
  }

  for (const row of rows) {
    const weekKey = row.bucketDate;
    const existing = dataMap.get(weekKey);
    if (!existing) continue;
    existing.totalSeconds = toNumber(row.totalSeconds);
    existing.count = toNumber(row.sessionCount);
    dataMap.set(weekKey, existing);
  }

  const data: TimeSeriesDataPoint[] = Array.from(dataMap.entries())
    .map(([date, stats]) => ({
      date,
      totalHours: Math.round((stats.totalSeconds / 3600) * 10) / 10,
      sessionCount: stats.count,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    range,
    granularity: "week",
    data,
    isEstimated: false,
  };
}

/**
 * 取得 Heatmap 資料（一週 × 24 小時的開台分布）
 * @param streamerId - 實況主 ID
 * @param range - 時間範圍 ('7d' | '30d' | '90d')
 * @returns Heatmap 資料
 */
export async function getStreamerHeatmap(
  streamerId: string,
  range: string = "30d"
): Promise<HeatmapResponse> {
  const now = new Date();
  let days = 30;
  if (range === "7d") days = 7;
  if (range === "90d") days = 90;

  const cutoffDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  const channel = await prisma.channel.findFirst({
    where: { streamerId },
  });

  if (!channel) {
    return {
      range,
      data: [],
      maxValue: 0,
      minValue: 0,
      isEstimated: false,
    };
  }

  // 先讀取預聚合結果（命中則直接回傳）
  const aggregated = await loadHeatmapAggregate(channel.id, range);
  if (aggregated) {
    return aggregated;
  }

  const sessions = await prisma.streamSession.findMany({
    where: {
      channelId: channel.id,
      startedAt: {
        gte: cutoffDate,
      },
    },
    select: {
      durationSeconds: true,
      startedAt: true,
    },
  });

  const response = buildHeatmapFromSessions(range, sessions);
  await persistHeatmapAggregate(channel.id, range, response.data);
  return response;
}

export interface GameStats {
  gameName: string;
  totalHours: number;
  avgViewers: number;
  peakViewers: number;
  streamCount: number;
  percentage: number;
}

interface GameStatsRow {
  gameName: string;
  totalSeconds: number | bigint | string | null;
  weightedViewersSum: number | bigint | string | null;
  peakViewers: number | bigint | string | null;
  streamCount: number | bigint | string | null;
}

interface SessionAnalyticsRow {
  startedAt: Date;
  durationSeconds: number | null;
  avgViewers: number | null;
  peakViewers: number | null;
  title: string | null;
  category: string | null;
}

function toNumber(value: number | bigint | string | null | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

async function getGameStatsByChannelId(channelId: string, cutoffDate: Date): Promise<GameStats[]> {
  const rows = await prisma.$queryRaw<GameStatsRow[]>(Prisma.sql`
    SELECT
      COALESCE(category, 'Uncategorized') AS gameName,
      SUM(COALESCE(durationSeconds, 0)) AS totalSeconds,
      SUM(COALESCE(avgViewers, 0) * COALESCE(durationSeconds, 0)) AS weightedViewersSum,
      MAX(COALESCE(peakViewers, 0)) AS peakViewers,
      COUNT(*) AS streamCount
    FROM stream_sessions
    WHERE channelId = ${channelId} AND startedAt >= ${cutoffDate}
    GROUP BY COALESCE(category, 'Uncategorized')
    ORDER BY totalSeconds DESC
  `);

  if (rows.length === 0) {
    return [];
  }

  const normalizedRows = rows.map((row) => ({
    gameName: row.gameName,
    totalSeconds: toNumber(row.totalSeconds),
    weightedViewersSum: toNumber(row.weightedViewersSum),
    peakViewers: toNumber(row.peakViewers),
    streamCount: toNumber(row.streamCount),
  }));

  const totalAllSeconds = normalizedRows.reduce((sum, row) => sum + row.totalSeconds, 0);

  return normalizedRows
    .map((row) => ({
      gameName: row.gameName,
      totalHours: Math.round((row.totalSeconds / 3600) * 10) / 10,
      avgViewers:
        row.totalSeconds > 0 ? Math.round(row.weightedViewersSum / row.totalSeconds) : 0,
      peakViewers: row.peakViewers,
      streamCount: row.streamCount,
      percentage:
        totalAllSeconds > 0 ? Math.round((row.totalSeconds / totalAllSeconds) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.totalHours - a.totalHours);
}

function buildViewerTrendsFromSessions(sessions: SessionAnalyticsRow[]): ViewerTrendPoint[] {
  return sessions.map((session) => ({
    date: session.startedAt.toISOString(),
    title: session.title || "Untitled",
    avgViewers: session.avgViewers || 0,
    peakViewers: session.peakViewers || 0,
    durationHours: Math.round(((session.durationSeconds || 0) / 3600) * 10) / 10,
    category: session.category || "Uncategorized",
  }));
}

export async function getStreamerGameStats(
  streamerId: string,
  range: "7d" | "30d" | "90d" = "30d"
): Promise<GameStats[]> {
  const now = new Date();
  let days = 30;
  if (range === "7d") days = 7;
  if (range === "90d") days = 90;
  const cutoffDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  const channel = await prisma.channel.findFirst({ where: { streamerId } });
  if (!channel) return [];

  return getGameStatsByChannelId(channel.id, cutoffDate);
}

/**
 * 取得頻道的遊戲/分類統計 (By Channel ID)
 */
export async function getChannelGameStats(
  channelId: string,
  range: "7d" | "30d" | "90d" = "30d"
): Promise<GameStats[]> {
  const now = new Date();
  let days = 30;
  if (range === "7d") days = 7;
  if (range === "90d") days = 90;
  const cutoffDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  return getGameStatsByChannelId(channelId, cutoffDate);
}

export interface ViewerTrendPoint {
  date: string;
  title: string;
  avgViewers: number;
  peakViewers: number;
  durationHours: number;
  category: string;
}

/**
 * 取得頻道的觀眾趨勢 (By Channel ID)
 */
export async function getChannelViewerTrends(
  channelId: string,
  range: "7d" | "30d" | "90d" = "30d"
): Promise<ViewerTrendPoint[]> {
  const now = new Date();
  let days = 30;
  if (range === "7d") days = 7;
  if (range === "90d") days = 90;
  const cutoffDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  const sessions = await prisma.streamSession.findMany({
    where: {
      channelId: channelId,
      startedAt: { gte: cutoffDate },
    },
    select: {
      startedAt: true,
      title: true,
      avgViewers: true,
      peakViewers: true,
      durationSeconds: true,
      category: true,
    },
    orderBy: { startedAt: "asc" },
  });

  return buildViewerTrendsFromSessions(sessions);
}

export async function getChannelGameStatsAndViewerTrends(
  channelId: string,
  range: "7d" | "30d" | "90d" = "30d"
): Promise<{ gameStats: GameStats[]; viewerTrends: ViewerTrendPoint[] }> {
  const now = new Date();
  const days = resolveRangeDays(range);
  const cutoffDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  const [gameStats, sessions] = await Promise.all([
    getGameStatsByChannelId(channelId, cutoffDate),
    prisma.streamSession.findMany({
      where: {
        channelId,
        startedAt: { gte: cutoffDate },
      },
      select: {
        startedAt: true,
        title: true,
        avgViewers: true,
        peakViewers: true,
        durationSeconds: true,
        category: true,
      },
      orderBy: { startedAt: "asc" },
    }),
  ]);

  return {
    gameStats,
    viewerTrends: buildViewerTrendsFromSessions(sessions),
  };
}

// ========== Story 6.4 Helpers ==========

export async function getStreamerVideos(streamerId: string, limit = 20, page = 1) {
  const skip = (page - 1) * limit;
  const [data, total] = await Promise.all([
    prisma.video.findMany({
      where: { streamerId },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip,
    }),
    prisma.video.count({ where: { streamerId } }),
  ]);
  return { data, total, page, totalPages: Math.ceil(total / limit) };
}

export async function getStreamerClips(streamerId: string, limit = 20, page = 1) {
  const skip = (page - 1) * limit;
  const [data, total] = await Promise.all([
    prisma.clip.findMany({
      where: { streamerId },
      orderBy: { viewCount: "desc" }, // Clips usually ordered by views or date. Let's default to views/popularity for clips.
      take: limit,
      skip,
    }),
    prisma.clip.count({ where: { streamerId } }),
  ]);
  return { data, total, page, totalPages: Math.ceil(total / limit) };
}
