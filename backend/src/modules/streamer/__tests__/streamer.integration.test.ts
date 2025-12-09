import request from 'supertest';
import express from 'express';
import { streamerRoutes } from '../streamer.routes';
import * as streamerService from '../streamer.service';

// Mock streamer service
jest.mock('../streamer.service');

// Mock auth middleware
jest.mock('../../auth/auth.middleware', () => ({
  requireAuth: (req: any, res: any, next: any) => {
    req.user = { streamerId: 'test-streamer-123' };
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
});
