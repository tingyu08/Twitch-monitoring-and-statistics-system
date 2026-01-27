import { LifetimeStatsAggregatorService } from "../lifetime-stats-aggregator.service";
import { prisma } from "../../db/prisma";

// Mock Prisma
jest.mock("../../db/prisma", () => ({
  prisma: {
    viewerChannelLifetimeStats: {
      upsert: jest.fn(),
    },
    viewerChannelDailyStat: {
      findMany: jest.fn(),
      aggregate: jest.fn(),
    },
    viewerChannelMessageDailyAgg: {
      findMany: jest.fn(),
      aggregate: jest.fn(),
    },
  },
}));

describe("LifetimeStatsAggregatorService", () => {
  let service: LifetimeStatsAggregatorService;
  const mockDate = new Date("2025-12-16T12:00:00Z");

  beforeEach(() => {
    service = new LifetimeStatsAggregatorService();
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(mockDate);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const viewerId = "v1";
  const channelId = "c1";

  it("should aggregate empty stats when no records found", async () => {
    // Mock aggregate results (empty)
    (prisma.viewerChannelDailyStat.aggregate as jest.Mock).mockResolvedValue({
      _sum: { watchSeconds: null },
      _count: 0,
      _min: { date: null },
      _max: { date: null },
    });
    (prisma.viewerChannelMessageDailyAgg.aggregate as jest.Mock).mockResolvedValue({
      _sum: {
        totalMessages: null,
        chatMessages: null,
        subscriptions: null,
        cheers: null,
        totalBits: null,
      },
    });
    // Mock findMany for dates (empty)
    (prisma.viewerChannelDailyStat.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.viewerChannelMessageDailyAgg.findMany as jest.Mock).mockResolvedValue([]);

    await service.aggregateStats(viewerId, channelId);

    expect(prisma.viewerChannelLifetimeStats.upsert).toHaveBeenCalledWith({
      where: { viewerId_channelId: { viewerId, channelId } },
      create: expect.objectContaining({
        totalWatchTimeMinutes: 0,
        totalMessages: 0,
        longestStreakDays: 0,
      }),
      update: expect.objectContaining({
        totalWatchTimeMinutes: 0,
        totalMessages: 0,
      }),
    });
  });

  it("should calculate watch time and messages correctly", async () => {
    // Mock aggregate results
    (prisma.viewerChannelDailyStat.aggregate as jest.Mock).mockResolvedValue({
      _sum: { watchSeconds: 5400 }, // 3600 + 1800 = 90 min
      _count: 2,
      _min: { date: new Date("2025-12-01") },
      _max: { date: new Date("2025-12-02") },
    });
    (prisma.viewerChannelMessageDailyAgg.aggregate as jest.Mock).mockResolvedValue({
      _sum: {
        totalMessages: 30,
        chatMessages: 20,
        subscriptions: 1,
        cheers: 0,
        totalBits: 100,
      },
    });
    // Mock findMany for dates
    (prisma.viewerChannelDailyStat.findMany as jest.Mock).mockResolvedValue([
      { date: new Date("2025-12-01") },
      { date: new Date("2025-12-02") },
    ]);
    (prisma.viewerChannelMessageDailyAgg.findMany as jest.Mock).mockResolvedValue([
      { date: new Date("2025-12-01") },
      { date: new Date("2025-12-02") },
    ]);

    await service.aggregateStats(viewerId, channelId);

    expect(prisma.viewerChannelLifetimeStats.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          totalWatchTimeMinutes: 90, // 60 + 30
          totalMessages: 30, // 10 + 20
          totalChatMessages: 20, // 5 + 15
          totalSubscriptions: 1,
          totalBits: 100,
          trackingDays: 2,
        }),
      })
    );
  });

  it("should calculate streak correctly", async () => {
    // Dates: 1st, 2nd, 3rd (Streak 3), 5th, 6th (Streak 2)
    // Longest: 3
    const dates = ["2025-12-01", "2025-12-02", "2025-12-03", "2025-12-05", "2025-12-06"];

    // Mock aggregate results
    (prisma.viewerChannelDailyStat.aggregate as jest.Mock).mockResolvedValue({
      _sum: { watchSeconds: 1500 }, // 5 * 300
      _count: 5,
      _min: { date: new Date("2025-12-01") },
      _max: { date: new Date("2025-12-06") },
    });
    (prisma.viewerChannelMessageDailyAgg.aggregate as jest.Mock).mockResolvedValue({
      _sum: {
        totalMessages: null,
        chatMessages: null,
        subscriptions: null,
        cheers: null,
        totalBits: null,
      },
    });
    // Mock findMany for dates
    (prisma.viewerChannelDailyStat.findMany as jest.Mock).mockResolvedValue(
      dates.map((d) => ({ date: new Date(d) }))
    );
    (prisma.viewerChannelMessageDailyAgg.findMany as jest.Mock).mockResolvedValue([]);

    await service.aggregateStats(viewerId, channelId);

    expect(prisma.viewerChannelLifetimeStats.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          longestStreakDays: 3,
        }),
      })
    );
  });

  it("should calculate current streak correctly if active recently", async () => {
    // System time is 2025-12-16
    // Activity: 15th, 16th (Streak 2)
    const dates = ["2025-12-15", "2025-12-16"];

    // Mock aggregate results
    (prisma.viewerChannelDailyStat.aggregate as jest.Mock).mockResolvedValue({
      _sum: { watchSeconds: 600 }, // 2 * 300
      _count: 2,
      _min: { date: new Date("2025-12-15") },
      _max: { date: new Date("2025-12-16") },
    });
    (prisma.viewerChannelMessageDailyAgg.aggregate as jest.Mock).mockResolvedValue({
      _sum: {
        totalMessages: null,
        chatMessages: null,
        subscriptions: null,
        cheers: null,
        totalBits: null,
      },
    });
    // Mock findMany for dates
    (prisma.viewerChannelDailyStat.findMany as jest.Mock).mockResolvedValue(
      dates.map((d) => ({ date: new Date(d) }))
    );
    (prisma.viewerChannelMessageDailyAgg.findMany as jest.Mock).mockResolvedValue([]);

    await service.aggregateStats(viewerId, channelId);

    expect(prisma.viewerChannelLifetimeStats.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          currentStreakDays: 2,
        }),
      })
    );
  });
});
