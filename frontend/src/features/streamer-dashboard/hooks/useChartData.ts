/**
 * Chart Data Hooks using SWR
 * 
 * 使用 SWR 管理圖表資料獲取、快取和重新驗證
 */

import useSWR from 'swr';
import { getStreamerTimeSeries, getStreamerHeatmap, getStreamerSubscriptionTrend } from '@/lib/api/streamer';
import type { TimeSeriesDataPoint, HeatmapCell, HeatmapResponse, SubscriptionTrendResponse, SubscriptionDataPoint } from '@/lib/api/streamer';
import { chartLogger } from '@/lib/logger';

export type ChartRange = '7d' | '30d' | '90d';
export type ChartGranularity = 'day' | 'week';

/**
 * 使用 SWR 獲取時間序列資料
 */
export function useTimeSeriesData(range: ChartRange, granularity: ChartGranularity, enabled = true) {
  const { data, error, isLoading, mutate } = useSWR<TimeSeriesDataPoint[]>(
    enabled ? `/api/streamer/time-series/${range}/${granularity}` : null,
    async () => {
      chartLogger.debug('Fetching time series data', { range, granularity });
      const response = await getStreamerTimeSeries(range, granularity);
      return response.data;
    },
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      dedupingInterval: 30000, // 30秒內不重複請求
    }
  );

  return {
    data: Array.isArray(data) ? data : [],
    error: error?.message || null,
    isLoading,
    refresh: mutate,
  };
}

/**
 * 使用 SWR 獲取熱力圖資料
 */
export function useHeatmapData(range: ChartRange, enabled = true) {
  const { data, error, isLoading, mutate } = useSWR<HeatmapResponse>(
    enabled ? `/api/streamer/heatmap/${range}` : null,
    async () => {
      chartLogger.debug('Fetching heatmap data', { range });
      const response = await getStreamerHeatmap(range);
      return response;
    },
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      dedupingInterval: 30000,
    }
  );

  return {
    data: data?.data || [],
    maxValue: data?.maxValue || 0,
    minValue: data?.minValue || 0,
    error: error?.message || null,
    isLoading,
    refresh: mutate,
  };
}

/**
 * 使用 SWR 獲取訂閱趨勢資料
 */
export function useSubscriptionTrendData(range: ChartRange, enabled = true) {
  const { data, error, isLoading, mutate } = useSWR<SubscriptionTrendResponse>(
    enabled ? `/api/streamer/subscription-trend/${range}` : null,
    async () => {
      chartLogger.debug('Fetching subscription trend data', { range });
      const response = await getStreamerSubscriptionTrend(range);
      return response;
    },
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      dedupingInterval: 30000,
    }
  );

  return {
    data: data?.data || [],
    hasExactData: data?.hasExactData ?? false,
    isEstimated: data?.isEstimated ?? false,
    currentDataDays: data?.currentDataDays ?? 0,
    minDataDays: data?.minDataDays ?? 7,
    error: error?.message || null,
    isLoading,
    refresh: mutate,
  };
}
