jest.mock("../../../db/prisma", () => ({
  prisma: {
    viewerChannelMessageDailyAgg: {
      findMany: jest.fn(),
    },
  },
}));

jest.mock("../../../utils/cache-manager", () => ({
  cacheManager: {
    getOrSetWithTags: jest.fn(async (_key: string, factory: () => Promise<unknown>) => factory()),
  },
  CacheTTL: { MEDIUM: 300, SHORT: 60 },
  getAdaptiveTTL: jest.fn(() => 300),
}));

jest.mock("../../../utils/logger", () => ({
  logger: { debug: jest.fn(), info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

import { getViewerMessageStats } from "../viewer-message-stats.service";
import { prisma as prismaClient } from "../../../db/prisma";

const prisma = prismaClient as unknown as {
  viewerChannelMessageDailyAgg: { findMany: jest.Mock };
};

function makeAgg(
  date: Date,
  overrides: Partial<{
    totalMessages: number;
    chatMessages: number;
    subscriptions: number;
    cheers: number;
    giftSubs: number;
    raids: number;
    totalBits: number;
  }> = {}
) {
  return {
    date,
    totalMessages: 10,
    chatMessages: 8,
    subscriptions: 1,
    cheers: 0,
    giftSubs: 0,
    raids: 0,
    totalBits: 0,
    ...overrides,
  };
}

describe("getViewerMessageStats", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("正常聚合計算", () => {
    it("應正確加總多日的訊息統計", async () => {
      const aggs = [
        makeAgg(new Date("2026-01-10"), { totalMessages: 5, chatMessages: 5, totalBits: 0 }),
        makeAgg(new Date("2026-01-15"), {
          totalMessages: 15,
          chatMessages: 10,
          cheers: 1,
          totalBits: 100,
        }),
      ];
      prisma.viewerChannelMessageDailyAgg.findMany.mockResolvedValue(aggs);

      const result = await getViewerMessageStats("viewer1", "channel1", "2026-01-01", "2026-01-31");

      expect(result.channelId).toBe("channel1");
      expect(result.summary.totalMessages).toBe(20);
      expect(result.summary.avgMessagesPerStream).toBe(10); // 20 / 2
      expect(result.interactionBreakdown.totalBits).toBe(100);
      expect(result.dailyBreakdown).toHaveLength(2);
    });

    it("應從所有日期中找出最活躍日", async () => {
      const aggs = [
        makeAgg(new Date("2026-01-10"), { totalMessages: 5 }),
        makeAgg(new Date("2026-01-15"), { totalMessages: 25 }),
        makeAgg(new Date("2026-01-20"), { totalMessages: 8 }),
      ];
      prisma.viewerChannelMessageDailyAgg.findMany.mockResolvedValue(aggs);

      const result = await getViewerMessageStats("viewer1", "channel1");

      expect(result.summary.mostActiveDate).toBe("2026-01-15");
      expect(result.summary.mostActiveDateCount).toBe(25);
    });

    it("應將 lastMessageAt 設為最後一筆聚合的日期", async () => {
      const aggs = [
        makeAgg(new Date("2026-01-10")),
        makeAgg(new Date("2026-01-20")),
      ];
      prisma.viewerChannelMessageDailyAgg.findMany.mockResolvedValue(aggs);

      const result = await getViewerMessageStats("viewer1", "channel1");

      expect(result.summary.lastMessageAt).toBe("2026-01-20");
    });

    it("應正確拆分各互動類型計數", async () => {
      const agg = makeAgg(new Date("2026-01-10"), {
        totalMessages: 20,
        chatMessages: 10,
        subscriptions: 3,
        cheers: 2,
        giftSubs: 1,
        raids: 1,
        totalBits: 500,
      });
      prisma.viewerChannelMessageDailyAgg.findMany.mockResolvedValue([agg]);

      const result = await getViewerMessageStats("viewer1", "channel1");

      expect(result.interactionBreakdown.chatMessages).toBe(10);
      expect(result.interactionBreakdown.subscriptions).toBe(3);
      expect(result.interactionBreakdown.cheers).toBe(2);
      expect(result.interactionBreakdown.giftSubs).toBe(1);
      expect(result.interactionBreakdown.raids).toBe(1);
      expect(result.interactionBreakdown.totalBits).toBe(500);
    });

    it("應在 dailyBreakdown 中正確格式化日期字串", async () => {
      const aggs = [makeAgg(new Date("2026-01-05"))];
      prisma.viewerChannelMessageDailyAgg.findMany.mockResolvedValue(aggs);

      const result = await getViewerMessageStats("viewer1", "channel1");

      expect(result.dailyBreakdown[0].date).toBe("2026-01-05");
    });
  });

  describe("無資料邊界情況", () => {
    it("沒有資料時應回傳全部為零的統計", async () => {
      prisma.viewerChannelMessageDailyAgg.findMany.mockResolvedValue([]);

      const result = await getViewerMessageStats("viewer1", "channel1");

      expect(result.summary.totalMessages).toBe(0);
      expect(result.summary.avgMessagesPerStream).toBe(0);
      expect(result.summary.mostActiveDate).toBeNull();
      expect(result.summary.lastMessageAt).toBeNull();
      expect(result.dailyBreakdown).toHaveLength(0);
      expect(result.interactionBreakdown.chatMessages).toBe(0);
    });
  });

  describe("日期範圍驗證", () => {
    it("未傳入日期時應預設為最近 30 天", async () => {
      prisma.viewerChannelMessageDailyAgg.findMany.mockResolvedValue([]);

      await getViewerMessageStats("viewer1", "channel1");

      const call = prisma.viewerChannelMessageDailyAgg.findMany.mock.calls[0][0];
      const startDate = call.where.date.gte as Date;
      const endDate = call.where.date.lte as Date;
      const diffDays = Math.round(
        (endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)
      );
      expect(diffDays).toBeCloseTo(30, 0);
    });

    it("startDate > endDate 時應 fallback 為最近 30 天", async () => {
      prisma.viewerChannelMessageDailyAgg.findMany.mockResolvedValue([]);

      await getViewerMessageStats("viewer1", "channel1", "2026-02-01", "2026-01-01");

      const call = prisma.viewerChannelMessageDailyAgg.findMany.mock.calls[0][0];
      const start = call.where.date.gte as Date;
      const end = call.where.date.lte as Date;
      const diffDays = Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
      expect(diffDays).toBeCloseTo(30, 0);
    });

    it("日期範圍超過 365 天時應截斷至 365 天", async () => {
      prisma.viewerChannelMessageDailyAgg.findMany.mockResolvedValue([]);

      // startDate 遠超 365 天前
      await getViewerMessageStats("viewer1", "channel1", "2020-01-01", "2026-01-01");

      const call = prisma.viewerChannelMessageDailyAgg.findMany.mock.calls[0][0];
      const start = call.where.date.gte as Date;
      const end = new Date("2026-01-01");
      const diffDays = Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
      expect(diffDays).toBeLessThanOrEqual(365);
    });

    it("傳入無效日期字串時應正常執行不拋出例外", async () => {
      prisma.viewerChannelMessageDailyAgg.findMany.mockResolvedValue([]);

      await expect(
        getViewerMessageStats("viewer1", "channel1", "invalid-date", "also-invalid")
      ).resolves.not.toThrow();
    });

    it("應在回傳結果中包含正確的 timeRange", async () => {
      prisma.viewerChannelMessageDailyAgg.findMany.mockResolvedValue([]);

      const result = await getViewerMessageStats(
        "viewer1",
        "channel1",
        "2026-01-01",
        "2026-01-31"
      );

      expect(result.timeRange.startDate).toBe("2026-01-01");
      expect(result.timeRange.endDate).toBe("2026-01-31");
    });
  });

  describe("快取 key 格式", () => {
    it("應以 viewerId、channelId 與日期區間為快取 key", async () => {
      const { cacheManager } = jest.requireMock("../../../utils/cache-manager") as {
        cacheManager: { getOrSetWithTags: jest.Mock };
      };
      prisma.viewerChannelMessageDailyAgg.findMany.mockResolvedValue([]);

      await getViewerMessageStats("viewer1", "channel1", "2026-01-01", "2026-01-31");

      const cacheKey = cacheManager.getOrSetWithTags.mock.calls[0][0] as string;
      expect(cacheKey).toContain("viewer:viewer1");
      expect(cacheKey).toContain("channel:channel1");
      expect(cacheKey).toContain("msgstats");
    });
  });
});
