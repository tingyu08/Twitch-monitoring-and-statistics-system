import { SyncUserFollowsJob } from "../../jobs/sync-user-follows.job";
import { prisma } from "../../db/prisma";
import { twurpleHelixService } from "../../services/twitch-helix.service";
import { logger } from "../../utils/logger";

// Mock dependencies
const mockPrismaTransaction = {
  streamer: { upsert: jest.fn() },
  channel: { create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  userFollow: { createMany: jest.fn(), deleteMany: jest.fn() },
};

jest.mock("../../services/twitch-helix.service", () => ({
  twurpleHelixService: {
    getFollowedChannels: jest.fn(),
  },
}));

jest.mock("../../db/prisma", () => ({
  prisma: {
    twitchToken: {
      findMany: jest.fn(),
    },
    channel: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    userFollow: {
      findMany: jest.fn(),
      create: jest.fn(),
      createMany: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    streamer: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
    },
    $transaction: jest.fn((callback) => callback(mockPrismaTransaction)),
  },
}));

jest.mock("../../utils/crypto.utils", () => ({
  decryptToken: jest.fn((token) => token),
  encryptToken: jest.fn((token) => token),
}));

jest.mock("../../utils/logger", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// Type assertion for mocked prisma (prefixed with _ to avoid unused var warning)
const _mockPrisma = prisma as any;

describe("Story 3.6: Sync User Follows Job", () => {
  let job: SyncUserFollowsJob;

  beforeEach(() => {
    jest.clearAllMocks();
    job = new SyncUserFollowsJob();
    (job as any).isRunning = false;
  });

  describe("execute()", () => {
    it("should skip if already running", async () => {
      (job as any).isRunning = true;

      const result = await job.execute();

      expect(result.usersProcessed).toBe(0);
      expect(prisma.twitchToken.findMany).not.toHaveBeenCalled();
    });

    it("should process users with user:read:follows scope", async () => {
      // Mock: 1 streamer with follows scope
      (prisma.twitchToken.findMany as jest.Mock)
        .mockResolvedValueOnce([
          {
            streamerId: "s1",
            streamer: { twitchUserId: "twitch123" },
            accessToken: "token123",
          },
        ])
        .mockResolvedValueOnce([]); // No viewers

      // Mock: Twitch returns 2 followed channels
      (twurpleHelixService.getFollowedChannels as jest.Mock).mockResolvedValue([
        {
          broadcasterId: "ext1",
          broadcasterLogin: "external_streamer_1",
          broadcasterName: "External Streamer 1",
          followedAt: new Date(),
        },
        {
          broadcasterId: "ext2",
          broadcasterLogin: "external_streamer_2",
          broadcasterName: "External Streamer 2",
          followedAt: new Date(),
        },
      ]);

      // Mock: No existing follows in DB
      (prisma.userFollow.findMany as jest.Mock).mockResolvedValue([]);

      // Mock: Channels/Streamers don't exist yet (for batch fetching)
      (prisma.channel.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.streamer.findMany as jest.Mock).mockResolvedValue([]);

      // Mock: Upsert Streamer (Transaction) - Dynamic return
      (mockPrismaTransaction.streamer.upsert as jest.Mock).mockImplementation((args) => Promise.resolve({
        id: `s_${args.where.twitchUserId}`,
        twitchUserId: args.where.twitchUserId,
      }));

      // Mock: Channel creation (Transaction)
      (mockPrismaTransaction.channel.create as jest.Mock).mockImplementation((args) => Promise.resolve({
        ...args.data,
        id: `ch_${args.data.twitchChannelId}`,
      }));

      // Mock: UserFollow creation (createMany)
      (prisma.userFollow.createMany as jest.Mock).mockResolvedValue({ count: 2 });

      const result = await job.execute();

      // Debugging failure
      if (result.usersProcessed === 0) {
        console.log("Logger Error Calls:", (logger.error as jest.Mock).mock.calls);
      }

      expect(result.usersProcessed).toBe(1);
      expect(result.channelsCreated).toBe(2);
      expect(result.followsCreated).toBe(2);
      expect(mockPrismaTransaction.channel.create).toHaveBeenCalledTimes(2);
    });

    it("should not create duplicate channels when already exists", async () => {
      (prisma.twitchToken.findMany as jest.Mock)
        .mockResolvedValueOnce([
          {
            streamerId: "s1",
            streamer: { twitchUserId: "twitch123" },
            accessToken: "token123",
          },
        ])
        .mockResolvedValueOnce([]);

      (twurpleHelixService.getFollowedChannels as jest.Mock).mockResolvedValue([
        {
          broadcasterId: "ext1",
          broadcasterLogin: "existing_channel",
          broadcasterName: "Existing Channel",
          followedAt: new Date(),
        },
      ]);

      (prisma.userFollow.findMany as jest.Mock).mockResolvedValue([]);

      // Channel already exists (Batch Fetch)
      (prisma.channel.findMany as jest.Mock).mockResolvedValue([{
        id: "existing-ch1",
        twitchChannelId: "ext1",
        channelName: "existing_channel",
        source: "external",
        isMonitored: true,
      }]);
      
      // Streamer exists
      (prisma.streamer.findMany as jest.Mock).mockResolvedValue([{
        id: "s_ext1",
        twitchUserId: "ext1"
      }]);

      const result = await job.execute();

      expect(result.channelsCreated).toBe(0);
      expect(result.followsCreated).toBe(1);
      expect(mockPrismaTransaction.channel.create).not.toHaveBeenCalled();
    });

    it("should remove unfollowed channel relationships", async () => {
      (prisma.twitchToken.findMany as jest.Mock)
        .mockResolvedValueOnce([
          {
            streamerId: "s1",
            streamer: { twitchUserId: "twitch123" },
            accessToken: "token123",
          },
        ])
        .mockResolvedValueOnce([]);

      // User no longer follows any channels
      (twurpleHelixService.getFollowedChannels as jest.Mock).mockResolvedValue([]);

      // But has existing follow in DB
      (prisma.userFollow.findMany as jest.Mock).mockResolvedValue([
        {
          id: "uf1",
          userId: "s1",
          channelId: "ch1",
          channel: { twitchChannelId: "old-channel" },
        },
      ]);

      (prisma.channel.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.streamer.findMany as jest.Mock).mockResolvedValue([]);

      // Mock deleteMany
      (prisma.userFollow.deleteMany as jest.Mock).mockResolvedValue({ count: 1 });

      const result = await job.execute();

      expect(result.followsRemoved).toBe(1);
      expect(prisma.userFollow.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ["uf1"] } },
      });
    });

    it("should deactivate orphaned external channels", async () => {
      (prisma.twitchToken.findMany as jest.Mock)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      // Orphaned external channel exists
      (prisma.channel.findMany as jest.Mock).mockResolvedValue([
        {
          id: "orphan-ch1",
          twitchChannelId: "orphan1",
          source: "external",
          isMonitored: true,
        },
      ]);

      (prisma.channel.update as jest.Mock).mockResolvedValue({});

      const result = await job.execute();

      expect(result.channelsDeactivated).toBe(1);
      expect(prisma.channel.update).toHaveBeenCalledWith({
        where: { id: "orphan-ch1" },
        data: { isMonitored: false },
      });
    });

    it("should re-enable monitoring for inactive channel when followed again", async () => {
      (prisma.twitchToken.findMany as jest.Mock)
        .mockResolvedValueOnce([
          {
            streamerId: "s1",
            streamer: { twitchUserId: "twitch123" },
            accessToken: "token123",
          },
        ])
        .mockResolvedValueOnce([]);

      (twurpleHelixService.getFollowedChannels as jest.Mock).mockResolvedValue([
        {
          broadcasterId: "inactive-ch",
          broadcasterLogin: "reactivated_channel",
          broadcasterName: "Reactivated Channel",
          followedAt: new Date(),
        },
      ]);

      (prisma.userFollow.findMany as jest.Mock).mockResolvedValue([]);

      // Channel exists but is inactive (Batch Fetch)
      (prisma.channel.findMany as jest.Mock).mockResolvedValue([{
        id: "inactive-ch1",
        twitchChannelId: "inactive-ch",
        isMonitored: false,
        source: "external",
      }]);
      
      (prisma.streamer.findMany as jest.Mock).mockResolvedValue([{
        id: "s_inactive",
        twitchUserId: "inactive-ch"
      }]);

      (mockPrismaTransaction.channel.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      (prisma.userFollow.createMany as jest.Mock).mockResolvedValue({ count: 1 });

      const result = await job.execute();

      expect(mockPrismaTransaction.channel.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ["inactive-ch1"] } },
        data: { isMonitored: true },
      });
      expect(result.followsCreated).toBe(1);
    });
  });

  describe("Edge Cases", () => {
    it("should handle Twitch API errors gracefully", async () => {
      (prisma.twitchToken.findMany as jest.Mock)
        .mockResolvedValueOnce([
          {
            streamerId: "s1",
            streamer: { twitchUserId: "twitch123" },
            accessToken: "token123",
          },
        ])
        .mockResolvedValueOnce([]);

      (twurpleHelixService.getFollowedChannels as jest.Mock).mockRejectedValue(
        new Error("Twitch API Error")
      );

      (prisma.channel.findMany as jest.Mock).mockResolvedValue([]);

      // Should not throw, just log error and continue
      const result = await job.execute();

      expect(result.usersProcessed).toBe(0); // Failed user not counted
    });

    it("should handle multiple users following same channel", async () => {
      // Two streamers
      (prisma.twitchToken.findMany as jest.Mock)
        .mockResolvedValueOnce([
          {
            streamerId: "s1",
            streamer: { twitchUserId: "twitch1" },
            accessToken: "token1",
          },
          {
            streamerId: "s2",
            streamer: { twitchUserId: "twitch2" },
            accessToken: "token2",
          },
        ])
        .mockResolvedValueOnce([]);

      // Both follow the same channel
      (twurpleHelixService.getFollowedChannels as jest.Mock).mockResolvedValue([
        {
          broadcasterId: "shared-ch",
          broadcasterLogin: "shared_channel",
          broadcasterName: "Shared Channel",
          followedAt: new Date(),
        },
      ]);

      (prisma.userFollow.findMany as jest.Mock).mockResolvedValue([]);

      // Batch Fetch: Channel exists
      (prisma.channel.findMany as jest.Mock).mockResolvedValue([{
        id: "shared-ch1",
        twitchChannelId: "shared-ch",
        channelName: "shared_channel",
        source: "external",
        isMonitored: true,
      }]);
      
      (prisma.streamer.findMany as jest.Mock).mockResolvedValue([{
        id: "s_shared",
        twitchUserId: "shared-ch"
      }]);

      (prisma.userFollow.createMany as jest.Mock).mockResolvedValue({ count: 1 });

      const result = await job.execute();

      expect(result.usersProcessed).toBe(2);
      expect(result.channelsCreated).toBe(0); // Already exists
      expect(result.followsCreated).toBe(2); // Both users have follow records (1 per user)
    });
  });
});