import { renderHook, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { useTimeSeriesData, useHeatmapData, useSubscriptionTrendData } from '../useChartData';
import type { FC, ReactNode } from 'react';
import * as streamerApi from '@/lib/api/streamer';

jest.mock('@/lib/api/streamer');
const mockedStreamerApi = streamerApi as jest.Mocked<typeof streamerApi>;

const wrapper: any = ({ children }: { children: ReactNode }) => {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      {children as any}
    </SWRConfig>
  );
};

describe('useChartData Hooks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('useTimeSeriesData', () => {
    const mockData = [
      { date: '2025-12-01', totalHours: 4.5, sessionCount: 2 },
      { date: '2025-12-02', totalHours: 3.2, sessionCount: 1 },
    ];

    it('should fetch time series data', async () => {
      mockedStreamerApi.getStreamerTimeSeries.mockResolvedValue({
        data: mockData,
        range: '7d',
        granularity: 'day',
      });

      const { result } = renderHook(
        () => useTimeSeriesData('7d', 'day'),
        { wrapper }
      );

      expect(result.current.isLoading).toBe(false);
      expect(result.current.data).toEqual([]);

      await result.current.refresh();

      await waitFor(() => {
        expect(result.current.data).toEqual(mockData);
      });

      expect(result.current.error).toBeNull();
    });

    it('should handle errors', async () => {
      mockedStreamerApi.getStreamerTimeSeries.mockRejectedValue(
        new Error('API Error')
      );

      const { result } = renderHook(
        () => useTimeSeriesData('30d', 'week'),
        { wrapper }
      );

      await result.current.refresh();

      await waitFor(() => {
        expect(result.current.error).toBe('API Error');
      });

      expect(result.current.data).toEqual([]);
    });

    it('should provide refresh function', async () => {
      mockedStreamerApi.getStreamerTimeSeries.mockResolvedValue({
        data: mockData,
        range: '7d',
        granularity: 'day',
      });

      const { result } = renderHook(() => useTimeSeriesData('7d', 'day'), { wrapper });

      await result.current.refresh();

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.refresh).toBeDefined();
      expect(typeof result.current.refresh).toBe('function');
    });

    it('should not fetch time series when disabled', () => {
      const { result } = renderHook(() => useTimeSeriesData('7d', 'day', false), { wrapper });

      expect(mockedStreamerApi.getStreamerTimeSeries).not.toHaveBeenCalled();
      expect(result.current.data).toEqual([]);
      expect(result.current.isLoading).toBe(false);
    });
  });

  describe('useHeatmapData', () => {
    const mockData = [{ dayOfWeek: 0, hour: 10, value: 50 }, { dayOfWeek: 1, hour: 14, value: 80 }];

    it('should fetch heatmap data', async () => {
      mockedStreamerApi.getStreamerHeatmap.mockResolvedValue({ data: mockData, range: '7d', maxValue: 80, minValue: 50 });

      const { result } = renderHook(() => useHeatmapData('7d'), { wrapper });

      await result.current.refresh();

      await waitFor(() => {
        expect(result.current.data).toEqual(mockData);
      });

      expect(result.current.error).toBeNull();
    });

    it('should handle heatmap errors', async () => {
      mockedStreamerApi.getStreamerHeatmap.mockRejectedValue(new Error('Heatmap Error'));

      const { result } = renderHook(() => useHeatmapData('30d'), { wrapper });

      await result.current.refresh();

      await waitFor(() => {
        expect(result.current.error).toBe('Heatmap Error');
      });

      expect(result.current.data).toEqual([]);
    });

    it('should not fetch heatmap when disabled', () => {
      const { result } = renderHook(() => useHeatmapData('30d', false), { wrapper });

      expect(mockedStreamerApi.getStreamerHeatmap).not.toHaveBeenCalled();
      expect(result.current.data).toEqual([]);
      expect(result.current.isLoading).toBe(false);
    });
  });

  describe('useSubscriptionTrendData', () => {
    const mockSubData = [
      { date: '2025-12-01', subsTotal: 100, subsDelta: 5 },
      { date: '2025-12-02', subsTotal: 105, subsDelta: 5 },
    ];

    it('should fetch subscription trend data', async () => {
      mockedStreamerApi.getStreamerSubscriptionTrend.mockResolvedValue({
        range: '30d',
        data: mockSubData,
        hasExactData: true,
        isEstimated: false,
        estimateSource: 'daily_snapshot',
        currentDataDays: 30,
        minDataDays: 7,
      });

      const { result } = renderHook(() => useSubscriptionTrendData('30d'), { wrapper });

      await result.current.refresh();

      await waitFor(() => {
        expect(result.current.data).toEqual(mockSubData);
      });

      expect(result.current.error).toBeNull();
      expect(result.current.hasExactData).toBe(true);
      expect(result.current.isEstimated).toBe(false);
      expect(result.current.currentDataDays).toBe(30);
      expect(result.current.minDataDays).toBe(7);
    });

    it('should return defaults when data is undefined', async () => {
      mockedStreamerApi.getStreamerSubscriptionTrend.mockResolvedValue({
        range: '7d',
        data: [],
        hasExactData: false,
        isEstimated: true,
        estimateSource: 'daily_snapshot',
        currentDataDays: 3,
        minDataDays: 7,
      });

      const { result } = renderHook(() => useSubscriptionTrendData('7d'), { wrapper });

      await result.current.refresh();

      await waitFor(() => {
        expect(result.current.isEstimated).toBe(true);
      });

      expect(result.current.data).toEqual([]);
      expect(result.current.hasExactData).toBe(false);
      expect(result.current.currentDataDays).toBe(3);
    });

    it('should not fetch when disabled', () => {
      const { result } = renderHook(
        () => useSubscriptionTrendData('7d', false),
        { wrapper }
      );

      // Disabled — should never call API
      expect(mockedStreamerApi.getStreamerSubscriptionTrend).not.toHaveBeenCalled();
      expect(result.current.data).toEqual([]);
      expect(result.current.isLoading).toBe(false);
    });

    it('should handle subscription trend errors', async () => {
      mockedStreamerApi.getStreamerSubscriptionTrend.mockRejectedValue(
        new Error('Sub Trend Error')
      );

      const { result } = renderHook(() => useSubscriptionTrendData('30d'), { wrapper });

      await result.current.refresh();

      await waitFor(() => {
        expect(result.current.error).toBe('Sub Trend Error');
      });

      expect(result.current.data).toEqual([]);
    });
  });
});
