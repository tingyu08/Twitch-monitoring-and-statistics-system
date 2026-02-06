import { getFollowedChannels } from "../viewer.service";

jest.mock("../../../db/prisma", () => ({
  prisma: {
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
    prisma.viewerChannelLifetimeStats.findMany.mockResolvedValue([
      {
        channelId: "ch_with",
        totalWatchTimeMinutes: 10,
        totalMessages: 2,
        lastWatchedAt: new Date("2026-01-20T00:00:00Z"),
      },
      {
        channelId: "ch_none",
        totalWatchTimeMinutes: 0,
        totalMessages: 0,
        lastWatchedAt: null,
      },
    ]);

    prisma.userFollow.findMany.mockResolvedValue([
      { channelId: "ch_with", followedAt: new Date("2025-01-01T00:00:00Z") },
      { channelId: "ch_none", followedAt: new Date("2025-01-02T00:00:00Z") },
    ]);

    prisma.channel.findMany.mockResolvedValue([
      {
        id: "ch_none",
        channelName: "NoWatch",
        isLive: true,
        currentViewerCount: 123,
        currentStreamStartedAt: new Date("2026-01-28T00:00:00Z"),
        currentGameName: "Just Chatting",
        streamer: { displayName: "NoWatch", avatarUrl: "http://example.com/nowatch.png" },
        source: "internal",
      },
      {
        id: "ch_with",
        channelName: "HasWatch",
        isLive: true,
        currentViewerCount: 456,
        currentStreamStartedAt: new Date("2026-01-28T00:00:00Z"),
        currentGameName: "Just Chatting",
        streamer: { displayName: "HasWatch", avatarUrl: "http://example.com/haswatch.png" },
        source: "internal",
      },
    ]);

    prisma.streamSession.findMany.mockResolvedValue([]);

    const result = await getFollowedChannels("viewer_1");

    expect(result.map((ch) => ch.id)).toEqual(["ch_with", "ch_none"]);
  });
});
