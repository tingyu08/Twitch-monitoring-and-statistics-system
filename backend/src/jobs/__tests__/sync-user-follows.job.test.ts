import { SyncUserFollowsJob } from "../sync-user-follows.job";
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
    twitchToken: { findMany: jest.fn() },
    channel: { findMany: jest.fn(), updateMany: jest.fn(), count: jest.fn() },
    userFollow: { findMany: jest.fn(), deleteMany: jest.fn() },
    streamer: { findMany: jest.fn() },
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
});
