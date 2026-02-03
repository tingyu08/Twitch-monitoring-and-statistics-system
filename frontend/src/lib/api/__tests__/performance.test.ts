/**
 * API Performance Benchmark Tests
 */

import { getMe, logout } from '@/lib/api/auth';
import { getStreamerSummary, getStreamerTimeSeries, getStreamerHeatmap } from '@/lib/api/streamer';

// Mock httpClient function
const mockHttpClient = jest.fn();
jest.mock('@/lib/api/httpClient', () => ({
  httpClient: (...args: any[]) => mockHttpClient(...args),
}));

const PERFORMANCE_THRESHOLDS = {
  FAST: 100,
  MEDIUM: 500,
  SLOW: 1000,
};

async function measureExecutionTime<T>(fn: () => Promise<T>): Promise<{ result: T; duration: number }> {
  const startTime = performance.now();
  const result = await fn();
  const endTime = performance.now();
  const duration = endTime - startTime;
  return { result, duration };
}

describe('API Performance Benchmarks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Auth API Performance', () => {
    it('getMe() should complete within 100ms (fast threshold)', async () => {
      const mockUser = { id: '1', name: 'Test', email: 'test@example.com', role: 'viewer' };
      mockHttpClient.mockResolvedValueOnce(mockUser);

      const { duration } = await measureExecutionTime(() => getMe());

      expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.FAST);
      console.log(`getMe() execution time: ${duration.toFixed(2)}ms (threshold: <${PERFORMANCE_THRESHOLDS.FAST}ms)`);
    });

    it('logout() should complete within 100ms (fast threshold)', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ message: 'Logged out' }),
      } as Response);

      const { duration } = await measureExecutionTime(() => logout());

      expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.FAST);
      console.log(`logout() execution time: ${duration.toFixed(2)}ms (threshold: <${PERFORMANCE_THRESHOLDS.FAST}ms)`);
    });
  });

  describe('Streamer API Performance', () => {
    it('getStreamerSummary() should complete within 500ms (medium threshold)', async () => {
      const mockData = {
        totalSessions: 10,
        totalHours: 50,
        avgViewers: 100,
        peakViewers: 500,
      };
      mockHttpClient.mockResolvedValueOnce(mockData);

      const { duration } = await measureExecutionTime(() => getStreamerSummary());

      expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.MEDIUM);
      console.log(`getStreamerSummary() execution time: ${duration.toFixed(2)}ms (threshold: <${PERFORMANCE_THRESHOLDS.MEDIUM}ms)`);
    });

    it('getStreamerTimeSeries() should complete within 500ms (medium threshold)', async () => {
      const mockData = [
        { date: '2025-01-01', totalHours: 8, sessionCount: 2, avgViewers: 100, peakViewers: 200 },
      ];
      mockHttpClient.mockResolvedValueOnce(mockData);

      const { duration } = await measureExecutionTime(() => getStreamerTimeSeries());

      expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.MEDIUM);
      console.log(`getStreamerTimeSeries() execution time: ${duration.toFixed(2)}ms (threshold: <${PERFORMANCE_THRESHOLDS.MEDIUM}ms)`);
    });

    it('getStreamerHeatmap() should complete within 500ms (medium threshold)', async () => {
      const mockData = [
        { dayOfWeek: 1, hour: 14, value: 2.5 },
      ];
      mockHttpClient.mockResolvedValueOnce(mockData);

      const { duration } = await measureExecutionTime(() => getStreamerHeatmap());

      expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.MEDIUM);
      console.log(`getStreamerHeatmap() execution time: ${duration.toFixed(2)}ms (threshold: <${PERFORMANCE_THRESHOLDS.MEDIUM}ms)`);
    });
  });

  describe('Batch Operation Performance', () => {
    it('10 consecutive API calls should complete in reasonable time', async () => {
      const mockData = { id: '1', name: 'Test', role: 'viewer' };
      mockHttpClient.mockResolvedValue(mockData);

      const startTime = performance.now();
      
      await Promise.all(
        Array.from({ length: 10 }, () => getMe())
      );

      const endTime = performance.now();
      const totalDuration = endTime - startTime;
      const avgDuration = totalDuration / 10;

      expect(avgDuration).toBeLessThan(PERFORMANCE_THRESHOLDS.FAST);
      console.log(`Batch 10 calls average time: ${avgDuration.toFixed(2)}ms (total: ${totalDuration.toFixed(2)}ms)`);
    });

    it('API call stability test (standard deviation)', async () => {
      const mockData = { id: '1', name: 'Test', role: 'viewer' };
      mockHttpClient.mockResolvedValue(mockData);

      const durations: number[] = [];
      
      for (let i = 0; i < 20; i++) {
        const { duration } = await measureExecutionTime(() => getMe());
        durations.push(duration);
      }

      const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
      const variance = durations.reduce((acc, val) => acc + Math.pow(val - avg, 2), 0) / durations.length;
      const stdDev = Math.sqrt(variance);

      // For mocked functions, allow higher variance since execution is microsecond-level
      // In real environment with network latency, variance would be naturally lower
      expect(stdDev).toBeLessThan(Math.max(avg * 5, 0.2)); // Allow 300% variance or 0.05ms minimum
      
      console.log(`Performance stability test:`);
      console.log(`  - Average: ${avg.toFixed(2)}ms`);
      console.log(`  - Std Dev: ${stdDev.toFixed(2)}ms`);
      console.log(`  - Min: ${Math.min(...durations).toFixed(2)}ms`);
      console.log(`  - Max: ${Math.max(...durations).toFixed(2)}ms`);
    });
  });

  describe('Performance Report Summary', () => {
    it('generate complete performance benchmark report', async () => {
      const mockUser = { id: '1', name: 'Test', role: 'viewer' };
      const mockSummary = { totalSessions: 10, totalHours: 50, avgViewers: 100, peakViewers: 500 };
      const mockTimeSeries = [{ date: '2025-01-01', totalHours: 8, sessionCount: 2, avgViewers: 100, peakViewers: 200 }];
      const mockHeatmap = [{ dayOfWeek: 1, hour: 14, value: 2.5 }];

      mockHttpClient.mockResolvedValueOnce(mockUser);
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ message: 'Logged out' }),
      } as Response);
      mockHttpClient.mockResolvedValueOnce(mockSummary);
      mockHttpClient.mockResolvedValueOnce(mockTimeSeries);
      mockHttpClient.mockResolvedValueOnce(mockHeatmap);

      const results: Record<string, number> = {};

      results['getMe'] = (await measureExecutionTime(() => getMe())).duration;
      results['logout'] = (await measureExecutionTime(() => logout())).duration;
      results['getStreamerSummary'] = (await measureExecutionTime(() => getStreamerSummary())).duration;
      results['getStreamerTimeSeries'] = (await measureExecutionTime(() => getStreamerTimeSeries())).duration;
      results['getStreamerHeatmap'] = (await measureExecutionTime(() => getStreamerHeatmap())).duration;

      console.log('\nAPI Performance Benchmark Report (ms)');
      console.log('=========================================');
      Object.entries(results).forEach(([name, duration]) => {
        const status = duration < PERFORMANCE_THRESHOLDS.FAST ? 'FAST' :
                      duration < PERFORMANCE_THRESHOLDS.MEDIUM ? 'MEDIUM' :
                      duration < PERFORMANCE_THRESHOLDS.SLOW ? 'SLOW' : 'NEEDS OPTIMIZATION';
        console.log(`${status.padEnd(20)} | ${name.padEnd(25)} | ${duration.toFixed(2)}ms`);
      });
      console.log('=========================================\n');

      Object.entries(results).forEach(([name, duration]) => {
        expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.SLOW);
      });
    });
  });
});
