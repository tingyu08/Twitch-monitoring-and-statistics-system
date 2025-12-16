import request from 'supertest';
import express from 'express';
import { streamerRoutes } from '../streamer.routes';
import * as streamerService from '../streamer.service';
import * as subscriptionSyncService from '../subscription-sync.service';

// Mock streamer service
jest.mock('../streamer.service');
jest.mock('../subscription-sync.service');

// Mock auth middleware
jest.mock('../../auth/auth.middleware', () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as express.Request & { user?: { streamerId: string } }).user = { streamerId: 'test-streamer-123' };
    next();
  },
}));

describe('Streamer Integration Tests', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/streamer', streamerRoutes);
    jest.clearAllMocks();
  });

  describe('GET /api/streamer/me/summary', () => {
    const mockSummary = {
      range: '30d',
      totalStreamHours: 10.5,
      totalStreamSessions: 5,
      avgStreamDurationMinutes: 126,
      isEstimated: false,
    };

    it('應該成功取得統計摘要（預設 30 天）', async () => {
      (streamerService.getStreamerSummary as jest.Mock).mockResolvedValue(mockSummary);

      const response = await request(app)
        .get('/api/streamer/me/summary')
        .expect(200);

      expect(response.body).toEqual(mockSummary);
      expect(streamerService.getStreamerSummary).toHaveBeenCalledWith('test-streamer-123', '30d');
    });

    it('應該支援 7 天範圍查詢', async () => {
      const summary7d = { ...mockSummary, range: '7d' };
      (streamerService.getStreamerSummary as jest.Mock).mockResolvedValue(summary7d);

      const response = await request(app)
        .get('/api/streamer/me/summary?range=7d')
        .expect(200);

      expect(response.body).toEqual(summary7d);
      expect(streamerService.getStreamerSummary).toHaveBeenCalledWith('test-streamer-123', '7d');
    });

    it('應該支援 90 天範圍查詢', async () => {
      const summary90d = { ...mockSummary, range: '90d' };
      (streamerService.getStreamerSummary as jest.Mock).mockResolvedValue(summary90d);

      const response = await request(app)
        .get('/api/streamer/me/summary?range=90d')
        .expect(200);

      expect(response.body).toEqual(summary90d);
      expect(streamerService.getStreamerSummary).toHaveBeenCalledWith('test-streamer-123', '90d');
    });

    it('應該拒絕無效的範圍參數', async () => {
      const response = await request(app)
        .get('/api/streamer/me/summary?range=invalid')
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('Invalid range parameter');
    });

    it('應該處理服務層錯誤', async () => {
      (streamerService.getStreamerSummary as jest.Mock).mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .get('/api/streamer/me/summary')
        .expect(500);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toBe('Internal Server Error');
    });
  });

  describe('GET /api/streamer/:streamerId/summary (開發模式)', () => {
    const mockSummary = {
      range: '30d',
      totalStreamHours: 15.5,
      totalStreamSessions: 8,
      avgStreamDurationMinutes: 116,
      isEstimated: false,
    };

    it('應該成功取得指定 streamer 的統計', async () => {
      (streamerService.getStreamerSummary as jest.Mock).mockResolvedValue(mockSummary);

      const response = await request(app)
        .get('/api/streamer/test-streamer-456/summary')
        .expect(200);

      expect(response.body).toEqual(mockSummary);
      expect(streamerService.getStreamerSummary).toHaveBeenCalledWith('test-streamer-456', '30d');
    });

    it('應該支援指定範圍參數', async () => {
      const summary7d = { ...mockSummary, range: '7d' };
      (streamerService.getStreamerSummary as jest.Mock).mockResolvedValue(summary7d);

      const response = await request(app)
        .get('/api/streamer/test-streamer-456/summary?range=7d')
        .expect(200);

      expect(response.body).toEqual(summary7d);
      expect(streamerService.getStreamerSummary).toHaveBeenCalledWith('test-streamer-456', '7d');
    });
  });

  describe('GET /api/streamer/me/time-series', () => {
    const mockTimeSeries = {
      range: '30d',
      granularity: 'day',
      data: [
        { date: '2025-12-01', totalHours: 3.5, sessionCount: 1 },
        { date: '2025-12-02', totalHours: 5.0, sessionCount: 2 },
      ],
      isEstimated: false,
    };

    it('應該成功取得時間序列資料（預設 day 粒度）', async () => {
      (streamerService.getStreamerTimeSeries as jest.Mock).mockResolvedValue(mockTimeSeries);

      const response = await request(app)
        .get('/api/streamer/me/time-series')
        .expect(200);

      expect(response.body).toEqual(mockTimeSeries);
      expect(streamerService.getStreamerTimeSeries).toHaveBeenCalledWith('test-streamer-123', '30d', 'day');
    });

    it('應該支援 week 粒度查詢', async () => {
      const weeklyData = { ...mockTimeSeries, granularity: 'week' };
      (streamerService.getStreamerTimeSeries as jest.Mock).mockResolvedValue(weeklyData);

      const response = await request(app)
        .get('/api/streamer/me/time-series?granularity=week')
        .expect(200);

      expect(response.body).toEqual(weeklyData);
      expect(streamerService.getStreamerTimeSeries).toHaveBeenCalledWith('test-streamer-123', '30d', 'week');
    });

    it('應該支援不同範圍參數', async () => {
      const data7d = { ...mockTimeSeries, range: '7d' };
      (streamerService.getStreamerTimeSeries as jest.Mock).mockResolvedValue(data7d);

      const response = await request(app)
        .get('/api/streamer/me/time-series?range=7d')
        .expect(200);

      expect(response.body).toEqual(data7d);
      expect(streamerService.getStreamerTimeSeries).toHaveBeenCalledWith('test-streamer-123', '7d', 'day');
    });

    it('應該同時支援範圍和粒度參數', async () => {
      const data90dWeek = { ...mockTimeSeries, range: '90d', granularity: 'week' };
      (streamerService.getStreamerTimeSeries as jest.Mock).mockResolvedValue(data90dWeek);

      const response = await request(app)
        .get('/api/streamer/me/time-series?range=90d&granularity=week')
        .expect(200);

      expect(response.body).toEqual(data90dWeek);
      expect(streamerService.getStreamerTimeSeries).toHaveBeenCalledWith('test-streamer-123', '90d', 'week');
    });

    it('應該拒絕無效的範圍參數', async () => {
      const response = await request(app)
        .get('/api/streamer/me/time-series?range=invalid')
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('Invalid range parameter');
    });

    it('應該拒絕無效的粒度參數', async () => {
      const response = await request(app)
        .get('/api/streamer/me/time-series?granularity=invalid')
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('Invalid granularity parameter');
    });

    it('應該處理服務層錯誤', async () => {
      (streamerService.getStreamerTimeSeries as jest.Mock).mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .get('/api/streamer/me/time-series')
        .expect(500);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toBe('Internal Server Error');
    });
  });

  describe('GET /api/streamer/me/heatmap', () => {
    const mockHeatmap = {
      range: '30d',
      data: [
        { dayOfWeek: 1, hour: 20, value: 3.5 },
        { dayOfWeek: 2, hour: 21, value: 2.0 },
      ],
      maxValue: 3.5,
      minValue: 2.0,
      isEstimated: false,
    };

    it('應該成功取得熱力圖資料', async () => {
      (streamerService.getStreamerHeatmap as jest.Mock).mockResolvedValue(mockHeatmap);

      const response = await request(app)
        .get('/api/streamer/me/heatmap')
        .expect(200);

      expect(response.body).toEqual(mockHeatmap);
      expect(streamerService.getStreamerHeatmap).toHaveBeenCalledWith('test-streamer-123', '30d');
    });

    it('應該支援不同範圍參數', async () => {
      const heatmap7d = { ...mockHeatmap, range: '7d' };
      (streamerService.getStreamerHeatmap as jest.Mock).mockResolvedValue(heatmap7d);

      const response = await request(app)
        .get('/api/streamer/me/heatmap?range=7d')
        .expect(200);

      expect(response.body).toEqual(heatmap7d);
      expect(streamerService.getStreamerHeatmap).toHaveBeenCalledWith('test-streamer-123', '7d');
    });

    it('應該支援 90 天範圍', async () => {
      const heatmap90d = { ...mockHeatmap, range: '90d' };
      (streamerService.getStreamerHeatmap as jest.Mock).mockResolvedValue(heatmap90d);

      const response = await request(app)
        .get('/api/streamer/me/heatmap?range=90d')
        .expect(200);

      expect(response.body).toEqual(heatmap90d);
      expect(streamerService.getStreamerHeatmap).toHaveBeenCalledWith('test-streamer-123', '90d');
    });

    it('應該拒絕無效的範圍參數', async () => {
      const response = await request(app)
        .get('/api/streamer/me/heatmap?range=invalid')
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('Invalid range parameter');
    });

    it('應該處理服務層錯誤', async () => {
      (streamerService.getStreamerHeatmap as jest.Mock).mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .get('/api/streamer/me/heatmap')
        .expect(500);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toBe('Internal Server Error');
    });

    it('應該處理空資料情況', async () => {
      const emptyHeatmap = {
        range: '30d',
        data: [],
        maxValue: 0,
        minValue: 0,
        isEstimated: false,
      };
      (streamerService.getStreamerHeatmap as jest.Mock).mockResolvedValue(emptyHeatmap);

      const response = await request(app)
        .get('/api/streamer/me/heatmap')
        .expect(200);

      expect(response.body.data).toEqual([]);
      expect(response.body.maxValue).toBe(0);
    });
  });

  describe('GET /api/streamer/me/subscription-trend', () => {
    const mockSubscriptionTrend = {
      range: '30d',
      data: [
        { date: '2025-12-01', subsTotal: 100, subsDelta: 5 },
        { date: '2025-12-02', subsTotal: 105, subsDelta: 5 },
        { date: '2025-12-03', subsTotal: 103, subsDelta: -2 },
      ],
      hasExactData: false,
      isEstimated: true,
      estimateSource: 'daily_snapshot',
      minDataDays: 7,
      currentDataDays: 3,
      availableDays: 3,
    };

    it('應該成功取得訂閱趨勢資料', async () => {
      (subscriptionSyncService.getSubscriptionTrend as jest.Mock).mockResolvedValue(mockSubscriptionTrend);

      const response = await request(app)
        .get('/api/streamer/me/subscription-trend')
        .expect(200);

      expect(response.body).toEqual(mockSubscriptionTrend);
      expect(subscriptionSyncService.getSubscriptionTrend).toHaveBeenCalledWith('test-streamer-123', '30d');
    });

    it('應該支援 7 天範圍', async () => {
      const trend7d = { ...mockSubscriptionTrend, range: '7d', currentDataDays: 7, availableDays: 7 };
      (subscriptionSyncService.getSubscriptionTrend as jest.Mock).mockResolvedValue(trend7d);

      const response = await request(app)
        .get('/api/streamer/me/subscription-trend?range=7d')
        .expect(200);

      expect(response.body.range).toBe('7d');
      expect(subscriptionSyncService.getSubscriptionTrend).toHaveBeenCalledWith('test-streamer-123', '7d');
    });

    it('應該支援 90 天範圍', async () => {
      const trend90d = { ...mockSubscriptionTrend, range: '90d' };
      (subscriptionSyncService.getSubscriptionTrend as jest.Mock).mockResolvedValue(trend90d);

      const response = await request(app)
        .get('/api/streamer/me/subscription-trend?range=90d')
        .expect(200);

      expect(response.body.range).toBe('90d');
      expect(subscriptionSyncService.getSubscriptionTrend).toHaveBeenCalledWith('test-streamer-123', '90d');
    });

    it('應該拒絕無效的範圍參數', async () => {
      const response = await request(app)
        .get('/api/streamer/me/subscription-trend?range=invalid')
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('Invalid range parameter');
    });

    it('應該處理空資料情況', async () => {
      const emptyTrend = {
        range: '30d',
        data: [],
        hasExactData: false,
        isEstimated: true,
        estimateSource: 'daily_snapshot',
        minDataDays: 7,
        currentDataDays: 0,
        availableDays: 0,
      };
      (subscriptionSyncService.getSubscriptionTrend as jest.Mock).mockResolvedValue(emptyTrend);

      const response = await request(app)
        .get('/api/streamer/me/subscription-trend')
        .expect(200);

      expect(response.body.data).toEqual([]);
      expect(response.body.currentDataDays).toBe(0);
    });

    it('應該處理服務層錯誤', async () => {
      (subscriptionSyncService.getSubscriptionTrend as jest.Mock).mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .get('/api/streamer/me/subscription-trend')
        .expect(500);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toBe('Internal Server Error');
    });

    it('應該正確標記資料為估算值', async () => {
      (subscriptionSyncService.getSubscriptionTrend as jest.Mock).mockResolvedValue(mockSubscriptionTrend);

      const response = await request(app)
        .get('/api/streamer/me/subscription-trend')
        .expect(200);

      expect(response.body.isEstimated).toBe(true);
      expect(response.body.hasExactData).toBe(false);
      expect(response.body.estimateSource).toBe('daily_snapshot');
    });
  });

  describe('POST /api/streamer/me/sync-subscriptions', () => {
    it('應該成功同步訂閱資料', async () => {
      (subscriptionSyncService.syncSubscriptionSnapshot as jest.Mock).mockResolvedValue(undefined);

      const response = await request(app)
        .post('/api/streamer/me/sync-subscriptions')
        .expect(200);

      expect(response.body).toEqual({ message: 'Subscription data synced successfully' });
      expect(subscriptionSyncService.syncSubscriptionSnapshot).toHaveBeenCalledWith('test-streamer-123');
    });

    it('應該處理找不到頻道的錯誤', async () => {
      (subscriptionSyncService.syncSubscriptionSnapshot as jest.Mock).mockRejectedValue(
        new Error('No channel found for streamer ID: test-streamer-123')
      );

      const response = await request(app)
        .post('/api/streamer/me/sync-subscriptions')
        .expect(404);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toBe('Channel not found');
    });

    it('應該處理找不到 Token 的錯誤', async () => {
      (subscriptionSyncService.syncSubscriptionSnapshot as jest.Mock).mockRejectedValue(
        new Error('No Twitch token found for streamer ID: test-streamer-123')
      );

      const response = await request(app)
        .post('/api/streamer/me/sync-subscriptions')
        .expect(401);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('Twitch token not found');
    });

    it('應該處理 Twitch API 未授權錯誤', async () => {
      (subscriptionSyncService.syncSubscriptionSnapshot as jest.Mock).mockRejectedValue(
        new Error('Unauthorized: Token may be expired or invalid')
      );

      const response = await request(app)
        .post('/api/streamer/me/sync-subscriptions')
        .expect(403);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('Unable to access subscription data');
    });

    it('應該處理 Twitch API 權限錯誤', async () => {
      (subscriptionSyncService.syncSubscriptionSnapshot as jest.Mock).mockRejectedValue(
        new Error('Forbidden: Broadcaster ID does not match token user or missing scope')
      );

      const response = await request(app)
        .post('/api/streamer/me/sync-subscriptions')
        .expect(403);

      expect(response.body).toHaveProperty('error');
    });

    it('應該處理一般服務層錯誤', async () => {
      (subscriptionSyncService.syncSubscriptionSnapshot as jest.Mock).mockRejectedValue(
        new Error('Unexpected error')
      );

      const response = await request(app)
        .post('/api/streamer/me/sync-subscriptions')
        .expect(500);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toBe('Failed to sync subscription data');
    });
  });
});
