import { prisma } from "../../db/prisma";
import { twurpleHelixService } from "../../services/twitch-helix.service";
import { SyncUserFollowsJob, triggerFollowSyncForUser } from "../sync-user-follows.job";
import { shouldSkipForCircuitBreaker } from "../../utils/job-circuit-breaker";

jest.mock("node-cron", () => ({
  __esModule: true,
  default: { schedule: jest.fn(() => ({ stop: jest.fn() })) },
}));

jest.mock("../job-error-tracker", () => ({ captureJobError: jest.fn() }));
jest.mock("../../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock("../../db/prisma", () => ({
  prisma: {
    viewer: { findUnique: jest.fn() },
    twitchToken: { findMany: jest.fn() },
    channel: { findMany: jest.fn(), updateMany: jest.fn(), count: jest.fn() },
    userFollow: { findMany: jest.fn(), deleteMany: jest.fn() },
    streamer: { findMany: jest.fn() },
    $executeRaw: jest.fn(),
    $transaction: jest.fn(async (cb: (tx: any) => Promise<unknown>) => cb({
      $executeRaw: jest.fn(),
      streamer: { findMany: jest.fn().mockResolvedValue([]) },
      channel: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn() },
    })),
  },
}));
jest.mock("../../services/twitch-helix.service", () => ({
  twurpleHelixService: {
    getFollowedChannels: jest.fn().mockResolvedValue([]),
    iterateFollowedChannels: jest.fn(async function* () {}),
    getUsersByIds: jest.fn().mockResolvedValue([]),
  },
}));
jest.mock("../../utils/crypto.utils", () => ({ decryptToken: jest.fn((v: string) => v) }));
jest.mock("../../utils/cache-manager", () => ({ cacheManager: { delete: jest.fn() } }));
jest.mock("../../utils/db-retry", () => ({ retryDatabaseOperation: jest.fn((fn: () => unknown) => fn()) }));
jest.mock("../../utils/redis-client", () => ({
  isRedisEnabled: jest.fn().mockReturnValue(false),
  redisGetJson: jest.fn(),
  redisSetJson: jest.fn(),
}));
jest.mock("../../modules/viewer/viewer.service", () => ({
  refreshViewerChannelSummaryForViewer: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../../utils/job-circuit-breaker", () => ({
  shouldSkipForCircuitBreaker: jest.fn().mockReturnValue(false),
  recordJobSuccess: jest.fn(),
  recordJobFailure: jest.fn(),
}));

describe("SyncUserFollowsJob resilience", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (shouldSkipForCircuitBreaker as jest.Mock).mockReturnValue(false);
    (prisma.viewer.findUnique as jest.Mock).mockResolvedValue({ twitchUserId: "twitch-viewer-1" });
    (prisma.userFollow.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.streamer.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.$executeRaw as jest.Mock).mockResolvedValue(1);
    (twurpleHelixService.iterateFollowedChannels as jest.Mock).mockImplementation(async function* () {});
  });

  it("returns zero result when circuit breaker is active", async () => {
    const job = new SyncUserFollowsJob();
    (shouldSkipForCircuitBreaker as jest.Mock).mockReturnValue(true);

    const result = await job.execute();

    expect(result).toEqual({
      usersProcessed: 0,
      channelsCreated: 0,
      followsCreated: 0,
      followsRemoved: 0,
      channelsDeactivated: 0,
      usersFailed: 0,
      totalMonitoredChannels: 0,
      executionTimeMs: 0,
    });
  });

  it("soft-fails and returns result object when critical DB read throws", async () => {
    const job = new SyncUserFollowsJob();
    (job as unknown as { getUsersWithFollowScope: () => Promise<unknown> }).getUsersWithFollowScope =
      jest.fn().mockRejectedValue(new Error("db timeout"));

    const result = await job.execute();

    expect(result.usersFailed).toBeGreaterThan(0);
    expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
  });

  it("chunks large follow lookups and flushes follow upserts incrementally on login sync", async () => {
    const follows = Array.from({ length: 450 }, (_, i) => ({
      broadcasterId: `b${i}`,
      broadcasterLogin: `login${i}`,
      broadcasterName: `Login ${i}`,
      followedAt: new Date("2026-03-11T00:00:00.000Z"),
    }));

    (twurpleHelixService.iterateFollowedChannels as jest.Mock).mockImplementation(async function* () {
      for (const follow of follows) {
        yield follow;
      }
    });
    (prisma.channel.findMany as jest.Mock).mockImplementation(({ where }: { where: { twitchChannelId: { in: string[] } } }) =>
      Promise.resolve(
        where.twitchChannelId.in.map((id) => ({
          id: `channel-${id}`,
          twitchChannelId: id,
          isMonitored: true,
          streamerId: `streamer-${id}`,
        }))
      )
    );

    await triggerFollowSyncForUser("viewer-1", "access-token");

    expect(prisma.channel.findMany).toHaveBeenCalledTimes(3);
    expect(prisma.streamer.findMany).toHaveBeenCalledTimes(3);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(5);
  });
});
