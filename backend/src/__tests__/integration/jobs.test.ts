import { streamStatusJob } from "../../jobs/stream-status.job";
import { channelStatsSyncJob } from "../../jobs/channel-stats-sync.job";
import { prisma } from "../../db/prisma";
import { unifiedTwitchService } from "../../services/unified-twitch.service";

jest.mock("../../services/unified-twitch.service", () => ({
  unifiedTwitchService: {
    getStreamsByUserIds: jest.fn(),
    getChannelInfo: jest.fn(),
    getChannelInfoById: jest.fn(),
    getChannelInfoByIds: jest.fn(),
  },
}));

jest.mock("../../db/prisma", () => ({
  prisma: {
    $executeRaw: jest.fn().mockResolvedValue(1),
    channel: {
      findMany: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    streamSession: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
    },
    streamMetric: {
      create: jest.fn(),
    },
    channelDailyStat: {
      upsert: jest.fn(),
    },
  },
}));

describe("Story 3.3: Jobs Integration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (channelStatsSyncJob as any).isRunning = false;
    (streamStatusJob as any).isRunning = false;
  });

  describe("StreamStatusJob", () => {
    it("should create new session when stream goes live", async () => {
      (prisma.channel.findMany as jest.Mock).mockResolvedValue([
        { id: "c1", twitchChannelId: "t1", channelName: "User" },
      ]);
      (prisma.streamSession.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.streamSession.findMany as jest.Mock).mockResolvedValue([]); // Mock active sessions
      (prisma.streamSession.upsert as jest.Mock).mockResolvedValue({ id: "s1" });
      (unifiedTwitchService.getStreamsByUserIds as jest.Mock).mockResolvedValue([
        {
          id: "s1",
          userId: "t1",
          userName: "User",
          title: "Live",
          gameName: "Game",
          viewerCount: 10,
          startedAt: new Date(),
        },
      ]);

      await streamStatusJob.execute();

      expect(prisma.streamSession.upsert).toHaveBeenCalled();
    });

    it("should update session if already live", async () => {
      (prisma.channel.findMany as jest.Mock).mockResolvedValue([
        { id: "c1", twitchChannelId: "t1", channelName: "User" },
      ]);
      (prisma.streamSession.findFirst as jest.Mock).mockResolvedValue({
        id: "s1",
        peakViewers: 10,
        avgViewers: 10,
      });
      (prisma.streamSession.findUnique as jest.Mock).mockResolvedValue({
        id: "s1",
        peakViewers: 10,
        avgViewers: 10,
      });
      (prisma.streamSession.findMany as jest.Mock).mockResolvedValue([
        { id: "s1", channelId: "c1" },
      ]); // Mock active sessions
      (prisma.streamSession.upsert as jest.Mock).mockResolvedValue({ id: "s1" });
      (unifiedTwitchService.getStreamsByUserIds as jest.Mock).mockResolvedValue([
        {
          id: "s1",
          userId: "t1",
          title: "Live",
          gameName: "Game",
          viewerCount: 20,
        },
      ]);

      await streamStatusJob.execute();

      expect(prisma.streamSession.update).toHaveBeenCalled();
    });
  });

  describe("ChannelStatsSyncJob", () => {
    it("should sync stats and update daily aggregation", async () => {
      (prisma.channel.findMany as jest.Mock).mockResolvedValue([
        { id: "c1", channelName: "User", twitchChannelId: "t1" },
      ]);
      (unifiedTwitchService.getChannelInfoByIds as jest.Mock).mockResolvedValue(
        new Map([
          [
            "t1",
            {
              login: "User",
              isLive: true,
              viewerCount: 50,
              streamTitle: "Hi",
              currentGame: "IRL",
            },
          ],
        ])
      );

      // Mock findMany specifically for updateDailyStats to ensure it returns data
      const mockSessions = [
        {
          channelId: "c1",
          durationSeconds: 3600,
          avgViewers: 50,
          peakViewers: 100,
        },
      ];

      (prisma.streamSession.findMany as jest.Mock).mockImplementation(() => {
        console.log("Mock findMany called, returning:", mockSessions);
        return Promise.resolve(mockSessions);
      });

      (prisma.channelDailyStat.upsert as jest.Mock).mockResolvedValue({});

      await channelStatsSyncJob.execute();

      expect(prisma.streamSession.update).not.toHaveBeenCalled();
      expect(prisma.streamSession.findMany).toHaveBeenCalled();
      expect(prisma.$executeRaw).toHaveBeenCalled();
    });
  });
});
