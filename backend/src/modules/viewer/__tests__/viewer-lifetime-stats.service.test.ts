jest.mock("../../../db/prisma", () => ({
  prisma: {
    viewerChannelLifetimeStats: {
      findUnique: jest.fn(),
    },
  },
}));

jest.mock("../../../services/badge.service", () => ({
  badgeService: {
    checkBadges: jest.fn(),
  },
}));

jest.mock("../../../services/lifetime-stats-aggregator.service", () => ({
  lifetimeStatsAggregator: {
    aggregateStatsWithChannel: jest.fn(),
  },
}));

import { prisma } from "../../../db/prisma";
import { badgeService } from "../../../services/badge.service";
import { lifetimeStatsAggregator } from "../../../services/lifetime-stats-aggregator.service";
import { ViewerLifetimeStatsService } from "../viewer-lifetime-stats.service";

describe("ViewerLifetimeStatsService", () => {
  const service = new ViewerLifetimeStatsService();

  const baseStat = {
    viewerId: "v1",
    channelId: "c1",
    totalWatchTimeMinutes: 1200,
    avgSessionMinutes: 30,
    firstWatchedAt: new Date("2025-01-01T00:00:00.000Z"),
    lastWatchedAt: new Date("2025-01-10T00:00:00.000Z"),
    totalMessages: 400,
    totalChatMessages: 350,
    totalSubscriptions: 3,
    totalCheers: 4,
    totalBits: 500,
    trackingDays: 20,
    longestStreakDays: 7,
    currentStreakDays: 2,
    activeDaysLast30: 10,
    activeDaysLast90: 25,
    mostActiveMonth: "2025-01",
    mostActiveMonthCount: 15,
    watchTimePercentile: 80,
    messagePercentile: 70,
    createdAt: new Date(),
    updatedAt: new Date(),
    channel: {
      channelName: "Demo Channel",
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns mapped lifetime stats when existing record found", async () => {
    (prisma.viewerChannelLifetimeStats.findUnique as jest.Mock).mockResolvedValue(baseStat);
    (badgeService.checkBadges as jest.Mock).mockReturnValue([{ key: "watchtime" }]);

    const result = await service.getStats("v1", "c1");

    expect(prisma.viewerChannelLifetimeStats.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { viewerId_channelId: { viewerId: "v1", channelId: "c1" } } })
    );
    expect(badgeService.checkBadges).toHaveBeenCalledWith(baseStat);
    expect(result).toEqual(
      expect.objectContaining({
        channelId: "c1",
        channelName: "Demo Channel",
        badges: [{ key: "watchtime" }],
        lifetimeStats: expect.objectContaining({
          watchTime: expect.objectContaining({ totalHours: 20 }),
          messages: expect.objectContaining({ totalMessages: 400 }),
          loyalty: expect.objectContaining({ trackingDays: 20 }),
        }),
      })
    );
  });

  it("runs on-demand aggregation when no cached stat exists", async () => {
    (prisma.viewerChannelLifetimeStats.findUnique as jest.Mock).mockResolvedValue(null);
    (lifetimeStatsAggregator.aggregateStatsWithChannel as jest.Mock).mockResolvedValue(baseStat);
    (badgeService.checkBadges as jest.Mock).mockReturnValue([]);

    const result = await service.getStats("v1", "c1");

    expect(lifetimeStatsAggregator.aggregateStatsWithChannel).toHaveBeenCalledWith("v1", "c1");
    expect(result).toEqual(expect.objectContaining({ channelName: "Demo Channel" }));
  });

  it("returns null when no data even after aggregation", async () => {
    (prisma.viewerChannelLifetimeStats.findUnique as jest.Mock).mockResolvedValue(null);
    (lifetimeStatsAggregator.aggregateStatsWithChannel as jest.Mock).mockResolvedValue(null);

    const result = await service.getStats("v1", "c1");

    expect(result).toBeNull();
  });

  it("caps and rounds radar scores at expected thresholds", () => {
    const radar = (service as any).calculateRadarScores({
      ...baseStat,
      totalWatchTimeMinutes: 500 * 60,
      totalMessages: 2000,
      trackingDays: 365,
      activeDaysLast30: 30,
      totalBits: 10000,
      totalSubscriptions: 12,
    });

    expect(radar).toEqual({
      watchTime: 100,
      interaction: 100,
      loyalty: 100,
      activity: 100,
      contribution: 100,
      community: 100,
    });
  });

  it("falls back percentile rankings to 0 when null", async () => {
    (prisma.viewerChannelLifetimeStats.findUnique as jest.Mock).mockResolvedValue({
      ...baseStat,
      watchTimePercentile: null,
      messagePercentile: null,
    });
    (badgeService.checkBadges as jest.Mock).mockReturnValue([]);

    const result = await service.getStats("v1", "c1");

    expect(result).toEqual(
      expect.objectContaining({
        lifetimeStats: expect.objectContaining({
          rankings: {
            watchTimePercentile: 0,
            messagePercentile: 0,
          },
        }),
      })
    );
  });
});
