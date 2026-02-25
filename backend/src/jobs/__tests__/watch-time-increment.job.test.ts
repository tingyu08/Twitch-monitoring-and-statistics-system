import cron from "node-cron";
import { prisma } from "../../db/prisma";
import { cacheManager } from "../../utils/cache-manager";
import { WatchTimeIncrementJob } from "../watch-time-increment.job";

jest.mock("node-cron", () => ({
  __esModule: true,
  default: {
    schedule: jest.fn(() => ({
      stop: jest.fn(),
      start: jest.fn(),
      destroy: jest.fn(),
    })),
  },
}));

jest.mock("../../db/prisma", () => ({
  prisma: {
    channel: {
      count: jest.fn(),
    },
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
  },
}));

jest.mock("../../utils/logger", () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock("../../utils/cache-manager", () => ({
  cacheManager: {
    delete: jest.fn(),
  },
}));

jest.mock("../job-error-tracker", () => ({
  captureJobError: jest.fn(),
}));

jest.mock("../job-write-guard", () => ({
  runWithWriteGuard: jest.fn(async (_jobName: string, operation: () => Promise<unknown>) =>
    operation()
  ),
}));

describe("WatchTimeIncrementJob", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("schedules only once even if start is called multiple times", () => {
    const job = new WatchTimeIncrementJob();

    job.start();
    job.start();

    expect(cron.schedule).toHaveBeenCalledTimes(1);
  });

  it("skips execution when there are no live channels", async () => {
    const job = new WatchTimeIncrementJob();
    (prisma.channel.count as jest.Mock).mockResolvedValue(0);

    await job.execute();

    expect(prisma.channel.count).toHaveBeenCalledTimes(1);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("should execute daily and lifetime upserts for active pairs", async () => {
    const job = new WatchTimeIncrementJob();

    (prisma.channel.count as jest.Mock).mockResolvedValue(1);
    // $queryRaw returns the activePairs array
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([
      { viewerId: "v1", channelId: "c1" },
    ]);
    (prisma.$executeRaw as jest.Mock).mockResolvedValue(1);

    await job.execute();

    // $executeRaw should have been called at least once (daily upsert)
    expect(prisma.$executeRaw).toHaveBeenCalled();
    // Cache must be invalidated for the viewer
    expect(cacheManager.delete).toHaveBeenCalledWith("viewer:v1:channels_list");
  });

  it("should call $executeRaw once per active pair for daily stats", async () => {
    const job = new WatchTimeIncrementJob();
    const activePairs = [
      { viewerId: "v1", channelId: "c1" },
      { viewerId: "v2", channelId: "c2" },
      { viewerId: "v3", channelId: "c3" },
    ];

    (prisma.channel.count as jest.Mock).mockResolvedValue(1);
    (prisma.$queryRaw as jest.Mock).mockResolvedValue(activePairs);
    (prisma.$executeRaw as jest.Mock).mockResolvedValue(1);

    await job.execute();

    // 3 daily upserts + 3 lifetime upserts = at least 6 calls total
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(6);
  });

  it("should invalidate cache once per unique viewerId", async () => {
    const job = new WatchTimeIncrementJob();
    // Two pairs share the same viewerId "v1"
    const activePairs = [
      { viewerId: "v1", channelId: "c1" },
      { viewerId: "v1", channelId: "c2" },
    ];

    (prisma.channel.count as jest.Mock).mockResolvedValue(1);
    (prisma.$queryRaw as jest.Mock).mockResolvedValue(activePairs);
    (prisma.$executeRaw as jest.Mock).mockResolvedValue(1);

    await job.execute();

    // cacheManager.delete should be called exactly once for the single unique viewerId
    expect(cacheManager.delete).toHaveBeenCalledTimes(1);
    expect(cacheManager.delete).toHaveBeenCalledWith("viewer:v1:channels_list");
  });

  it("should skip concurrent execution when already running", async () => {
    const job = new WatchTimeIncrementJob();

    // Make the first execute() stall so isRunning stays true
    let resolveFirstExecution!: () => void;
    const firstExecutionStall = new Promise<void>((resolve) => {
      resolveFirstExecution = resolve;
    });

    (prisma.channel.count as jest.Mock).mockImplementationOnce(async () => {
      await firstExecutionStall;
      return 0;
    });

    // Start first execution in background (it will be stuck waiting)
    const firstExecution = job.execute();

    // Second execute() should see isRunning=true and return immediately without calling channel.count again
    await job.execute();

    expect(prisma.channel.count).toHaveBeenCalledTimes(1);

    // Unblock the first execution so the test can clean up
    resolveFirstExecution();
    await firstExecution;
  });
});
