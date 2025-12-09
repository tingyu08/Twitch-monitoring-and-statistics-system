import { getStreamerSummary } from '../streamer.service';
import { prisma } from '../../../db/prisma';

// Mock Prisma client
jest.mock('../../../db/prisma', () => ({
  prisma: {
    channel: {
      findFirst: jest.fn(),
    },
    streamSession: {
      findMany: jest.fn(),
    },
  },
}));

describe('Streamer Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getStreamerSummary', () => {
    const mockStreamerId = 'test-streamer-123';
    const mockChannel = {
      id: 'channel-123',
      streamerId: mockStreamerId,
      twitchChannelId: 'twitch-channel-123',
      channelName: 'testchannel',
    };

    it('應該在找不到頻道時回傳空統計', async () => {
      (prisma.channel.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await getStreamerSummary(mockStreamerId, '30d');

      expect(result).toEqual({
        range: '30d',
        totalStreamHours: 0,
        totalStreamSessions: 0,
        avgStreamDurationMinutes: 0,
        isEstimated: false,
      });
      expect(prisma.channel.findFirst).toHaveBeenCalledWith({
        where: { streamerId: mockStreamerId },
      });
    });

    it('應該正確計算 7 天的統計數據', async () => {
      const mockSessions = [
        { durationSeconds: 7200, startedAt: new Date() }, // 2 小時
        { durationSeconds: 5400, startedAt: new Date() }, // 1.5 小時
        { durationSeconds: 3600, startedAt: new Date() }, // 1 小時
      ];

      (prisma.channel.findFirst as jest.Mock).mockResolvedValue(mockChannel);
      (prisma.streamSession.findMany as jest.Mock).mockResolvedValue(mockSessions);

      const result = await getStreamerSummary(mockStreamerId, '7d');

      expect(result.range).toBe('7d');
      expect(result.totalStreamSessions).toBe(3);
      expect(result.totalStreamHours).toBe(4.5); // 總共 16200 秒 = 4.5 小時
      expect(result.avgStreamDurationMinutes).toBe(90); // 平均 5400 秒 = 90 分鐘
      expect(result.isEstimated).toBe(false);
    });

    it('應該正確計算 30 天的統計數據', async () => {
      const mockSessions = [
        { durationSeconds: 10800, startedAt: new Date() }, // 3 小時
        { durationSeconds: 7200, startedAt: new Date() },  // 2 小時
      ];

      (prisma.channel.findFirst as jest.Mock).mockResolvedValue(mockChannel);
      (prisma.streamSession.findMany as jest.Mock).mockResolvedValue(mockSessions);

      const result = await getStreamerSummary(mockStreamerId, '30d');

      expect(result.range).toBe('30d');
      expect(result.totalStreamSessions).toBe(2);
      expect(result.totalStreamHours).toBe(5); // 總共 18000 秒 = 5 小時
      expect(result.avgStreamDurationMinutes).toBe(150); // 平均 9000 秒 = 150 分鐘
    });

    it('應該正確計算 90 天的統計數據', async () => {
      const mockSessions = [
        { durationSeconds: 3600, startedAt: new Date() }, // 1 小時
      ];

      (prisma.channel.findFirst as jest.Mock).mockResolvedValue(mockChannel);
      (prisma.streamSession.findMany as jest.Mock).mockResolvedValue(mockSessions);

      const result = await getStreamerSummary(mockStreamerId, '90d');

      expect(result.range).toBe('90d');
      expect(result.totalStreamSessions).toBe(1);
      expect(result.totalStreamHours).toBe(1);
      expect(result.avgStreamDurationMinutes).toBe(60);
    });

    it('應該在沒有開台紀錄時回傳 0 值', async () => {
      (prisma.channel.findFirst as jest.Mock).mockResolvedValue(mockChannel);
      (prisma.streamSession.findMany as jest.Mock).mockResolvedValue([]);

      const result = await getStreamerSummary(mockStreamerId, '30d');

      expect(result.totalStreamSessions).toBe(0);
      expect(result.totalStreamHours).toBe(0);
      expect(result.avgStreamDurationMinutes).toBe(0);
    });

    it('應該正確處理 null 的 durationSeconds', async () => {
      const mockSessions = [
        { durationSeconds: null, startedAt: new Date() },
        { durationSeconds: 3600, startedAt: new Date() },
      ];

      (prisma.channel.findFirst as jest.Mock).mockResolvedValue(mockChannel);
      (prisma.streamSession.findMany as jest.Mock).mockResolvedValue(mockSessions);

      const result = await getStreamerSummary(mockStreamerId, '30d');

      expect(result.totalStreamSessions).toBe(2);
      expect(result.totalStreamHours).toBe(1); // 只計算有值的 3600 秒
      expect(result.avgStreamDurationMinutes).toBe(30); // 3600 / 2 = 1800 秒 = 30 分鐘
    });

    it('應該正確查詢指定時間範圍內的資料', async () => {
      const now = new Date();
      const cutoffDate7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      (prisma.channel.findFirst as jest.Mock).mockResolvedValue(mockChannel);
      (prisma.streamSession.findMany as jest.Mock).mockResolvedValue([]);

      await getStreamerSummary(mockStreamerId, '7d');

      const findManyCall = (prisma.streamSession.findMany as jest.Mock).mock.calls[0][0];
      expect(findManyCall.where.channelId).toBe(mockChannel.id);
      expect(findManyCall.where.startedAt.gte).toBeInstanceOf(Date);
      
      // 驗證時間範圍在合理誤差內（1秒）
      const actualCutoff = findManyCall.where.startedAt.gte.getTime();
      const expectedCutoff = cutoffDate7d.getTime();
      expect(Math.abs(actualCutoff - expectedCutoff)).toBeLessThan(1000);
    });

    it('應該使用預設的 30 天範圍', async () => {
      (prisma.channel.findFirst as jest.Mock).mockResolvedValue(mockChannel);
      (prisma.streamSession.findMany as jest.Mock).mockResolvedValue([]);

      const result = await getStreamerSummary(mockStreamerId);

      expect(result.range).toBe('30d');
    });
  });
});
