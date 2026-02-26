import { LifetimeStatsAggregatorService } from "../lifetime-stats-aggregator.service";
import { prisma } from "../../db/prisma";

jest.mock("../../db/prisma", () => ({
  prisma: {
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
    viewerChannelLifetimeStats: {
      findUnique: jest.fn(),
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
  const viewerId = "v1";
  const channelId = "c1";

  beforeEach(() => {
    service = new LifetimeStatsAggregatorService();
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(mockDate);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("should aggregate empty stats when no records found", async () => {
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
    (prisma.$queryRaw as jest.Mock)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          activeDaysLast30: 0,
          activeDaysLast90: 0,
          mostActiveMonth: null,
          mostActiveMonthCount: 0,
        },
      ]);

    await service.aggregateStats(viewerId, channelId);

    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it("should calculate watch time and messages correctly", async () => {
    (prisma.viewerChannelDailyStat.aggregate as jest.Mock).mockResolvedValue({
      _sum: { watchSeconds: 5400 },
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
    (prisma.$queryRaw as jest.Mock)
      .mockResolvedValueOnce([
        { d: new Date("2025-12-01") },
        { d: new Date("2025-12-02") },
      ])
      .mockResolvedValueOnce([
        {
          activeDaysLast30: 2,
          activeDaysLast90: 2,
          mostActiveMonth: "2025-12",
          mostActiveMonthCount: 2,
        },
      ]);

    await service.aggregateStats(viewerId, channelId);

    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it("should calculate streak correctly", async () => {
    const dates = ["2025-12-01", "2025-12-02", "2025-12-03", "2025-12-05", "2025-12-06"];

    (prisma.viewerChannelDailyStat.aggregate as jest.Mock).mockResolvedValue({
      _sum: { watchSeconds: 1500 },
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
    (prisma.$queryRaw as jest.Mock)
      .mockResolvedValueOnce(dates.map((d) => ({ d: new Date(d) })))
      .mockResolvedValueOnce([
        {
          activeDaysLast30: 5,
          activeDaysLast90: 5,
          mostActiveMonth: "2025-12",
          mostActiveMonthCount: 5,
        },
      ]);

    await service.aggregateStats(viewerId, channelId);

    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it("should calculate current streak correctly if active recently", async () => {
    const dates = ["2025-12-15", "2025-12-16"];

    (prisma.viewerChannelDailyStat.aggregate as jest.Mock).mockResolvedValue({
      _sum: { watchSeconds: 600 },
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
    (prisma.$queryRaw as jest.Mock)
      .mockResolvedValueOnce(dates.map((d) => ({ d: new Date(d) })))
      .mockResolvedValueOnce([
        {
          activeDaysLast30: 2,
          activeDaysLast90: 2,
          mostActiveMonth: "2025-12",
          mostActiveMonthCount: 2,
        },
      ]);

    await service.aggregateStats(viewerId, channelId);

    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it("prevents key lifetime totals from decreasing by default", async () => {
    (prisma.viewerChannelDailyStat.aggregate as jest.Mock).mockResolvedValue({
      _sum: { watchSeconds: 1800 },
      _count: 1,
      _min: { date: new Date("2025-12-16") },
      _max: { date: new Date("2025-12-16") },
    });
    (prisma.viewerChannelMessageDailyAgg.aggregate as jest.Mock).mockResolvedValue({
      _sum: {
        totalMessages: 10,
        chatMessages: 8,
        subscriptions: 0,
        cheers: 0,
        totalBits: 0,
      },
    });
    (prisma.$queryRaw as jest.Mock)
      .mockResolvedValueOnce([{ d: new Date("2025-12-16") }])
      .mockResolvedValueOnce([
        {
          activeDaysLast30: 1,
          activeDaysLast90: 1,
          mostActiveMonth: "2025-12",
          mostActiveMonthCount: 1,
        },
      ]);

    await service.aggregateStats(viewerId, channelId);

    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it("allows decreases when preventDecreases is false", async () => {
    (prisma.viewerChannelDailyStat.aggregate as jest.Mock).mockResolvedValue({
      _sum: { watchSeconds: 1800 },
      _count: 1,
      _min: { date: new Date("2025-12-16") },
      _max: { date: new Date("2025-12-16") },
    });
    (prisma.viewerChannelMessageDailyAgg.aggregate as jest.Mock).mockResolvedValue({
      _sum: {
        totalMessages: 10,
        chatMessages: 8,
        subscriptions: 0,
        cheers: 0,
        totalBits: 0,
      },
    });
    (prisma.$queryRaw as jest.Mock)
      .mockResolvedValueOnce([{ d: new Date("2025-12-16") }])
      .mockResolvedValueOnce([
        {
          activeDaysLast30: 1,
          activeDaysLast90: 1,
          mostActiveMonth: "2025-12",
          mostActiveMonthCount: 1,
        },
      ]);

    await service.aggregateStats(viewerId, channelId, { preventDecreases: false });

    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    expect(prisma.viewerChannelLifetimeStats.findUnique).not.toHaveBeenCalled();
    expect(prisma.viewerChannelLifetimeStats.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          totalWatchTimeMinutes: 30,
          totalMessages: 10,
        }),
      })
    );
  });
});
