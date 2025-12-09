import { renderHook, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { useTimeSeriesData, useHeatmapData } from '../useChartData';
import type { FC, ReactNode } from 'react';
import * as streamerApi from '@/lib/api/streamer';

jest.mock('@/lib/api/streamer');
const mockedStreamerApi = streamerApi as jest.Mocked<typeof streamerApi>;

const wrapper: FC<{ children: ReactNode }> = ({ children }) => {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      {children}
    </SWRConfig>
  );
};

describe('useChartData Hooks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('useTimeSeriesData', () => {
    const mockData = [
      { date: '2025-12-01', value: 100, label: 'Day 1' },
      { date: '2025-12-02', value: 150, label: 'Day 2' },
    ];

    it('should fetch time series data', async () => {
      mockedStreamerApi.getStreamerTimeSeries.mockResolvedValue({
        data: mockData,
      });

      const { result } = renderHook(
        () => useTimeSeriesData('7d', 'day'),
        { wrapper }
      );

      expect(result.current.isLoading).toBe(true);
      expect(result.current.data).toEqual([]);

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.data).toEqual(mockData);
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

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.error).toBe('API Error');
      expect(result.current.data).toEqual([]);
    });

    it('should provide refresh function', async () => {
      mockedStreamerApi.getStreamerTimeSeries.mockResolvedValue({
        data: mockData,
      });

      const { result } = renderHook(() => useTimeSeriesData('7d', 'day'), { wrapper });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.refresh).toBeDefined();
      expect(typeof result.current.refresh).toBe('function');
    });
  });

  describe('useHeatmapData', () => {
    const mockData = [{ day: 0, hour: 10, value: 50 }, { day: 1, hour: 14, value: 80 }];

    it('should fetch heatmap data', async () => {
      mockedStreamerApi.getStreamerHeatmap.mockResolvedValue({ data: mockData });

      const { result } = renderHook(() => useHeatmapData('7d'), { wrapper });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.data).toEqual(mockData);
      expect(result.current.error).toBeNull();
    });

    it('should handle heatmap errors', async () => {
      mockedStreamerApi.getStreamerHeatmap.mockRejectedValue(new Error('Heatmap Error'));

      const { result } = renderHook(() => useHeatmapData('30d'), { wrapper });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.error).toBe('Heatmap Error');
      expect(result.current.data).toEqual([]);
    });
  });
});