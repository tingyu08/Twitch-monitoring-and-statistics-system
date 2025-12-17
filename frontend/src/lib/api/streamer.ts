import { httpClient } from "./httpClient";

/**
 * 開台統計總覽資料
 */
export interface StreamerSummary {
  range: "7d" | "30d" | "90d";
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
  range: "7d" | "30d" | "90d" = "30d"
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
  granularity: "day" | "week";
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
  range: "7d" | "30d" | "90d" = "30d",
  granularity: "day" | "week" = "day"
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
  range: "7d" | "30d" | "90d" = "30d"
): Promise<HeatmapResponse> {
  return httpClient<HeatmapResponse>(`/api/streamer/me/heatmap?range=${range}`);
}

/**
 * 訂閱數資料點
 */
export interface SubscriptionDataPoint {
  date: string; // ISO date string (YYYY-MM-DD)
  subsTotal: number | null; // 當日訂閱總數
  subsDelta: number | null; // 相較前一日的淨變化
}

/**
 * 訂閱趨勢回應
 */
export interface SubscriptionTrendResponse {
  range: "7d" | "30d" | "90d";
  data: SubscriptionDataPoint[];
  hasExactData: boolean; // 是否為精確資料（總是 false，因為是每日快照）
  isEstimated: boolean; // 是否為估算值（總是 true）
  estimateSource: string; // 估算來源（例如 'daily_snapshot'）
  minDataDays: number; // 建議最少資料天數（例如 7）
  currentDataDays: number; // 目前可用資料天數
}

/**
 * 取得實況主訂閱趨勢資料
 * @param range - 時間範圍 ('7d' | '30d' | '90d')
 * @returns 訂閱趨勢資料
 */
export async function getStreamerSubscriptionTrend(
  range: "7d" | "30d" | "90d" = "30d"
): Promise<SubscriptionTrendResponse> {
  return httpClient<SubscriptionTrendResponse>(
    `/api/streamer/me/subscription-trend?range=${range}`
  );
}

/**
 * 手動同步訂閱數據
 * @returns 同步成功訊息
 */
export async function syncSubscriptions(): Promise<{ message: string }> {
  return httpClient<{ message: string }>(
    `/api/streamer/me/sync-subscriptions`,
    { method: "POST" }
  );
}
