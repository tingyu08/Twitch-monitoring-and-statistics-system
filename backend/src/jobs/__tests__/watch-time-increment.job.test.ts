import cron from "node-cron";
import { prisma } from "../../db/prisma";
import { cacheManager } from "../../utils/cache-manager";
import { shouldSkipForCircuitBreaker } from "../../utils/job-circuit-breaker";
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
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
    systemSetting: {
      update: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
    },
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
    invalidateTags: jest.fn().mockResolvedValue(0),
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

jest.mock("../../utils/job-circuit-breaker", () => ({
  shouldSkipForCircuitBreaker: jest.fn().mockReturnValue(false),
  recordJobSuccess: jest.fn(),
  recordJobFailure: jest.fn(),
}));

describe("WatchTimeIncrementJob", () => {
  const txMock = {
    systemSetting: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
  };

  const prismaMock = prisma as unknown as {
    $transaction: jest.Mock;
    $queryRaw: jest.Mock;
    $executeRaw: jest.Mock;
    systemSetting: {
      update: jest.Mock;
      upsert: jest.Mock;
      delete: jest.Mock;
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();

    txMock.systemSetting.findUnique.mockResolvedValue(null);
    txMock.systemSetting.upsert.mockResolvedValue({ key: "dummy", value: "dummy" });
    txMock.systemSetting.create.mockResolvedValue({ key: "dummy", value: "started" });
    txMock.systemSetting.update.mockResolvedValue({ key: "dummy", value: "completed" });
    txMock.systemSetting.delete.mockResolvedValue({ key: "watch-time-increment:lease", value: "deleted" });
    txMock.$queryRaw.mockResolvedValue([]);
    txMock.$executeRaw.mockResolvedValue(1);
    prismaMock.$queryRaw.mockResolvedValue([]);
    prismaMock.$executeRaw.mockResolvedValue(Promise.resolve(1));
    prismaMock.systemSetting.update.mockResolvedValue(Promise.resolve({ key: "dummy", value: "completed" }));
    prismaMock.systemSetting.upsert.mockResolvedValue(Promise.resolve({ key: "dummy", value: "dummy" }));
    prismaMock.systemSetting.delete.mockResolvedValue(
      Promise.resolve({ key: "watch-time-increment:lease", value: "deleted" })
    );

    prismaMock.$transaction.mockImplementation(
      async (input: ((tx: typeof txMock) => Promise<unknown>) | Array<Promise<unknown>>) => {
        if (Array.isArray(input)) {
          return Promise.all(input);
        }

        return input(txMock);
      }
    );

    (shouldSkipForCircuitBreaker as jest.Mock).mockReturnValue(false);
  });

  it("schedules only once even if start is called multiple times", () => {
    const job = new WatchTimeIncrementJob();

    job.start();
    job.start();

    expect(cron.schedule).toHaveBeenCalledTimes(1);
  });

  it("skips execution when there are no active pairs", async () => {
    const job = new WatchTimeIncrementJob();

    await job.execute();

    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);
    const sqlArg = prismaMock.$queryRaw.mock.calls[0][0];
    const queryText = sqlArg.strings.join(" ");
    expect(queryText).toContain("INNER JOIN channels c ON c.id = vcm.channelId");
    expect(queryText).toContain("AND c.isLive = 1");
    expect(prismaMock.$executeRaw).not.toHaveBeenCalled();
  });

  it("executes daily and lifetime upserts for active pairs", async () => {
    const job = new WatchTimeIncrementJob();

    prismaMock.$queryRaw.mockResolvedValue([{ viewerId: "v1", channelId: "c1" }]);
    prismaMock.$executeRaw.mockResolvedValue(Promise.resolve(1));

    await job.execute();

    expect(prismaMock.$executeRaw).toHaveBeenCalledTimes(2);
    expect(prismaMock.systemSetting.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.systemSetting.upsert).toHaveBeenCalledTimes(1);
    expect(cacheManager.invalidateTags).toHaveBeenCalledWith(["viewer:v1"]);
  });

  it("uses short transactions and root prisma raw queries for heavy work", async () => {
    const job = new WatchTimeIncrementJob();

    prismaMock.$queryRaw.mockResolvedValue([{ viewerId: "v1", channelId: "c1" }]);

    await job.execute();

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
    expect(txMock.$queryRaw).not.toHaveBeenCalled();
    expect(txMock.$executeRaw).not.toHaveBeenCalled();
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prismaMock.$executeRaw).toHaveBeenCalledTimes(2);
  });

  it("invalidates cache once per unique viewerId", async () => {
    const job = new WatchTimeIncrementJob();
    const activePairs = [
      { viewerId: "v1", channelId: "c1" },
      { viewerId: "v1", channelId: "c2" },
    ];

    prismaMock.$queryRaw.mockResolvedValue(activePairs);

    await job.execute();

    expect(cacheManager.invalidateTags).toHaveBeenCalledTimes(1);
    expect(cacheManager.invalidateTags).toHaveBeenCalledWith(["viewer:v1"]);
  });

  it("collapses large active-pair sets into two set-based writes", async () => {
    const job = new WatchTimeIncrementJob();
    const activePairs = Array.from({ length: 1200 }, (_, i) => ({
      viewerId: `v${i}`,
      channelId: `c${i}`,
    }));

    prismaMock.$queryRaw.mockResolvedValue(activePairs);

    await job.execute();

    expect(prismaMock.$executeRaw).toHaveBeenCalledTimes(2);
  });

  it("skips concurrent execution when already running", async () => {
    const job = new WatchTimeIncrementJob();

    let resolveFirstExecution!: () => void;
    const firstExecutionStall = new Promise<void>((resolve) => {
      resolveFirstExecution = resolve;
    });

    prismaMock.$queryRaw.mockImplementationOnce(async () => {
      await firstExecutionStall;
      return [];
    });

    const firstExecution = job.execute();
    await job.execute();

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);

    resolveFirstExecution();
    await firstExecution;
  });

  it("skips duplicated interval when idempotency run key exists", async () => {
    const job = new WatchTimeIncrementJob();

    txMock.systemSetting.findUnique
      .mockResolvedValueOnce({ value: "2026-03-04T05:20:00.000Z" })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "existing-run", value: "completed" });

    await job.execute();

    expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
    expect(prismaMock.$executeRaw).not.toHaveBeenCalled();
    expect(cacheManager.invalidateTags).not.toHaveBeenCalled();
  });

  it("skips interval when a fresh started run marker already exists", async () => {
    const job = new WatchTimeIncrementJob();

    txMock.systemSetting.findUnique
      .mockResolvedValueOnce({ value: "2026-03-04T05:20:00.000Z" })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "existing-run", value: `started:${new Date().toISOString()}` });

    await job.execute();

    expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
    expect(prismaMock.$executeRaw).not.toHaveBeenCalled();
    expect(cacheManager.invalidateTags).not.toHaveBeenCalled();
  });

  it("skips a staggered overlapping run when another fresh lease is active", async () => {
    const job = new WatchTimeIncrementJob();

    txMock.systemSetting.findUnique
      .mockResolvedValueOnce({ value: "2026-03-04T05:20:00.000Z" })
      .mockResolvedValueOnce({
        id: "active-lease",
        value: `lease:${new Date().toISOString()}|2026-03-12T02:20:00.000Z`,
      })
      .mockResolvedValueOnce(null);

    await job.execute();

    expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
    expect(prismaMock.$executeRaw).not.toHaveBeenCalled();
    expect(cacheManager.invalidateTags).not.toHaveBeenCalled();
  });

  it("stops post-write side effects when heavy write transaction fails", async () => {
    const job = new WatchTimeIncrementJob();

    prismaMock.$queryRaw.mockResolvedValue([{ viewerId: "v1", channelId: "c1" }]);
    prismaMock.$executeRaw
      .mockImplementationOnce(async () => 1)
      .mockImplementationOnce(async () => {
        throw new Error("lifetime write failed");
      });

    await job.execute();

    expect(cacheManager.invalidateTags).not.toHaveBeenCalled();
  });

  it("skips execution when circuit breaker is active", async () => {
    const job = new WatchTimeIncrementJob();
    (shouldSkipForCircuitBreaker as jest.Mock).mockReturnValue(true);

    await job.execute();

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});
