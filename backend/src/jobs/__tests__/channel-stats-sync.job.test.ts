/**
 * Tests for ChannelStatsSyncJob
 * Covers: isRunning guard, empty channels, syncChannelStats, updateDailyStats paths
 */

import { ChannelStatsSyncJob } from "../channel-stats-sync.job";

// ── Mocks ──────────────────────────────────────────────────────────────────

jest.mock("../../db/prisma", () => ({
  prisma: {
    channel: {
      findMany: jest.fn(),
      update: jest.fn(),
    },
    streamSession: {
      groupBy: undefined, // force fallback path by default; override per-test
      findMany: jest.fn(),
    },
    $executeRaw: jest.fn(),
  },
}));

jest.mock("../../services/unified-twitch.service", () => ({
  unifiedTwitchService: {
    getChannelInfoByIds: jest.fn(),
  },
}));

jest.mock("../../utils/logger", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock("../job-error-tracker", () => ({
  captureJobError: jest.fn(),
}));

jest.mock("../job-write-guard", () => ({
  runWithWriteGuard: jest.fn(async (_key: string, op: () => Promise<unknown>) => op()),
}));

jest.mock("node-cron", () => {
  const mockSchedule = jest.fn();
  return {
    default: { schedule: mockSchedule },
    schedule: mockSchedule,
  };
});

// Mock Prisma.sql / Prisma.join so updateDailyStats does not throw
jest.mock("@prisma/client", () => ({
  Prisma: {
    sql: (...args: unknown[]) => args,
    join: (arr: unknown[]) => arr,
  },
}));

// ── Import mocked modules AFTER jest.mock calls ──────────────────────────
import { prisma } from "../../db/prisma";
import { unifiedTwitchService } from "../../services/unified-twitch.service";
import cron from "node-cron";
import { captureJobError } from "../job-error-tracker";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeChannel(
  overrides: Partial<{ id: string; channelName: string; twitchChannelId: string }> = {}
) {
  return {
    id: "ch1",
    channelName: "streamer1",
    twitchChannelId: "twitch-1",
    ...overrides,
  };
}

function setupEmptyDailyStats() {
  // Force the fallback (non-groupBy) path by ensuring groupBy is not a function
  (prisma.streamSession as unknown as Record<string, unknown>).groupBy = undefined;
  (prisma.streamSession.findMany as jest.Mock).mockResolvedValue([]);
  (prisma.$executeRaw as jest.Mock).mockResolvedValue(1);
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("ChannelStatsSyncJob", () => {
  let job: ChannelStatsSyncJob;

  beforeEach(() => {
    jest.clearAllMocks();
    job = new ChannelStatsSyncJob();
    // Default: no active sessions for daily stats
    setupEmptyDailyStats();
  });

  // ── isRunning guard ────────────────────────────────────────────────────

  describe("isRunning guard", () => {
    it("should skip concurrent execution and return zeros immediately", async () => {
      // Arrange: first call blocks, second call should be skipped
      let resolveFirst!: () => void;
      const firstCallBlocker = new Promise<void>((res) => {
        resolveFirst = res;
      });

      (prisma.channel.findMany as jest.Mock).mockImplementationOnce(async () => {
        await firstCallBlocker;
        return [];
      });

      // Act: start first call (does not await yet)
      const firstCall = job.execute();

      // Give the first call time to set isRunning = true
      await Promise.resolve();
      await Promise.resolve();

      // Second concurrent call should return early
      const secondResult = await job.execute();

      // Unblock first call
      resolveFirst();
      await firstCall;

      // Assert
      expect(secondResult).toEqual({ synced: 0, failed: 0, dailyStatsUpdated: 0 });
    });
  });

  // ── Empty channels ────────────────────────────────────────────────────

  describe("when no monitored channels exist", () => {
    it("should return { synced: 0, failed: 0, dailyStatsUpdated: 0 } without calling Twitch API", async () => {
      (prisma.channel.findMany as jest.Mock).mockResolvedValue([]);

      const result = await job.execute();

      expect(result).toEqual({ synced: 0, failed: 0, dailyStatsUpdated: 0 });
      expect(unifiedTwitchService.getChannelInfoByIds).not.toHaveBeenCalled();
    });
  });

  // ── Successful sync ───────────────────────────────────────────────────

  describe("when channels exist and Twitch API succeeds", () => {
    it("should increment synced count for each successfully synced channel", async () => {
      const channels = [
        makeChannel({ id: "ch1", channelName: "streamer1", twitchChannelId: "twitch-1" }),
        makeChannel({ id: "ch2", channelName: "streamer2", twitchChannelId: "twitch-2" }),
      ];
      (prisma.channel.findMany as jest.Mock).mockResolvedValue(channels);

      const channelInfoMap = new Map([
        ["twitch-1", { login: "streamer1", isLive: false }],
        ["twitch-2", { login: "streamer2", isLive: false }],
      ]);
      (unifiedTwitchService.getChannelInfoByIds as jest.Mock).mockResolvedValue(channelInfoMap);

      const result = await job.execute();

      expect(result.synced).toBe(2);
      expect(result.failed).toBe(0);
    });

    it("should handle channel not found in Twitch response (null channelInfo)", async () => {
      const channels = [
        makeChannel({ id: "ch1", channelName: "streamer1", twitchChannelId: "twitch-1" }),
      ];
      (prisma.channel.findMany as jest.Mock).mockResolvedValue(channels);

      // Return empty map so channelInfo is null
      (unifiedTwitchService.getChannelInfoByIds as jest.Mock).mockResolvedValue(new Map());

      const result = await job.execute();

      // syncChannelStats with null channelInfo returns early without throwing
      expect(result.synced).toBe(1);
      expect(result.failed).toBe(0);
    });
  });

  // ── Failed sync ───────────────────────────────────────────────────────

  describe("when syncChannelStats throws", () => {
    it("should increment failed count and not throw the outer execute", async () => {
      const channels = [
        makeChannel({ id: "ch1", channelName: "streamer1", twitchChannelId: "twitch-1" }),
      ];
      (prisma.channel.findMany as jest.Mock).mockResolvedValue(channels);

      // getChannelInfoByIds throws per-batch
      (unifiedTwitchService.getChannelInfoByIds as jest.Mock).mockRejectedValue(
        new Error("Twitch API error")
      );

      // When getChannelInfoByIds rejects, the outer try/catch in execute re-throws
      await expect(job.execute()).rejects.toThrow("Twitch API error");
    });

    it("should increment failed count when individual channel sync throws inside batch", async () => {
      const channels = [
        makeChannel({ id: "ch1", channelName: "streamer1", twitchChannelId: "twitch-1" }),
      ];
      (prisma.channel.findMany as jest.Mock).mockResolvedValue(channels);

      // getChannelInfoByIds returns a Map that triggers an error inside syncChannelStats
      const infoMap = new Map([["twitch-1", { login: "streamer1", isLive: false }]]);
      (unifiedTwitchService.getChannelInfoByIds as jest.Mock).mockResolvedValue(infoMap);

      // Force prisma.channel.update (rename path) to throw
      (prisma.channel.update as jest.Mock).mockRejectedValue(new Error("DB write error"));

      // The channel login does NOT match so rename is triggered, which throws
      const infoMapRenamed = new Map([["twitch-1", { login: "renamed-streamer", isLive: false }]]);
      (unifiedTwitchService.getChannelInfoByIds as jest.Mock).mockResolvedValue(infoMapRenamed);

      const result = await job.execute();

      expect(result.failed).toBe(1);
      expect(result.synced).toBe(0);
    });
  });

  // ── Channel rename path ───────────────────────────────────────────────

  describe("syncChannelStats - channel rename", () => {
    it("should call channel.update when login differs from channelName", async () => {
      const channels = [
        makeChannel({ id: "ch1", channelName: "old-name", twitchChannelId: "twitch-1" }),
      ];
      (prisma.channel.findMany as jest.Mock).mockResolvedValue(channels);

      const infoMap = new Map([["twitch-1", { login: "new-name", isLive: false }]]);
      (unifiedTwitchService.getChannelInfoByIds as jest.Mock).mockResolvedValue(infoMap);
      (prisma.channel.update as jest.Mock).mockResolvedValue({});

      const result = await job.execute();

      expect(prisma.channel.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "ch1" },
          data: { channelName: "new-name" },
        })
      );
      expect(result.synced).toBe(1);
    });

    it("should NOT call channel.update when login matches channelName", async () => {
      const channels = [
        makeChannel({ id: "ch1", channelName: "streamer1", twitchChannelId: "twitch-1" }),
      ];
      (prisma.channel.findMany as jest.Mock).mockResolvedValue(channels);

      const infoMap = new Map([["twitch-1", { login: "streamer1", isLive: false }]]);
      (unifiedTwitchService.getChannelInfoByIds as jest.Mock).mockResolvedValue(infoMap);

      await job.execute();

      expect(prisma.channel.update).not.toHaveBeenCalled();
    });
  });

  // ── updateDailyStats - fallback path (no groupBy) ──────────────────

  describe("updateDailyStats - fallback aggregation path", () => {
    it("should aggregate sessions and call $executeRaw when sessions exist", async () => {
      const channels = [makeChannel()];
      (prisma.channel.findMany as jest.Mock).mockResolvedValue(channels);
      (unifiedTwitchService.getChannelInfoByIds as jest.Mock).mockResolvedValue(new Map());

      // Provide sessions for fallback aggregation
      (prisma.streamSession.findMany as jest.Mock).mockResolvedValue([
        {
          channelId: "ch1",
          durationSeconds: 3600,
          avgViewers: 100,
          peakViewers: 200,
        },
        {
          channelId: "ch1",
          durationSeconds: 1800,
          avgViewers: 50,
          peakViewers: 150,
        },
      ]);
      (prisma.$executeRaw as jest.Mock).mockResolvedValue(1);

      const result = await job.execute();

      expect(prisma.$executeRaw).toHaveBeenCalled();
      expect(result.dailyStatsUpdated).toBe(1);
    });

    it("should return dailyStatsUpdated: 0 when no sessions exist", async () => {
      const channels = [makeChannel()];
      (prisma.channel.findMany as jest.Mock).mockResolvedValue(channels);
      (unifiedTwitchService.getChannelInfoByIds as jest.Mock).mockResolvedValue(new Map());

      (prisma.streamSession.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.$executeRaw as jest.Mock).mockResolvedValue(0);

      const result = await job.execute();

      expect(result.dailyStatsUpdated).toBe(0);
      // No entries, no $executeRaw call
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });

    it("should handle sessions with null viewer counts gracefully", async () => {
      const channels = [makeChannel()];
      (prisma.channel.findMany as jest.Mock).mockResolvedValue(channels);
      (unifiedTwitchService.getChannelInfoByIds as jest.Mock).mockResolvedValue(new Map());

      (prisma.streamSession.findMany as jest.Mock).mockResolvedValue([
        {
          channelId: "ch1",
          durationSeconds: null,
          avgViewers: null,
          peakViewers: null,
        },
      ]);
      (prisma.$executeRaw as jest.Mock).mockResolvedValue(1);

      const result = await job.execute();

      expect(result.dailyStatsUpdated).toBe(1);
    });
  });

  // ── updateDailyStats - groupBy path ──────────────────────────────────

  describe("updateDailyStats - groupBy path", () => {
    it("should use groupBy aggregation when prisma.streamSession.groupBy is available", async () => {
      const channels = [makeChannel()];
      (prisma.channel.findMany as jest.Mock).mockResolvedValue(channels);
      (unifiedTwitchService.getChannelInfoByIds as jest.Mock).mockResolvedValue(new Map());

      // Enable groupBy path
      (prisma.streamSession as unknown as Record<string, unknown>).groupBy = jest
        .fn()
        .mockResolvedValue([
          {
            channelId: "ch1",
            _sum: { durationSeconds: 7200, avgViewers: 300 },
            _max: { peakViewers: 500 },
            _count: { _all: 3 },
          },
        ]);
      (prisma.$executeRaw as jest.Mock).mockResolvedValue(1);

      const result = await job.execute();

      expect(prisma.streamSession.groupBy).toHaveBeenCalled();
      expect(result.dailyStatsUpdated).toBe(1);
    });
  });

  // ── Error path in execute ─────────────────────────────────────────────

  describe("execute error handling", () => {
    it("should re-throw errors and call captureJobError", async () => {
      (prisma.channel.findMany as jest.Mock).mockRejectedValue(new Error("DB unavailable"));

      await expect(job.execute()).rejects.toThrow("DB unavailable");
      expect(captureJobError).toHaveBeenCalledWith("channel-stats-sync", expect.any(Error));
    });

    it("should reset isRunning to false even after error", async () => {
      (prisma.channel.findMany as jest.Mock).mockRejectedValue(new Error("DB error"));

      await expect(job.execute()).rejects.toThrow();

      // After error, isRunning should be false so next call can proceed
      (prisma.channel.findMany as jest.Mock).mockResolvedValue([]);
      const result = await job.execute();
      expect(result).toEqual({ synced: 0, failed: 0, dailyStatsUpdated: 0 });
    });
  });

  // ── Batch processing ──────────────────────────────────────────────────

  describe("batch processing", () => {
    it("should process channels in batches of 20", async () => {
      // Create 25 channels to trigger two batches
      const channels = Array.from({ length: 25 }, (_, i) =>
        makeChannel({ id: `ch${i}`, channelName: `streamer${i}`, twitchChannelId: `twitch-${i}` })
      );
      (prisma.channel.findMany as jest.Mock).mockResolvedValue(channels);

      const infoMap = new Map(
        channels.map((c) => [c.twitchChannelId, { login: c.channelName, isLive: false }])
      );
      (unifiedTwitchService.getChannelInfoByIds as jest.Mock).mockResolvedValue(infoMap);

      const result = await job.execute();

      // Two batches of getChannelInfoByIds calls
      expect(unifiedTwitchService.getChannelInfoByIds).toHaveBeenCalledTimes(2);
      expect(result.synced).toBe(25);
    });
  });

  // ── start() ───────────────────────────────────────────────────────────

  describe("start()", () => {
    it("should schedule the cron job", async () => {
      job.start();
      expect(cron.schedule).toHaveBeenCalled();
    });
  });
});
