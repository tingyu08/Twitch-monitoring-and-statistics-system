import { prisma } from "../../../db/prisma";
import { TwitchOAuthClient } from "../../auth/twitch-oauth.client";
import type { SubscriptionTrendResponse } from "../subscription-sync.service";

// Auto-mock the client
jest.mock("../../auth/twitch-oauth.client");

jest.mock("../../../db/prisma", () => ({
  prisma: {
    channel: {
      findFirst: jest.fn(),
    },
    twitchToken: {
      findFirst: jest.fn(),
    },
    channelDailyStat: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
    },
  },
}));

describe("SubscriptionSyncService", () => {
  let syncSubscriptionSnapshot: (streamerId: string) => Promise<void>;
  let getSubscriptionTrend: (
    streamerId: string,
    range?: string
  ) => Promise<SubscriptionTrendResponse>;
  let mockGetBroadcasterSubscriptions: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    // Re-load module to ensure fresh mock usage and avoid singleton issues
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require("../subscription-sync.service");
      syncSubscriptionSnapshot = mod.syncSubscriptionSnapshot;
      getSubscriptionTrend = mod.getSubscriptionTrend;
    });

    const MockTwitchClient = TwitchOAuthClient as unknown as jest.Mock;
    if (MockTwitchClient.mock.instances.length > 0) {
      const instance = MockTwitchClient.mock.instances[MockTwitchClient.mock.instances.length - 1];
      mockGetBroadcasterSubscriptions = instance.getBroadcasterSubscriptions;
    }
  });

  describe("syncSubscriptionSnapshot", () => {
    it("should sync successfully", async () => {
      (prisma.channel.findFirst as jest.Mock).mockResolvedValue({
        id: "c1",
        twitchChannelId: "t1",
      });
      (prisma.twitchToken.findFirst as jest.Mock).mockResolvedValue({
        accessToken: "at",
      });
      (prisma.channelDailyStat.findUnique as jest.Mock).mockResolvedValue(null);

      mockGetBroadcasterSubscriptions.mockResolvedValue({ total: 100 });

      await syncSubscriptionSnapshot("s1");

      expect(mockGetBroadcasterSubscriptions).toHaveBeenCalledWith("t1", "at");
      expect(prisma.channelDailyStat.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ subsTotal: 100 }),
        })
      );
    });

    it("should calculate subsDelta from yesterday stats", async () => {
      (prisma.channel.findFirst as jest.Mock).mockResolvedValue({
        id: "c1",
        twitchChannelId: "t1",
      });
      (prisma.twitchToken.findFirst as jest.Mock).mockResolvedValue({ accessToken: "at" });
      (prisma.channelDailyStat.findUnique as jest.Mock).mockResolvedValue({ subsTotal: 95 });
      mockGetBroadcasterSubscriptions.mockResolvedValue({ total: 100 });

      await syncSubscriptionSnapshot("s1");

      expect(prisma.channelDailyStat.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ subsDelta: 5 }),
          create: expect.objectContaining({ subsDelta: 5 }),
        })
      );
    });

    it("should throw if channel not found", async () => {
      (prisma.channel.findFirst as jest.Mock).mockResolvedValue(null);
      await expect(syncSubscriptionSnapshot("s1")).rejects.toThrow("No channel found");
    });

    it("should throw if no Twitch token found (line 51)", async () => {
      (prisma.channel.findFirst as jest.Mock).mockResolvedValue({
        id: "c1",
        twitchChannelId: "t1",
      });
      (prisma.twitchToken.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(syncSubscriptionSnapshot("s1")).rejects.toThrow(
        "No Twitch token found for streamer ID: s1"
      );
    });
  });

  describe("getSubscriptionTrend", () => {
    it("should default range to 30d when omitted", async () => {
      (prisma.channel.findFirst as jest.Mock).mockResolvedValue({ id: "c1" });
      (prisma.channelDailyStat.findMany as jest.Mock).mockResolvedValue([]);

      const res = await getSubscriptionTrend("s1");

      expect(res.range).toBe("30d");
      expect(res.availableDays).toBe(0);
    });

    it("should support 7d range", async () => {
      (prisma.channel.findFirst as jest.Mock).mockResolvedValue({ id: "c1" });
      const today = new Date();
      (prisma.channelDailyStat.findMany as jest.Mock).mockResolvedValue([
        { date: today, subsTotal: 100, subsDelta: 1 },
      ]);

      const res = await getSubscriptionTrend("s1", "7d");

      expect(res.range).toBe("7d");
      expect(res.minDataDays).toBe(7);
      expect(res.currentDataDays).toBe(1);
      expect(prisma.channelDailyStat.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ channelId: "c1" }) })
      );
    });

    it("should support 90d range", async () => {
      (prisma.channel.findFirst as jest.Mock).mockResolvedValue({ id: "c1" });
      const today = new Date();
      (prisma.channelDailyStat.findMany as jest.Mock).mockResolvedValue([
        { date: today, subsTotal: 100, subsDelta: null },
        { date: today, subsTotal: 101, subsDelta: 1 },
      ]);

      const res = await getSubscriptionTrend("s1", "90d");

      expect(res.range).toBe("90d");
      expect(res.availableDays).toBe(2);
      expect(res.data[0]).toEqual(
        expect.objectContaining({ subsTotal: 100, subsDelta: null })
      );
    });

    it("should return empty if no channel", async () => {
      (prisma.channel.findFirst as jest.Mock).mockResolvedValue(null);
      const res = await getSubscriptionTrend("s1", "30d");
      expect(res.data).toHaveLength(0);
      expect(res.isEstimated).toBe(true);
    });

    it("should return aggregated data", async () => {
      (prisma.channel.findFirst as jest.Mock).mockResolvedValue({ id: "c1" });
      const today = new Date();
      (prisma.channelDailyStat.findMany as jest.Mock).mockResolvedValue([
        { date: today, subsTotal: 100, subsDelta: 5 },
      ]);

      const res = await getSubscriptionTrend("s1", "30d");
      expect(res.data).toHaveLength(1);
      expect(res.data[0].subsTotal).toBe(100);
    });
  });
});
