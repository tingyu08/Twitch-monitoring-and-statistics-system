import {
  getChannelStats,
  getFollowedChannels,
  recordConsent,
  refreshViewerChannelSummaryForChannels,
  refreshViewerChannelSummaryForViewer,
  syncSummaryStatsFromLifetime,
  warmViewerChannelsCache,
} from "../viewer.service";

jest.mock("../../../db/prisma", () => ({
  prisma: {
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
    viewer: {
      update: jest.fn(),
    },
    viewerChannelDailyStat: {
      findMany: jest.fn(),
    },
    viewerChannelSummary: {
      findMany: jest.fn(),
    },
    viewerChannelLifetimeStats: {
      findMany: jest.fn(),
    },
    channel: {
      findUnique: jest.fn(),
    },
  },
}));

jest.mock("../../../services/twitch-helix.service", () => ({
  twurpleHelixService: {
    getStreamsByUserIds: jest.fn(),
  },
}));

jest.mock("../../../utils/cache-manager", () => ({
  cacheManager: {
    getOrSet: jest.fn(async (_key: string, factory: () => Promise<unknown>) => factory()),
    getOrSetWithTags: jest.fn(
      async (_key: string, factory: () => Promise<unknown>) => factory()
    ),
    delete: jest.fn(),
  },
  CacheTTL: {
    SHORT: 30,
    MEDIUM: 300,
  },
  getAdaptiveTTL: jest.fn(() => 300),
}));

jest.mock("../../../utils/logger", () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

import { prisma as prismaClient } from "../../../db/prisma";
import { twurpleHelixService } from "../../../services/twitch-helix.service";
import { cacheManager } from "../../../utils/cache-manager";
import { logger } from "../../../utils/logger";

type PrismaMock = {
  $queryRaw: jest.Mock;
  $executeRaw: jest.Mock;
  viewer: { update: jest.Mock };
  viewerChannelDailyStat: { findMany: jest.Mock };
  viewerChannelSummary: { findMany: jest.Mock };
  viewerChannelLifetimeStats: { findMany: jest.Mock };
  channel: { findUnique: jest.Mock };
};

const prisma = prismaClient as unknown as PrismaMock;

const twitch = twurpleHelixService as unknown as {
  getStreamsByUserIds: jest.Mock;
};

const cache = cacheManager as unknown as {
  getOrSet: jest.Mock;
  getOrSetWithTags?: jest.Mock;
  delete: jest.Mock;
};

const log = logger as unknown as {
  debug: jest.Mock;
  error: jest.Mock;
  warn: jest.Mock;
};

const flushAsync = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("viewer.service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cache.getOrSetWithTags = jest.fn(
      async (_key: string, factory: () => Promise<unknown>) => factory()
    );
    cache.getOrSet.mockImplementation(async (_key: string, factory: () => Promise<unknown>) => {
      return factory();
    });
  });

  describe("recordConsent", () => {
    it("updates consent timestamp with default version", async () => {
      prisma.viewer.update.mockResolvedValue({ id: "viewer-1" });

      await recordConsent("viewer-1");

      expect(prisma.viewer.update).toHaveBeenCalledWith({
        where: { id: "viewer-1" },
        data: {
          consentedAt: expect.any(Date),
          consentVersion: 1,
        },
      });
    });
  });

  describe("getChannelStats", () => {
    it("returns mapped stats and channel info with cache tags", async () => {
      prisma.viewerChannelDailyStat.findMany.mockResolvedValue([
        {
          date: new Date("2026-01-10T00:00:00.000Z"),
          watchSeconds: 5400,
          messageCount: 12,
          emoteCount: 4,
        },
      ]);
      prisma.channel.findUnique.mockResolvedValue({
        id: "c1",
        channelName: "alpha",
        isLive: true,
        streamer: {
          displayName: "Alpha",
          avatarUrl: "https://avatar",
        },
      });

      const result = await getChannelStats(
        "viewer-1",
        "c1",
        30,
        new Date("2026-01-01T00:00:00.000Z"),
        new Date("2026-01-31T00:00:00.000Z")
      );

      expect(cache.getOrSetWithTags).toHaveBeenCalledTimes(1);
      // 日期填補：01-01 到 01-31 共 31 天
      expect(result.dailyStats).toHaveLength(31);
      // 有資料的那天應該正確
      const jan10 = result.dailyStats.find((d: { date: string }) => d.date === "2026-01-10");
      expect(jan10).toEqual({
        date: "2026-01-10",
        watchHours: 1.5,
        messageCount: 12,
        emoteCount: 4,
      });
      // 沒有資料的天數應該填 0
      const jan05 = result.dailyStats.find((d: { date: string }) => d.date === "2026-01-05");
      expect(jan05).toEqual({
        date: "2026-01-05",
        watchHours: 0,
        messageCount: 0,
        emoteCount: 0,
      });
      expect(result.timeRange).toEqual({
        startDate: "2026-01-01",
        endDate: "2026-01-31",
        days: 30,
      });
      expect(result.channel).toEqual({
        id: "c1",
        name: "alpha",
        displayName: "Alpha",
        avatarUrl: "https://avatar",
        isLive: true,
        totalWatchHours: 1.5,
        totalMessages: 12,
        lastWatched: "2026-01-10",
      });
    });

    it("falls back to cache getOrSet when tag API is unavailable", async () => {
      cache.getOrSetWithTags = undefined;
      prisma.viewerChannelDailyStat.findMany.mockResolvedValue([]);
      prisma.channel.findUnique.mockResolvedValue(null);

      const result = await getChannelStats("viewer-2", "c2", 7);

      expect(cache.getOrSet).toHaveBeenCalledTimes(1);
      expect(result.channel).toBeNull();
      // 即使沒有資料，日期填補也會產生 7~8 天的空記錄
      expect(result.dailyStats.length).toBeGreaterThanOrEqual(7);
      expect(result.dailyStats.every((d: { watchHours: number }) => d.watchHours === 0)).toBe(true);
    });

    it("uses default days and channel fallback fields when streamer/stats are missing", async () => {
      prisma.viewerChannelDailyStat.findMany.mockResolvedValue([]);
      prisma.channel.findUnique.mockResolvedValue({
        id: "c3",
        channelName: "plain-channel",
        isLive: false,
        streamer: null,
      });

      const result = await getChannelStats("viewer-3", "c3");

      expect(result.timeRange.days).toBe(30);
      expect(result.channel).toEqual({
        id: "c3",
        name: "plain-channel",
        displayName: "plain-channel",
        avatarUrl: "",
        isLive: false,
        totalWatchHours: 0,
        totalMessages: 0,
        lastWatched: "",
      });
    });
  });

  describe("getFollowedChannels", () => {
    it("sorts live and offline channels using all ranking tie-breakers", async () => {
      prisma.$queryRaw.mockResolvedValue([
        {
          viewerId: "viewer-sort",
          channelId: "live-msg-high",
          twitchChannelId: null,
          channelName: "c1",
          displayName: "c1",
          avatarUrl: "a1",
          category: "A",
          isLive: 1,
          viewerCount: 1,
          streamStartedAt: new Date("2026-02-05T01:00:00.000Z"),
          lastWatched: new Date("2026-02-04T00:00:00.000Z"),
          totalWatchMin: 10,
          messageCount: 30,
          isExternal: 0,
          followedAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-02-05T01:00:00.000Z"),
        },
        {
          viewerId: "viewer-sort",
          channelId: "live-start-newer",
          twitchChannelId: null,
          channelName: "c2",
          displayName: "c2",
          avatarUrl: "a2",
          category: "A",
          isLive: 1,
          viewerCount: 1,
          streamStartedAt: new Date("2026-02-05T02:00:00.000Z"),
          lastWatched: new Date("2026-02-04T00:00:00.000Z"),
          totalWatchMin: 10,
          messageCount: 20,
          isExternal: 0,
          followedAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-02-05T01:00:00.000Z"),
        },
        {
          viewerId: "viewer-sort",
          channelId: "live-start-older",
          twitchChannelId: null,
          channelName: "c3",
          displayName: "c3",
          avatarUrl: "a3",
          category: "A",
          isLive: 1,
          viewerCount: 1,
          streamStartedAt: new Date("2026-02-05T01:00:00.000Z"),
          lastWatched: new Date("2026-02-04T00:00:00.000Z"),
          totalWatchMin: 10,
          messageCount: 20,
          isExternal: 0,
          followedAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-02-05T01:00:00.000Z"),
        },
        {
          viewerId: "viewer-sort",
          channelId: "offline-last-new",
          twitchChannelId: null,
          channelName: "c4",
          displayName: "c4",
          avatarUrl: "a4",
          category: "A",
          isLive: 0,
          viewerCount: 0,
          streamStartedAt: null,
          lastWatched: new Date("2026-02-05T03:00:00.000Z"),
          totalWatchMin: 10,
          messageCount: 0,
          isExternal: 0,
          followedAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-02-05T01:00:00.000Z"),
        },
        {
          viewerId: "viewer-sort",
          channelId: "offline-last-old",
          twitchChannelId: null,
          channelName: "c5",
          displayName: "c5",
          avatarUrl: "a5",
          category: "A",
          isLive: 0,
          viewerCount: 0,
          streamStartedAt: null,
          lastWatched: new Date("2026-02-01T03:00:00.000Z"),
          totalWatchMin: 10,
          messageCount: 0,
          isExternal: 0,
          followedAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-02-05T01:00:00.000Z"),
        },
        {
          viewerId: "viewer-sort",
          channelId: "offline-no-last-follow-new",
          twitchChannelId: null,
          channelName: "c6",
          displayName: "z-name",
          avatarUrl: "a6",
          category: "A",
          isLive: 0,
          viewerCount: 0,
          streamStartedAt: null,
          lastWatched: null,
          totalWatchMin: 10,
          messageCount: 0,
          isExternal: 0,
          followedAt: new Date("2026-01-02T00:00:00.000Z"),
          updatedAt: new Date("2026-02-05T01:00:00.000Z"),
        },
        {
          viewerId: "viewer-sort",
          channelId: "offline-no-last-follow-old",
          twitchChannelId: null,
          channelName: "c7",
          displayName: "a-name",
          avatarUrl: "a7",
          category: "A",
          isLive: 0,
          viewerCount: 0,
          streamStartedAt: null,
          lastWatched: null,
          totalWatchMin: 10,
          messageCount: 0,
          isExternal: 0,
          followedAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-02-05T01:00:00.000Z"),
        },
      ]);
      prisma.$executeRaw.mockResolvedValue(1);

      const result = await getFollowedChannels("viewer-sort");
      await flushAsync();

      expect(result.map((c) => c.id)).toEqual([
        "live-msg-high",
        "live-start-newer",
        "live-start-older",
        "offline-last-new",
        "offline-last-old",
        "offline-no-last-follow-new",
        "offline-no-last-follow-old",
      ]);
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it("uses summary rows and keeps local live rows when Twitch returns empty", async () => {
      prisma.$queryRaw.mockResolvedValue([
        {
          viewerId: "viewer-1",
          channelId: "c-live",
          twitchChannelId: "tw-live",
          channelName: "live",
          displayName: "Live",
          avatarUrl: "a",
          category: "Gaming",
          isLive: 1,
          viewerCount: 99,
          streamStartedAt: new Date("2026-02-01T01:00:00.000Z"),
          lastWatched: new Date("2026-02-01T00:00:00.000Z"),
          totalWatchMin: 50,
          messageCount: 10,
          isExternal: 0,
          followedAt: new Date("2025-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-02-01T01:00:00.000Z"),
        },
      ]);
      twitch.getStreamsByUserIds.mockResolvedValue([]);
      prisma.$executeRaw.mockResolvedValue(1);

      const result = await getFollowedChannels("viewer-1");
      await Promise.resolve();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: "c-live",
        isLive: true,
        viewerCount: 99,
      });
      expect(log.warn).toHaveBeenCalledWith(
        "ViewerService",
        "Skip live-status reconciliation due to empty Twitch stream response while local rows contain live channels"
      );
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it("returns summary rows when Twitch live reconciliation throws", async () => {
      prisma.$queryRaw.mockResolvedValue([
        {
          viewerId: "viewer-reconcile-err",
          channelId: "c-live",
          twitchChannelId: "tw-live",
          channelName: "live",
          displayName: "Live",
          avatarUrl: "a",
          category: "Gaming",
          isLive: 1,
          viewerCount: 99,
          streamStartedAt: new Date("2026-02-01T01:00:00.000Z"),
          lastWatched: new Date("2026-02-01T00:00:00.000Z"),
          totalWatchMin: 50,
          messageCount: 10,
          isExternal: 0,
          followedAt: new Date("2025-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-02-01T01:00:00.000Z"),
        },
      ]);
      twitch.getStreamsByUserIds.mockRejectedValueOnce(new Error("twitch down"));
      prisma.$executeRaw.mockResolvedValue(1);

      const result = await getFollowedChannels("viewer-reconcile-err");
      await flushAsync();

      expect(result[0]).toMatchObject({
        id: "c-live",
        isLive: true,
        viewerCount: 99,
      });
      expect(log.warn).toHaveBeenCalledWith(
        "ViewerService",
        "Failed to reconcile followed channel live status",
        expect.any(Error)
      );
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it("reconciles changed live status and refreshes summary rows", async () => {
      prisma.$queryRaw.mockResolvedValue([
        {
          viewerId: "viewer-1",
          channelId: "c1",
          twitchChannelId: "tw1",
          channelName: "chan1",
          displayName: "Chan1",
          avatarUrl: "a",
          category: "Old",
          isLive: 0,
          viewerCount: 0,
          streamStartedAt: null,
          lastWatched: new Date("2026-02-02T00:00:00.000Z"),
          totalWatchMin: 5,
          messageCount: 1,
          isExternal: 0,
          followedAt: new Date("2025-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-02-02T01:00:00.000Z"),
        },
      ]);
      twitch.getStreamsByUserIds.mockResolvedValue([
        {
          userId: "tw1",
          viewerCount: 123,
          startedAt: new Date("2026-02-03T05:00:00.000Z"),
          gameName: "Valorant",
        },
      ]);
      prisma.$executeRaw.mockResolvedValue(1);

      const result = await getFollowedChannels("viewer-1");
      await Promise.resolve();

      expect(result[0]).toMatchObject({
        id: "c1",
        isLive: true,
        viewerCount: 123,
        category: "Valorant",
      });
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
    });

    it("falls back to source query and persists summary when summary rows are empty", async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: "c2",
            channelName: "source-channel",
            isLive: 1,
            hasActiveSession: 0,
            currentViewerCount: 456,
            currentStreamStartedAt: new Date("2026-02-01T02:00:00.000Z"),
            currentGameName: "Chess",
            source: "external",
            displayName: null,
            avatarUrl: null,
            totalWatchTimeMinutes: 40,
            totalMessages: null,
            lastWatchedAt: null,
            followedAt: new Date("2025-01-02T00:00:00.000Z"),
          },
        ]);
      prisma.viewerChannelSummary.findMany.mockResolvedValue([]);
      prisma.$executeRaw.mockResolvedValue(1);

      const result = await getFollowedChannels("viewer-2");

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: "c2",
        displayName: "source-channel",
        isExternal: true,
        messageCount: 0,
      });
      expect(prisma.viewerChannelSummary.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { viewerId: "viewer-2" } })
      );
      expect(prisma.$executeRaw).toHaveBeenCalled();
    });

    it("logs and rethrows on source query failure", async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([])
        .mockRejectedValueOnce(new Error("source query failed"));

      await expect(getFollowedChannels("viewer-err")).rejects.toThrow("source query failed");
      expect(log.error).toHaveBeenCalledWith(
        "ViewerService",
        "getFollowedChannels failed",
        expect.any(Error)
      );
    });

    it("falls back when summary query errors and persists deletes/inserts/updates", async () => {
      prisma.$queryRaw
        .mockRejectedValueOnce(new Error("no summary table"))
        .mockResolvedValueOnce([
          {
            id: "same",
            channelName: "same-name",
            isLive: 0,
            hasActiveSession: 0,
            currentViewerCount: 10,
            currentStreamStartedAt: "invalid-date",
            currentGameName: null,
            source: "internal",
            displayName: "same-display",
            avatarUrl: "same-avatar",
            totalWatchTimeMinutes: 5,
            totalMessages: 2,
            lastWatchedAt: new Date("2026-02-01T00:00:00.000Z"),
            followedAt: new Date("2026-01-01T00:00:00.000Z"),
          },
          {
            id: "upd",
            channelName: "upd-name",
            isLive: 1,
            hasActiveSession: 0,
            currentViewerCount: 20,
            currentStreamStartedAt: new Date("2026-02-03T00:00:00.000Z"),
            currentGameName: "Chess",
            source: "external",
            displayName: "upd-display",
            avatarUrl: "upd-avatar",
            totalWatchTimeMinutes: 50,
            totalMessages: 99,
            lastWatchedAt: new Date("2026-02-03T00:00:00.000Z"),
            followedAt: "also-invalid-date",
          },
          {
            id: "ins",
            channelName: "ins-name",
            isLive: 0,
            hasActiveSession: 1,
            currentViewerCount: 30,
            currentStreamStartedAt: null,
            currentGameName: "Shooter",
            source: "internal",
            displayName: null,
            avatarUrl: null,
            totalWatchTimeMinutes: 20,
            totalMessages: 7,
            lastWatchedAt: null,
            followedAt: null,
          },
        ]);
      prisma.viewerChannelSummary.findMany.mockResolvedValue([
        {
          channelId: "same",
          channelName: "same-name",
          displayName: "same-display",
          avatarUrl: "same-avatar",
          category: "Just Chatting",
          isLive: false,
          viewerCount: 10,
          streamStartedAt: null,
          lastWatched: new Date("2026-02-01T00:00:00.000Z"),
          totalWatchMin: 5,
          messageCount: 2,
          isExternal: false,
          followedAt: new Date("2026-01-01T00:00:00.000Z"),
        },
        {
          channelId: "upd",
          channelName: "upd-name",
          displayName: "upd-display",
          avatarUrl: "upd-avatar",
          category: "Old",
          isLive: false,
          viewerCount: 0,
          streamStartedAt: null,
          lastWatched: null,
          totalWatchMin: 1,
          messageCount: 1,
          isExternal: false,
          followedAt: null,
        },
        {
          channelId: "del",
          channelName: "del-name",
          displayName: "del-display",
          avatarUrl: "del-avatar",
          category: "Old",
          isLive: false,
          viewerCount: 0,
          streamStartedAt: null,
          lastWatched: null,
          totalWatchMin: 1,
          messageCount: 1,
          isExternal: false,
          followedAt: null,
        },
      ]);
      prisma.$executeRaw.mockResolvedValue(1);

      const result = await getFollowedChannels("viewer-persist");

      expect(result).toHaveLength(3);
      expect(log.debug).toHaveBeenCalledWith(
        "ViewerService",
        "viewer_channel_summary table not ready, fallback to source queries",
        expect.any(Error)
      );
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(3);
    });

    it("applies deep sort tie-breakers for live and offline channels", async () => {
      prisma.$queryRaw.mockResolvedValue([
        {
          viewerId: "viewer-sort-deep",
          channelId: "live-follow-new",
          twitchChannelId: null,
          channelName: "lfn",
          displayName: "SameLive",
          avatarUrl: "a1",
          category: null,
          isLive: 1,
          viewerCount: 10,
          streamStartedAt: null,
          lastWatched: null,
          totalWatchMin: 1,
          messageCount: 1,
          isExternal: 0,
          followedAt: new Date("2026-02-03T00:00:00.000Z"),
          updatedAt: new Date("2026-02-03T00:00:00.000Z"),
        },
        {
          viewerId: "viewer-sort-deep",
          channelId: "live-follow-old",
          twitchChannelId: null,
          channelName: "lfo",
          displayName: "SameLive",
          avatarUrl: "a2",
          category: null,
          isLive: 1,
          viewerCount: 10,
          streamStartedAt: null,
          lastWatched: null,
          totalWatchMin: 1,
          messageCount: 1,
          isExternal: 0,
          followedAt: new Date("2026-02-02T00:00:00.000Z"),
          updatedAt: new Date("2026-02-03T00:00:00.000Z"),
        },
        {
          viewerId: "viewer-sort-deep",
          channelId: "live-id-a",
          twitchChannelId: null,
          channelName: "lia",
          displayName: "SameLive",
          avatarUrl: "a3",
          category: null,
          isLive: 1,
          viewerCount: 10,
          streamStartedAt: null,
          lastWatched: null,
          totalWatchMin: 1,
          messageCount: 1,
          isExternal: 0,
          followedAt: new Date("2026-02-01T00:00:00.000Z"),
          updatedAt: new Date("2026-02-03T00:00:00.000Z"),
        },
        {
          viewerId: "viewer-sort-deep",
          channelId: "live-id-b",
          twitchChannelId: null,
          channelName: "lib",
          displayName: "SameLive",
          avatarUrl: "a4",
          category: null,
          isLive: 1,
          viewerCount: 10,
          streamStartedAt: null,
          lastWatched: null,
          totalWatchMin: 1,
          messageCount: 1,
          isExternal: 0,
          followedAt: new Date("2026-02-01T00:00:00.000Z"),
          updatedAt: new Date("2026-02-03T00:00:00.000Z"),
        },
        {
          viewerId: "viewer-sort-deep",
          channelId: "off-last",
          twitchChannelId: null,
          channelName: "ol",
          displayName: "OffHasLast",
          avatarUrl: "a5",
          category: null,
          isLive: 0,
          viewerCount: 0,
          streamStartedAt: null,
          lastWatched: new Date("2026-02-10T00:00:00.000Z"),
          totalWatchMin: 1,
          messageCount: 0,
          isExternal: 0,
          followedAt: null,
          updatedAt: new Date("2026-02-03T00:00:00.000Z"),
        },
        {
          viewerId: "viewer-sort-deep",
          channelId: "off-no-last-a",
          twitchChannelId: null,
          channelName: "onla",
          displayName: "A-off",
          avatarUrl: "a6",
          category: null,
          isLive: 0,
          viewerCount: 0,
          streamStartedAt: null,
          lastWatched: null,
          totalWatchMin: 1,
          messageCount: 0,
          isExternal: 0,
          followedAt: null,
          updatedAt: new Date("2026-02-03T00:00:00.000Z"),
        },
        {
          viewerId: "viewer-sort-deep",
          channelId: "off-no-last-b",
          twitchChannelId: null,
          channelName: "onlb",
          displayName: "A-off",
          avatarUrl: "a7",
          category: null,
          isLive: 0,
          viewerCount: 0,
          streamStartedAt: null,
          lastWatched: null,
          totalWatchMin: 1,
          messageCount: 0,
          isExternal: 0,
          followedAt: null,
          updatedAt: new Date("2026-02-03T00:00:00.000Z"),
        },
      ]);
      prisma.$executeRaw.mockResolvedValue(1);

      const result = await getFollowedChannels("viewer-sort-deep");
      await flushAsync();

      expect(result.map((channel) => channel.id)).toEqual([
        "live-follow-new",
        "live-follow-old",
        "live-id-a",
        "live-id-b",
        "off-last",
        "off-no-last-a",
        "off-no-last-b",
      ]);
      expect(result[0].category).toBe("Just Chatting");
    });

    it("reconciles mixed Twitch IDs without writing unchanged snapshots", async () => {
      prisma.$queryRaw.mockResolvedValue([
        {
          viewerId: "viewer-mixed-live",
          channelId: "c-live",
          twitchChannelId: "tw-live",
          channelName: "live",
          displayName: "Live",
          avatarUrl: "a",
          category: "Old",
          isLive: 1,
          viewerCount: 100,
          streamStartedAt: new Date("2026-02-01T01:00:00.000Z"),
          lastWatched: null,
          totalWatchMin: 2,
          messageCount: 1,
          isExternal: 0,
          followedAt: "",
          updatedAt: new Date("2026-02-01T01:00:00.000Z"),
        },
        {
          viewerId: "viewer-mixed-live",
          channelId: "c-local",
          twitchChannelId: null,
          channelName: "local",
          displayName: "Local",
          avatarUrl: "a2",
          category: null,
          isLive: 0,
          viewerCount: null,
          streamStartedAt: null,
          lastWatched: null,
          totalWatchMin: 2,
          messageCount: 1,
          isExternal: 0,
          followedAt: null,
          updatedAt: new Date("2026-02-01T01:00:00.000Z"),
        },
      ]);
      twitch.getStreamsByUserIds.mockResolvedValue([
        {
          userId: "tw-live",
          viewerCount: 100,
          startedAt: new Date("2026-02-01T01:00:00.000Z"),
          gameName: "",
        },
      ]);
      prisma.$executeRaw.mockResolvedValue(1);

      const result = await getFollowedChannels("viewer-mixed-live");
      await flushAsync();

      expect(result).toHaveLength(2);
      expect(result.find((channel) => channel.id === "c-live")?.category).toBe("Just Chatting");
      expect(result.find((channel) => channel.id === "c-local")?.isLive).toBe(false);
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it("sorts by displayName when followedAt values are tied", async () => {
      prisma.$queryRaw.mockResolvedValue([
        {
          viewerId: "viewer-display-tie",
          channelId: "live-z",
          twitchChannelId: null,
          channelName: "lz",
          displayName: "Z-live",
          avatarUrl: "a1",
          category: "A",
          isLive: 1,
          viewerCount: 10,
          streamStartedAt: null,
          lastWatched: null,
          totalWatchMin: 1,
          messageCount: 5,
          isExternal: 0,
          followedAt: new Date("2026-02-01T00:00:00.000Z"),
          updatedAt: new Date("2026-02-01T00:00:00.000Z"),
        },
        {
          viewerId: "viewer-display-tie",
          channelId: "live-a",
          twitchChannelId: null,
          channelName: "la",
          displayName: "A-live",
          avatarUrl: "a2",
          category: "A",
          isLive: 1,
          viewerCount: 10,
          streamStartedAt: null,
          lastWatched: null,
          totalWatchMin: 1,
          messageCount: 5,
          isExternal: 0,
          followedAt: new Date("2026-02-01T00:00:00.000Z"),
          updatedAt: new Date("2026-02-01T00:00:00.000Z"),
        },
        {
          viewerId: "viewer-display-tie",
          channelId: "off-z",
          twitchChannelId: null,
          channelName: "oz",
          displayName: "Z-off",
          avatarUrl: "a3",
          category: "A",
          isLive: 0,
          viewerCount: 0,
          streamStartedAt: null,
          lastWatched: null,
          totalWatchMin: 1,
          messageCount: 0,
          isExternal: 0,
          followedAt: null,
          updatedAt: new Date("2026-02-01T00:00:00.000Z"),
        },
        {
          viewerId: "viewer-display-tie",
          channelId: "off-a",
          twitchChannelId: null,
          channelName: "oa",
          displayName: "A-off",
          avatarUrl: "a4",
          category: "A",
          isLive: 0,
          viewerCount: 0,
          streamStartedAt: null,
          lastWatched: null,
          totalWatchMin: 1,
          messageCount: 0,
          isExternal: 0,
          followedAt: null,
          updatedAt: new Date("2026-02-01T00:00:00.000Z"),
        },
      ]);
      prisma.$executeRaw.mockResolvedValue(1);

      const result = await getFollowedChannels("viewer-display-tie");
      await flushAsync();

      expect(result.map((channel) => channel.id)).toEqual(["live-a", "live-z", "off-a", "off-z"]);
    });

    it("sorts live channels by followedAt when stream start is tied", async () => {
      prisma.$queryRaw.mockResolvedValue([
        {
          viewerId: "viewer-live-followed",
          channelId: "live-new-follow",
          twitchChannelId: null,
          channelName: "lnf",
          displayName: "Same",
          avatarUrl: "a1",
          category: "A",
          isLive: 1,
          viewerCount: 1,
          streamStartedAt: null,
          lastWatched: null,
          totalWatchMin: 1,
          messageCount: 1,
          isExternal: 0,
          followedAt: new Date("2026-02-02T00:00:00.000Z"),
          updatedAt: new Date("2026-02-02T00:00:00.000Z"),
        },
        {
          viewerId: "viewer-live-followed",
          channelId: "live-old-follow",
          twitchChannelId: null,
          channelName: "lof",
          displayName: "Same",
          avatarUrl: "a2",
          category: "A",
          isLive: 1,
          viewerCount: 1,
          streamStartedAt: null,
          lastWatched: null,
          totalWatchMin: 1,
          messageCount: 1,
          isExternal: 0,
          followedAt: new Date("2026-02-01T00:00:00.000Z"),
          updatedAt: new Date("2026-02-02T00:00:00.000Z"),
        },
      ]);
      prisma.$executeRaw.mockResolvedValue(1);

      const result = await getFollowedChannels("viewer-live-followed");
      await flushAsync();

      expect(result.map((channel) => channel.id)).toEqual(["live-new-follow", "live-old-follow"]);
    });

    it("handles live followedAt tie-breaker when one side is missing followedAt", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([
        {
          viewerId: "viewer-live-null-followed-a",
          channelId: "live-followed",
          twitchChannelId: null,
          channelName: "lf",
          displayName: "Same",
          avatarUrl: "a1",
          category: "A",
          isLive: 1,
          viewerCount: 1,
          streamStartedAt: null,
          lastWatched: null,
          totalWatchMin: 1,
          messageCount: 1,
          isExternal: 0,
          followedAt: new Date("2026-02-02T00:00:00.000Z"),
          updatedAt: new Date("2026-02-02T00:00:00.000Z"),
        },
        {
          viewerId: "viewer-live-null-followed-a",
          channelId: "live-no-followed",
          twitchChannelId: null,
          channelName: "lnf",
          displayName: "Same",
          avatarUrl: "a2",
          category: "A",
          isLive: 1,
          viewerCount: 1,
          streamStartedAt: null,
          lastWatched: null,
          totalWatchMin: 1,
          messageCount: 1,
          isExternal: 0,
          followedAt: null,
          updatedAt: new Date("2026-02-02T00:00:00.000Z"),
        },
      ]);
      prisma.$queryRaw.mockResolvedValueOnce([
        {
          viewerId: "viewer-live-null-followed-b",
          channelId: "live-no-followed",
          twitchChannelId: null,
          channelName: "lnf",
          displayName: "Same",
          avatarUrl: "a2",
          category: "A",
          isLive: 1,
          viewerCount: 1,
          streamStartedAt: null,
          lastWatched: null,
          totalWatchMin: 1,
          messageCount: 1,
          isExternal: 0,
          followedAt: null,
          updatedAt: new Date("2026-02-02T00:00:00.000Z"),
        },
        {
          viewerId: "viewer-live-null-followed-b",
          channelId: "live-followed",
          twitchChannelId: null,
          channelName: "lf",
          displayName: "Same",
          avatarUrl: "a1",
          category: "A",
          isLive: 1,
          viewerCount: 1,
          streamStartedAt: null,
          lastWatched: null,
          totalWatchMin: 1,
          messageCount: 1,
          isExternal: 0,
          followedAt: new Date("2026-02-02T00:00:00.000Z"),
          updatedAt: new Date("2026-02-02T00:00:00.000Z"),
        },
      ]);
      prisma.$executeRaw.mockResolvedValue(1);

      const resultA = await getFollowedChannels("viewer-live-null-followed-a");
      const resultB = await getFollowedChannels("viewer-live-null-followed-b");

      expect(resultA.map((channel) => channel.id)).toEqual(["live-followed", "live-no-followed"]);
      expect(resultB.map((channel) => channel.id)).toEqual(["live-followed", "live-no-followed"]);
    });

    it("sorts offline channels with lastWatched before null lastWatched", async () => {
      prisma.$queryRaw.mockResolvedValue([
        {
          viewerId: "viewer-offline-last",
          channelId: "off-null-last",
          twitchChannelId: null,
          channelName: "onl",
          displayName: "off-null-last",
          avatarUrl: "a1",
          category: "A",
          isLive: 0,
          viewerCount: 0,
          streamStartedAt: null,
          lastWatched: null,
          totalWatchMin: 1,
          messageCount: 0,
          isExternal: 0,
          followedAt: null,
          updatedAt: new Date("2026-02-02T00:00:00.000Z"),
        },
        {
          viewerId: "viewer-offline-last",
          channelId: "off-has-last",
          twitchChannelId: null,
          channelName: "ohl",
          displayName: "off-has-last",
          avatarUrl: "a2",
          category: "A",
          isLive: 0,
          viewerCount: 0,
          streamStartedAt: null,
          lastWatched: new Date("2026-02-03T00:00:00.000Z"),
          totalWatchMin: 1,
          messageCount: 0,
          isExternal: 0,
          followedAt: null,
          updatedAt: new Date("2026-02-02T00:00:00.000Z"),
        },
      ]);
      prisma.$executeRaw.mockResolvedValue(1);

      const result = await getFollowedChannels("viewer-offline-last");
      await flushAsync();

      expect(result.map((channel) => channel.id)).toEqual(["off-has-last", "off-null-last"]);
    });

    it("swallows persist summary write failures and still returns computed channels", async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: "persist-only",
            channelName: "persist-only",
            isLive: 0,
            hasActiveSession: 0,
            currentViewerCount: 1,
            currentStreamStartedAt: null,
            currentGameName: null,
            source: "internal",
            displayName: "persist-only",
            avatarUrl: "avatar",
            totalWatchTimeMinutes: 10,
            totalMessages: 1,
            lastWatchedAt: null,
            followedAt: null,
          },
        ]);
      prisma.viewerChannelSummary.findMany.mockRejectedValueOnce(new Error("persist unavailable"));

      const result = await getFollowedChannels("viewer-persist-error");

      expect(result).toHaveLength(1);
      expect(log.warn).toHaveBeenCalledWith(
        "ViewerService",
        "Failed to persist viewer_channel_summary",
        expect.any(Error)
      );
    });

    it("persists insert/update rows with false flags and invalid existing dates", async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: "upd-false",
            channelName: "upd-false",
            isLive: 0,
            hasActiveSession: 0,
            currentViewerCount: 10,
            currentStreamStartedAt: null,
            currentGameName: "Puzzle",
            source: "internal",
            displayName: "upd-false",
            avatarUrl: "upd-avatar",
            totalWatchTimeMinutes: 5,
            totalMessages: 1,
            lastWatchedAt: null,
            followedAt: null,
          },
          {
            id: "ins-false",
            channelName: "ins-false",
            isLive: 0,
            hasActiveSession: 0,
            currentViewerCount: null,
            currentStreamStartedAt: null,
            currentGameName: null,
            source: "internal",
            displayName: "ins-false",
            avatarUrl: "ins-avatar",
            totalWatchTimeMinutes: null,
            totalMessages: 0,
            lastWatchedAt: null,
            followedAt: null,
          },
        ]);
      prisma.viewerChannelSummary.findMany.mockResolvedValue([
        {
          channelId: "upd-false",
          channelName: "upd-false",
          displayName: "upd-false",
          avatarUrl: "upd-avatar",
          category: "Old",
          isLive: true,
          viewerCount: 999,
          streamStartedAt: "not-a-date",
          lastWatched: null,
          totalWatchMin: 1,
          messageCount: 99,
          isExternal: true,
          followedAt: null,
        },
      ]);
      prisma.$executeRaw.mockResolvedValue(1);

      const result = await getFollowedChannels("viewer-persist-false");

      expect(result).toHaveLength(2);
      expect(result.find((channel) => channel.id === "ins-false")?.viewerCount).toBeNull();
      expect(result.find((channel) => channel.id === "ins-false")?.totalWatchMinutes).toBe(0);
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
    });

    it("normalizes invalid existing summary dates without forcing writes", async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: "same-invalid-date",
            channelName: "same-invalid-date",
            isLive: 0,
            hasActiveSession: 0,
            currentViewerCount: 0,
            currentStreamStartedAt: null,
            currentGameName: "Just Chatting",
            source: "internal",
            displayName: "same-invalid-date",
            avatarUrl: "same-avatar",
            totalWatchTimeMinutes: 4,
            totalMessages: 2,
            lastWatchedAt: null,
            followedAt: null,
          },
        ]);
      prisma.viewerChannelSummary.findMany.mockResolvedValue([
        {
          channelId: "same-invalid-date",
          channelName: "same-invalid-date",
          displayName: "same-invalid-date",
          avatarUrl: "same-avatar",
          category: "Just Chatting",
          isLive: false,
          viewerCount: 0,
          streamStartedAt: "invalid-date",
          lastWatched: null,
          totalWatchMin: 4,
          messageCount: 2,
          isExternal: false,
          followedAt: null,
        },
      ]);

      const result = await getFollowedChannels("viewer-invalid-date");

      expect(result).toHaveLength(1);
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });
  });

  describe("summary sync utilities", () => {
    it("syncSummaryStatsFromLifetime swallows errors", async () => {
      prisma.$executeRaw.mockRejectedValueOnce(new Error("write error"));

      await expect(syncSummaryStatsFromLifetime("viewer-1")).resolves.toBeUndefined();
      expect(log.debug).toHaveBeenCalledWith(
        "ViewerService",
        "Failed to sync summary stats from lifetime_stats",
        expect.any(Error)
      );
    });

    it("refreshViewerChannelSummaryForChannels deduplicates and chunks updates", async () => {
      prisma.$executeRaw.mockResolvedValue(1);

      await refreshViewerChannelSummaryForChannels([
        {
          channelId: "c1",
          isLive: true,
          viewerCount: 5,
          streamStartedAt: new Date("2026-02-01T01:00:00.000Z"),
          category: "A",
        },
        {
          channelId: "c1",
          isLive: false,
          viewerCount: 0,
          streamStartedAt: null,
          category: "B",
        },
      ]);

      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it("refreshViewerChannelSummaryForChannels returns early on empty input", async () => {
      await refreshViewerChannelSummaryForChannels([]);

      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });

    it("refreshViewerChannelSummaryForChannels swallows write errors", async () => {
      prisma.$executeRaw.mockRejectedValueOnce(new Error("summary update failed"));

      await expect(
        refreshViewerChannelSummaryForChannels([
          {
            channelId: "c1",
            isLive: true,
            viewerCount: 5,
            streamStartedAt: new Date("2026-02-01T01:00:00.000Z"),
            category: "A",
          },
        ])
      ).resolves.toBeUndefined();

      expect(log.warn).toHaveBeenCalledWith(
        "ViewerService",
        "Failed to refresh channel live snapshot in summary table",
        expect.any(Error)
      );
    });
  });

  describe("refresh and warmup", () => {
    it("refreshViewerChannelSummaryForViewer rebuilds rows and clears cache", async () => {
      prisma.$queryRaw.mockResolvedValue([
        {
          id: "c1",
          channelName: "name",
          isLive: 0,
          hasActiveSession: 1,
          currentViewerCount: 1,
          currentStreamStartedAt: null,
          currentGameName: null,
          source: "internal",
          displayName: "disp",
          avatarUrl: "avatar",
          totalWatchTimeMinutes: 10,
          totalMessages: 2,
          lastWatchedAt: new Date("2026-02-01T00:00:00.000Z"),
          followedAt: null,
        },
      ]);
      prisma.viewerChannelSummary.findMany.mockResolvedValue([]);
      prisma.$executeRaw.mockResolvedValue(1);

      await refreshViewerChannelSummaryForViewer("viewer-3");

      expect(cache.delete).toHaveBeenCalledWith("viewer:viewer-3:channels_list");
      expect(prisma.$executeRaw).toHaveBeenCalled();
    });

    it("refreshViewerChannelSummaryForViewer deletes summary rows when source is empty", async () => {
      prisma.$queryRaw.mockResolvedValue([]);
      prisma.$executeRaw.mockResolvedValue(1);

      await refreshViewerChannelSummaryForViewer("viewer-empty");

      expect(prisma.viewerChannelSummary.findMany).not.toHaveBeenCalled();
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
      expect(cache.delete).toHaveBeenCalledWith("viewer:viewer-empty:channels_list");
    });

    it("warmViewerChannelsCache returns when no active viewers", async () => {
      prisma.viewerChannelLifetimeStats.findMany.mockResolvedValue([]);

      await warmViewerChannelsCache(5);

      expect(prisma.viewerChannelLifetimeStats.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 5 })
      );
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it("warmViewerChannelsCache logs rejected warmup jobs", async () => {
      prisma.viewerChannelLifetimeStats.findMany.mockResolvedValue([
        { viewerId: "v1" },
        { viewerId: "v2" },
      ]);

      const callsByViewer = new Map<string, number>();
      prisma.$queryRaw.mockImplementation(async (query: { values?: unknown[] }) => {
        const viewerId = String(query.values?.[0] ?? "");
        const count = (callsByViewer.get(viewerId) || 0) + 1;
        callsByViewer.set(viewerId, count);

        if (viewerId === "v2" && count === 2) {
          throw new Error("boom");
        }

        return [];
      });

      await warmViewerChannelsCache(2);

      expect(log.warn).toHaveBeenCalledWith(
        "ViewerService",
        expect.stringContaining("Cache warmup failed for viewer"),
        expect.any(Error)
      );
    });

    it("warmViewerChannelsCache uses default limit", async () => {
      prisma.viewerChannelLifetimeStats.findMany.mockResolvedValue([]);

      await warmViewerChannelsCache();

      expect(prisma.viewerChannelLifetimeStats.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 })
      );
    });
  });
});
