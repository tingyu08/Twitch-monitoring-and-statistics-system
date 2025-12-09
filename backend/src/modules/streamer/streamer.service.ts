import { prisma } from '../../db/prisma';

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
  granularity: 'day' | 'week';
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

/**
 * 取得實況主在指定期間的開台統計總覽
 * @param streamerId - 實況主 ID
 * @param range - 時間範圍 ('7d' | '30d' | '90d')
 * @returns 開台統計總覽
 */
export async function getStreamerSummary(
  streamerId: string,
  range: string = '30d'
): Promise<StreamerSummary> {
  // 1. 解析時間範圍
  const now = new Date();
  let days = 30;
  if (range === '7d') days = 7;
  if (range === '90d') days = 90;

  const cutoffDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  // 2. 取得實況主的頻道 ID
  const channel = await prisma.channel.findFirst({
    where: { streamerId },
  });

  if (!channel) {
    // 如果找不到頻道，回傳空統計
    return {
      range,
      totalStreamHours: 0,
      totalStreamSessions: 0,
      avgStreamDurationMinutes: 0,
      isEstimated: false,
    };
  }

  // 3. 查詢指定期間的開台紀錄
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

  // 4. 計算統計數據
  const totalStreamSessions = sessions.length;
  const totalSeconds = sessions.reduce((sum, s) => sum + (s.durationSeconds || 0), 0);
  const totalStreamHours = Math.round((totalSeconds / 3600) * 10) / 10; // 取小數點後一位
  const avgStreamDurationMinutes =
    totalStreamSessions > 0
      ? Math.round(totalSeconds / 60 / totalStreamSessions)
      : 0;

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
  range: string = '30d',
  granularity: 'day' | 'week' = 'day'
): Promise<TimeSeriesResponse> {
  // 1. 解析時間範圍
  const now = new Date();
  let days = 30;
  if (range === '7d') days = 7;
  if (range === '90d') days = 90;

  const cutoffDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  // 2. 取得實況主的頻道 ID
  const channel = await prisma.channel.findFirst({
    where: { streamerId },
  });

  if (!channel) {
    return {
      range,
      granularity,
      data: [],
      isEstimated: false,
    };
  }

  // 3. 查詢指定期間的開台紀錄
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
    orderBy: {
      startedAt: 'asc',
    },
  });

  // 4. 根據 granularity 彙整資料
  if (granularity === 'day') {
    return aggregateByDay(sessions, range, cutoffDate, now);
  } else {
    return aggregateByWeek(sessions, range, cutoffDate, now);
  }
}

/**
 * 按日彙整開台資料
 */
function aggregateByDay(
  sessions: Array<{ startedAt: Date; durationSeconds: number | null }>,
  range: string,
  startDate: Date,
  endDate: Date
): TimeSeriesResponse {
  const dataMap = new Map<string, { totalSeconds: number; count: number }>();

  // 初始化所有日期為 0
  const dayCount = Math.ceil((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000));
  for (let i = 0; i < dayCount; i++) {
    const date = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
    const dateKey = date.toISOString().split('T')[0];
    dataMap.set(dateKey, { totalSeconds: 0, count: 0 });
  }

  // 彙整實際資料
  sessions.forEach((session) => {
    const dateKey = session.startedAt.toISOString().split('T')[0];
    const existing = dataMap.get(dateKey) || { totalSeconds: 0, count: 0 };
    existing.totalSeconds += session.durationSeconds || 0;
    existing.count += 1;
    dataMap.set(dateKey, existing);
  });

  // 轉換為陣列並排序
  const data: TimeSeriesDataPoint[] = Array.from(dataMap.entries())
    .map(([date, stats]) => ({
      date,
      totalHours: Math.round((stats.totalSeconds / 3600) * 10) / 10,
      sessionCount: stats.count,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    range,
    granularity: 'day',
    data,
    isEstimated: false,
  };
}

/**
 * 按週彙整開台資料
 */
function aggregateByWeek(
  sessions: Array<{ startedAt: Date; durationSeconds: number | null }>,
  range: string,
  startDate: Date,
  endDate: Date
): TimeSeriesResponse {
  const dataMap = new Map<string, { totalSeconds: number; count: number }>();

  // 取得週的起始日（週一）
  function getWeekStart(date: Date): string {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); // 調整至週一
    d.setDate(diff);
    return d.toISOString().split('T')[0];
  }

  // 初始化所有週為 0
  const weekCount = Math.ceil((endDate.getTime() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000));
  for (let i = 0; i < weekCount; i++) {
    const date = new Date(startDate.getTime() + i * 7 * 24 * 60 * 60 * 1000);
    const weekKey = getWeekStart(date);
    if (!dataMap.has(weekKey)) {
      dataMap.set(weekKey, { totalSeconds: 0, count: 0 });
    }
  }

  // 彙整實際資料
  sessions.forEach((session) => {
    const weekKey = getWeekStart(session.startedAt);
    const existing = dataMap.get(weekKey) || { totalSeconds: 0, count: 0 };
    existing.totalSeconds += session.durationSeconds || 0;
    existing.count += 1;
    dataMap.set(weekKey, existing);
  });

  // 轉換為陣列並排序
  const data: TimeSeriesDataPoint[] = Array.from(dataMap.entries())
    .map(([date, stats]) => ({
      date,
      totalHours: Math.round((stats.totalSeconds / 3600) * 10) / 10,
      sessionCount: stats.count,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    range,
    granularity: 'week',
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
  range: string = '30d'
): Promise<HeatmapResponse> {
  // 1. 解析時間範圍
  const now = new Date();
  let days = 30;
  if (range === '7d') days = 7;
  if (range === '90d') days = 90;

  const cutoffDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  // 2. 取得實況主的頻道 ID
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

  // 3. 查詢指定期間的開台紀錄
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

  // 4. 初始化 Heatmap 矩陣（7 天 × 24 小時）
  const heatmapMatrix = new Map<string, number>();
  for (let day = 0; day < 7; day++) {
    for (let hour = 0; hour < 24; hour++) {
      heatmapMatrix.set(`${day}-${hour}`, 0);
    }
  }

  // 5. 彙整資料到 Heatmap
  sessions.forEach((session) => {
    const startDate = new Date(session.startedAt);
    const dayOfWeek = startDate.getDay(); // 0=週日, 1=週一, ..., 6=週六
    const startHour = startDate.getHours();
    const durationHours = (session.durationSeconds || 0) / 3600;

    // 將時數分配到對應的時段
    // 簡化版：將整個開台時段的時數加到起始小時
    const key = `${dayOfWeek}-${startHour}`;
    const currentValue = heatmapMatrix.get(key) || 0;
    heatmapMatrix.set(key, currentValue + durationHours);
  });

  // 6. 轉換為陣列格式並計算最大/最小值
  const data: HeatmapCell[] = [];
  let maxValue = 0;
  let minValue = Number.MAX_VALUE;

  heatmapMatrix.forEach((value, key) => {
    const [dayOfWeek, hour] = key.split('-').map(Number);
    const roundedValue = Math.round(value * 10) / 10;
    
    data.push({
      dayOfWeek,
      hour,
      value: roundedValue,
    });

    if (roundedValue > 0) {
      maxValue = Math.max(maxValue, roundedValue);
      minValue = Math.min(minValue, roundedValue);
    }
  });

  // 如果沒有資料，minValue 設為 0
  if (minValue === Number.MAX_VALUE) {
    minValue = 0;
  }

  return {
    range,
    data,
    maxValue,
    minValue,
    isEstimated: false,
  };
}