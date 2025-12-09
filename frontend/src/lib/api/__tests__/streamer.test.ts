import {
  getStreamerSummary,
  getStreamerTimeSeries,
  getStreamerHeatmap,
} from '../streamer';
import { httpClient } from '../httpClient';

// Mock httpClient
jest.mock('../httpClient');
const mockHttpClient = httpClient as jest.MockedFunction<typeof httpClient>;

describe('streamer.ts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getStreamerSummary', () => {
    it('should fetch summary with default range', async () => {
      const mockSummary = {
        range: '30d' as const,
        totalStreamHours: 120,
        totalStreamSessions: 30,
        avgStreamDurationMinutes: 240,
        isEstimated: false,
      };

      mockHttpClient.mockResolvedValueOnce(mockSummary);

      const result = await getStreamerSummary();

      expect(mockHttpClient).toHaveBeenCalledWith('/api/streamer/me/summary?range=30d');
      expect(result).toEqual(mockSummary);
    });

    it('should fetch summary with custom range', async () => {
      const mockSummary = {
        range: '7d' as const,
        totalStreamHours: 30,
        totalStreamSessions: 7,
        avgStreamDurationMinutes: 257,
        isEstimated: false,
      };

      mockHttpClient.mockResolvedValueOnce(mockSummary);

      const result = await getStreamerSummary('7d');

      expect(mockHttpClient).toHaveBeenCalledWith('/api/streamer/me/summary?range=7d');
      expect(result).toEqual(mockSummary);
    });

    it('should propagate errors from httpClient', async () => {
      const error = new Error('API error');
      mockHttpClient.mockRejectedValueOnce(error);

      await expect(getStreamerSummary()).rejects.toThrow('API error');
    });
  });

  describe('getStreamerTimeSeries', () => {
    it('should fetch time series with default parameters', async () => {
      const mockResponse = {
        range: '30d',
        granularity: 'day' as const,
        data: [
          { date: '2025-01-01', totalHours: 4, sessionCount: 1 },
          { date: '2025-01-02', totalHours: 6, sessionCount: 2 },
        ],
        isEstimated: false,
      };

      mockHttpClient.mockResolvedValueOnce(mockResponse);

      const result = await getStreamerTimeSeries();

      expect(mockHttpClient).toHaveBeenCalledWith(
        '/api/streamer/me/time-series?range=30d&granularity=day'
      );
      expect(result).toEqual(mockResponse);
    });

    it('should fetch time series with custom parameters', async () => {
      const mockResponse = {
        range: '90d',
        granularity: 'week' as const,
        data: [
          { date: '2025-01-01', totalHours: 28, sessionCount: 7 },
        ],
        isEstimated: true,
      };

      mockHttpClient.mockResolvedValueOnce(mockResponse);

      const result = await getStreamerTimeSeries('90d', 'week');

      expect(mockHttpClient).toHaveBeenCalledWith(
        '/api/streamer/me/time-series?range=90d&granularity=week'
      );
      expect(result).toEqual(mockResponse);
    });

    it('should propagate errors from httpClient', async () => {
      const error = new Error('Fetch failed');
      mockHttpClient.mockRejectedValueOnce(error);

      await expect(getStreamerTimeSeries()).rejects.toThrow('Fetch failed');
    });
  });

  describe('getStreamerHeatmap', () => {
    it('should fetch heatmap with default range', async () => {
      const mockResponse = {
        range: '30d',
        data: [
          { dayOfWeek: 0, hour: 14, value: 3.5 },
          { dayOfWeek: 1, hour: 15, value: 4.0 },
        ],
        maxValue: 8.5,
        minValue: 0,
        isEstimated: false,
      };

      mockHttpClient.mockResolvedValueOnce(mockResponse);

      const result = await getStreamerHeatmap();

      expect(mockHttpClient).toHaveBeenCalledWith('/api/streamer/me/heatmap?range=30d');
      expect(result).toEqual(mockResponse);
    });

    it('should fetch heatmap with custom range', async () => {
      const mockResponse = {
        range: '7d',
        data: [
          { dayOfWeek: 5, hour: 20, value: 2.5 },
        ],
        maxValue: 6.0,
        minValue: 0,
        isEstimated: false,
      };

      mockHttpClient.mockResolvedValueOnce(mockResponse);

      const result = await getStreamerHeatmap('7d');

      expect(mockHttpClient).toHaveBeenCalledWith('/api/streamer/me/heatmap?range=7d');
      expect(result).toEqual(mockResponse);
    });

    it('should propagate errors from httpClient', async () => {
      const error = new Error('Heatmap error');
      mockHttpClient.mockRejectedValueOnce(error);

      await expect(getStreamerHeatmap()).rejects.toThrow('Heatmap error');
    });
  });
});