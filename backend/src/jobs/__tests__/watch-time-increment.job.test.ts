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
    },
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
  };

  const prismaMock = prisma as unknown as {
    $transaction: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();

    txMock.systemSetting.findUnique.mockResolvedValue(null);
    txMock.systemSetting.upsert.mockResolvedValue({ key: "dummy", value: "dummy" });
    txMock.systemSetting.create.mockResolvedValue({ key: "dummy", value: "started" });
    txMock.systemSetting.update.mockResolvedValue({ key: "dummy", value: "completed" });
    txMock.$queryRaw.mockResolvedValue([]);
    txMock.$executeRaw.mockResolvedValue(1);

    prismaMock.$transaction.mockImplementation(async (cb: (tx: typeof txMock) => Promise<unknown>) => {
      return cb(txMock);
    });

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

    expect(txMock.$queryRaw).toHaveBeenCalledTimes(1);
    expect(txMock.$executeRaw).not.toHaveBeenCalled();
  });

  it("executes daily and lifetime upserts for active pairs", async () => {
    const job = new WatchTimeIncrementJob();

    txMock.$queryRaw.mockResolvedValue([{ viewerId: "v1", channelId: "c1" }]);
    txMock.$executeRaw.mockResolvedValue(1);

    await job.execute();

    expect(txMock.$executeRaw).toHaveBeenCalled();
    expect(cacheManager.delete).toHaveBeenCalledWith("viewer:v1:channels_list");
  });

  it("batches active pairs into a small number of SQL writes", async () => {
    const job = new WatchTimeIncrementJob();
    const activePairs = [
      { viewerId: "v1", channelId: "c1" },
      { viewerId: "v2", channelId: "c2" },
      { viewerId: "v3", channelId: "c3" },
    ];

    txMock.$queryRaw.mockResolvedValue(activePairs);
    txMock.$executeRaw.mockResolvedValue(1);

    await job.execute();

    expect(txMock.$executeRaw).toHaveBeenCalledTimes(2);
  });

  it("invalidates cache once per unique viewerId", async () => {
    const job = new WatchTimeIncrementJob();
    const activePairs = [
      { viewerId: "v1", channelId: "c1" },
      { viewerId: "v1", channelId: "c2" },
    ];

    txMock.$queryRaw.mockResolvedValue(activePairs);
    txMock.$executeRaw.mockResolvedValue(1);

    await job.execute();

    expect(cacheManager.delete).toHaveBeenCalledTimes(1);
    expect(cacheManager.delete).toHaveBeenCalledWith("viewer:v1:channels_list");
  });

  it("splits large active pairs into multiple batch SQL writes", async () => {
    const job = new WatchTimeIncrementJob();
    const activePairs = Array.from({ length: 1200 }, (_, i) => ({
      viewerId: `v${i}`,
      channelId: `c${i}`,
    }));

    txMock.$queryRaw.mockResolvedValue(activePairs);
    txMock.$executeRaw.mockResolvedValue(1);

    await job.execute();

    expect(txMock.$executeRaw).toHaveBeenCalledTimes(4);
  });

  it("skips concurrent execution when already running", async () => {
    const job = new WatchTimeIncrementJob();

    let resolveFirstExecution!: () => void;
    const firstExecutionStall = new Promise<void>((resolve) => {
      resolveFirstExecution = resolve;
    });

    txMock.$queryRaw.mockImplementationOnce(async () => {
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
      .mockResolvedValueOnce({ id: "existing-run" });

    await job.execute();

    expect(txMock.$queryRaw).not.toHaveBeenCalled();
    expect(txMock.$executeRaw).not.toHaveBeenCalled();
    expect(cacheManager.delete).not.toHaveBeenCalled();
  });

  it("skips execution when circuit breaker is active", async () => {
    const job = new WatchTimeIncrementJob();
    (shouldSkipForCircuitBreaker as jest.Mock).mockReturnValue(true);

    await job.execute();

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});
