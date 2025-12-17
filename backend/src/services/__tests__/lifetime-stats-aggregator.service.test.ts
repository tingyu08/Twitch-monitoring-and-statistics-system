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
    },
    viewerChannelMessageDailyAgg: {
      findMany: jest.fn(),
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
    (prisma.viewerChannelDailyStat.findMany as jest.Mock).mockResolvedValue([]);
    (
      prisma.viewerChannelMessageDailyAgg.findMany as jest.Mock
    ).mockResolvedValue([]);

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
    (prisma.viewerChannelDailyStat.findMany as jest.Mock).mockResolvedValue([
      { date: new Date("2025-12-01"), watchSeconds: 3600 }, // 60 min
      { date: new Date("2025-12-02"), watchSeconds: 1800 }, // 30 min
    ]);

    (
      prisma.viewerChannelMessageDailyAgg.findMany as jest.Mock
    ).mockResolvedValue([
      {
        date: new Date("2025-12-01"),
        totalMessages: 10,
        chatMessages: 5,
        subscriptions: 0,
        cheers: 0,
        totalBits: 0,
      },
      {
        date: new Date("2025-12-02"),
        totalMessages: 20,
        chatMessages: 15,
        subscriptions: 1,
        cheers: 0,
        totalBits: 100,
      },
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
    const dates = [
      "2025-12-01",
      "2025-12-02",
      "2025-12-03",
      "2025-12-05",
      "2025-12-06",
    ];

    (prisma.viewerChannelDailyStat.findMany as jest.Mock).mockResolvedValue(
      dates.map((d) => ({ date: new Date(d), watchSeconds: 300 }))
    );
    (
      prisma.viewerChannelMessageDailyAgg.findMany as jest.Mock
    ).mockResolvedValue([]);

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

    (prisma.viewerChannelDailyStat.findMany as jest.Mock).mockResolvedValue(
      dates.map((d) => ({ date: new Date(d), watchSeconds: 300 }))
    );
    (
      prisma.viewerChannelMessageDailyAgg.findMany as jest.Mock
    ).mockResolvedValue([]);

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
