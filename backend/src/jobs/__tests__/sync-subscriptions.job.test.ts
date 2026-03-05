jest.mock("node-cron", () => ({
  __esModule: true,
  default: { schedule: jest.fn((_expr: string, cb: () => Promise<void>) => ({ cb })) },
  schedule: jest.fn((_expr: string, cb: () => Promise<void>) => ({ cb })),
}));

jest.mock("../../db/prisma", () => ({
  prisma: {
    streamer: { findMany: jest.fn() },
  },
}));

jest.mock("../../modules/streamer/revenue.service", () => ({
  revenueService: {
    syncSubscriptionSnapshot: jest.fn().mockResolvedValue(undefined),
    prewarmRevenueCache: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock("../../utils/revenue-sync-queue", () => ({
  revenueSyncQueue: {
    process: jest.fn(),
    add: jest.fn().mockResolvedValue("job-1"),
    getStatus: jest.fn().mockResolvedValue({
      queued: 0,
      processing: 0,
      overflowPersisted: 0,
      overflowRecovered: 0,
    }),
  },
}));

jest.mock("../../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock("../job-error-tracker", () => ({ captureJobError: jest.fn() }));
jest.mock("../../utils/db-retry", () => ({
  retryDatabaseOperation: jest.fn((fn: () => unknown) => fn()),
}));
jest.mock("../../utils/job-circuit-breaker", () => ({
  shouldSkipForCircuitBreaker: jest.fn().mockReturnValue(false),
  recordJobSuccess: jest.fn(),
  recordJobFailure: jest.fn(),
}));

import cron from "node-cron";
import { prisma } from "../../db/prisma";
import { shouldSkipForCircuitBreaker } from "../../utils/job-circuit-breaker";

import "../sync-subscriptions.job";

describe("sync-subscriptions resilience", () => {
  const scheduleMock = cron.schedule as jest.Mock;
  const handler = scheduleMock.mock.calls[0][1] as () => Promise<void>;

  beforeEach(() => {
    jest.clearAllMocks();
    (shouldSkipForCircuitBreaker as jest.Mock).mockReturnValue(false);
    (prisma.streamer.findMany as jest.Mock).mockResolvedValue([]);
  });

  it("skips run when circuit breaker is active", async () => {
    (shouldSkipForCircuitBreaker as jest.Mock).mockReturnValue(true);

    await handler();

    expect(prisma.streamer.findMany).not.toHaveBeenCalled();
  });
});
