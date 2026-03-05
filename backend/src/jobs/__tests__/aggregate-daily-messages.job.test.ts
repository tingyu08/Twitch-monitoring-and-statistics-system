import { aggregateDailyMessages } from "../aggregate-daily-messages.job";
import { prisma } from "../../db/prisma";
import { shouldSkipForCircuitBreaker } from "../../utils/job-circuit-breaker";

jest.mock("node-cron", () => ({
  __esModule: true,
  default: { schedule: jest.fn(() => ({ stop: jest.fn() })) },
}));

jest.mock("../../db/prisma", () => ({
  prisma: {
    systemSetting: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  },
}));

jest.mock("../../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock("../job-error-tracker", () => ({ captureJobError: jest.fn() }));
jest.mock("../../utils/job-circuit-breaker", () => ({
  shouldSkipForCircuitBreaker: jest.fn().mockReturnValue(false),
  recordJobSuccess: jest.fn(),
  recordJobFailure: jest.fn(),
}));
jest.mock("@prisma/client", () => ({
  Prisma: {
    sql: (...args: unknown[]) => args,
  },
}));

describe("aggregateDailyMessages resilience", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (shouldSkipForCircuitBreaker as jest.Mock).mockReturnValue(false);
    (prisma.systemSetting.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.$transaction as jest.Mock).mockImplementation(async (cb: (tx: any) => Promise<unknown>) =>
      cb({
        $executeRaw: jest.fn().mockResolvedValue(0),
        systemSetting: { upsert: jest.fn().mockResolvedValue({}) },
      })
    );
  });

  it("skips aggregation when circuit breaker is active", async () => {
    (shouldSkipForCircuitBreaker as jest.Mock).mockReturnValue(true);

    await aggregateDailyMessages();

    expect(prisma.systemSetting.findUnique).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
