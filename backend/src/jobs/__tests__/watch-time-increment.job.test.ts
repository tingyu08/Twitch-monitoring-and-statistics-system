import cron from "node-cron";
import { prisma } from "../../db/prisma";
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
});
