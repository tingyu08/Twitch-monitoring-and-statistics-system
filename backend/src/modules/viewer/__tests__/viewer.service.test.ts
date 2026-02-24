import { getFollowedChannels } from "../viewer.service";

jest.mock("../../../db/prisma", () => ({
  prisma: {
    $queryRaw: jest.fn().mockResolvedValue([]),
    viewerChannelLifetimeStats: {
      findMany: jest.fn(),
    },
    userFollow: {
      findMany: jest.fn(),
    },
    channel: {
      findMany: jest.fn(),
    },
    streamSession: {
      findMany: jest.fn(),
    },
  },
}));

jest.mock("../../../utils/cache-manager", () => ({
  cacheManager: {
    getOrSet: jest.fn(async (_key: string, factory: () => Promise<unknown>) => factory()),
  },
  CacheTTL: {
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

const prisma = prismaClient as unknown as {
  $queryRaw: jest.Mock;
  viewerChannelLifetimeStats: { findMany: jest.Mock };
  userFollow: { findMany: jest.Mock };
  channel: { findMany: jest.Mock };
  streamSession: { findMany: jest.Mock };
};

describe("viewer.service getFollowedChannels sorting", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("prioritizes live channels with lastWatched over live channels without lastWatched", async () => {
    prisma.$queryRaw.mockImplementation(async (query: any) => {
      const sql = query.text || query.sql || query.strings?.[0] || "";
      // If the query is from fetchSummaryRows, return empty to trigger fallback
      if (sql.includes("viewer_channel_summary")) {
        return [];
      }
      
      // If it's buildFollowedChannelsFromSource, return the mock SourceRow array
      return [
        {
          id: "ch_with",
          channelName: "HasWatch",
          isLive: 1,
          hasActiveSession: 0,
          currentViewerCount: 456,
          currentStreamStartedAt: new Date("2026-01-28T00:00:00Z"),
          currentGameName: "Just Chatting",
          source: "internal",
          displayName: "HasWatch",
          avatarUrl: "http://example.com/haswatch.png",
          totalWatchTimeMinutes: 10,
          totalMessages: 2,
          lastWatchedAt: new Date("2026-01-20T00:00:00Z"),
          followedAt: new Date("2025-01-01T00:00:00Z"),
        },
        {
          id: "ch_none",
          channelName: "NoWatch",
          isLive: 1,
          hasActiveSession: 0,
          currentViewerCount: 123,
          currentStreamStartedAt: new Date("2026-01-28T00:00:00Z"),
          currentGameName: "Just Chatting",
          source: "internal",
          displayName: "NoWatch",
          avatarUrl: "http://example.com/nowatch.png",
          totalWatchTimeMinutes: 0,
          totalMessages: 0,
          lastWatchedAt: null,
          followedAt: new Date("2025-01-02T00:00:00Z"),
        },
      ];
    });

    const result = await getFollowedChannels("viewer_1");

    expect(result.map((ch) => ch.id)).toEqual(["ch_with", "ch_none"]);
  });
});
