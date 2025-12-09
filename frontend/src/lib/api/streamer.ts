import { httpClient } from './httpClient';

/**
 * 開台統計總覽資料
 */
export interface StreamerSummary {
  range: '7d' | '30d' | '90d';
  totalStreamHours: number;
  totalStreamSessions: number;
  avgStreamDurationMinutes: number;
  isEstimated: boolean;
}

/**
 * 取得實況主在指定期間的開台統計總覽
 * @param range - 時間範圍 ('7d' | '30d' | '90d')
 * @returns 開台統計總覽
 */
export async function getStreamerSummary(
  range: '7d' | '30d' | '90d' = '30d'
): Promise<StreamerSummary> {
  return httpClient<StreamerSummary>(`/api/streamer/me/summary?range=${range}`);
}

/**
 * 時間序列資料點
 */
export interface TimeSeriesDataPoint {
  date: string; // ISO date string (YYYY-MM-DD)
  totalHours: number;
  sessionCount: number;
}

/**
 * 時間序列回應
 */
export interface TimeSeriesResponse {
  range: string;
  granularity: 'day' | 'week';
  data: TimeSeriesDataPoint[];
  isEstimated?: boolean;
}

/**
 * 取得實況主時間序列資料
 * @param range - 時間範圍 ('7d' | '30d' | '90d')
 * @param granularity - 時間粒度 ('day' | 'week')
 * @returns 時間序列資料
 */
export async function getStreamerTimeSeries(
  range: '7d' | '30d' | '90d' = '30d',
  granularity: 'day' | 'week' = 'day'
): Promise<TimeSeriesResponse> {
  return httpClient<TimeSeriesResponse>(
    `/api/streamer/me/time-series?range=${range}&granularity=${granularity}`
  );
}

/**
 * Heatmap 資料格
 */
export interface HeatmapCell {
  dayOfWeek: number; // 0=週日, 1=週一, ..., 6=週六
  hour: number; // 0-23
  value: number; // 該時段的開台時數 (小時)
}

/**
 * Heatmap 回應
 */
export interface HeatmapResponse {
  range: string;
  data: HeatmapCell[];
  maxValue: number;
  minValue: number;
  isEstimated?: boolean;
}

/**
 * 取得實況主 Heatmap 資料
 * @param range - 時間範圍 ('7d' | '30d' | '90d')
 * @returns Heatmap 資料
 */
export async function getStreamerHeatmap(
  range: '7d' | '30d' | '90d' = '30d'
): Promise<HeatmapResponse> {
  return httpClient<HeatmapResponse>(`/api/streamer/me/heatmap?range=${range}`);
}
