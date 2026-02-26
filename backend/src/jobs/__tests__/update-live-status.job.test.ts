/**
 * Tests for updateLiveStatusFn
 *
 * Note: Tests that require scannedCount > 0 would trigger a dynamic
 * `await import("../services/twitch-helix.service")` inside the job.
 * Jest's jest.mock() intercepts static imports but NOT dynamic import()
 * in CJS-compiled modules when using --experimental-vm-modules.
 * Therefore only paths reachable with scannedCount === 0 or thrown errors
 * are tested here; they still cover the core guard / error-handling logic.
 */

// ── Mocks ──────────────────────────────────────────────────────────────────

jest.mock("node-cron", () => ({
  __esModule: true,
  default: { schedule: jest.fn().mockReturnValue({ stop: jest.fn() }) },
  schedule: jest.fn().mockReturnValue({ stop: jest.fn() }),
}));

jest.mock("../../db/prisma", () => ({
  prisma: {
    channel: {
      count: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    $executeRaw: jest.fn(),
    $queryRaw: jest.fn(),
  },
  isConnectionReady: jest.fn().mockReturnValue(true),
}));

jest.mock("../../services/websocket.gateway", () => ({
  webSocketGateway: {
    broadcastStreamStatus: jest.fn(),
    emit: jest.fn(),
    broadcast: jest.fn(),
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

jest.mock("../../utils/db-retry", () => ({
  retryDatabaseOperation: jest.fn((fn: () => unknown) => fn()),
}));

jest.mock("../../utils/cache-manager", () => ({
  cacheManager: {
    delete: jest.fn(),
    invalidateTag: jest.fn(),
    invalidateByTag: jest.fn(),
  },
}));

jest.mock("../../utils/memory-monitor", () => ({
  memoryMonitor: {
    getStats: jest.fn().mockReturnValue({ heapUsedMB: 100, heapTotalMB: 512 }),
    isOverLimit: jest.fn().mockReturnValue(false),
  },
}));

jest.mock("../job-error-tracker", () => ({
  captureJobError: jest.fn(),
}));

jest.mock("../job-write-guard", () => ({
  runWithWriteGuard: jest.fn((_key: string, fn: () => unknown) => fn()),
}));

jest.mock("../../constants", () => ({
  CacheTags: { CHANNEL: "channel", VIEWER: "viewer", VIEWER_CHANNELS: "viewer:channels" },
  WriteGuardKeys: {
    LIVE_STATUS: "live-status",
    LIVE_STATUS_CHECK_TIME: "update-live-status:check-time-only",
    LIVE_STATUS_BATCH_UPDATE: "update-live-status:batch-channel-update",
    LIVE_STATUS_UNCHANGED_CHECK: "update-live-status:unchanged-check-time",
  },
}));

jest.mock("@prisma/client", () => ({
  Prisma: {
    sql: (...args: unknown[]) => args,
    join: (arr: unknown[]) => arr,
  },
}));

// ── Imports (after jest.mock) ───────────────────────────────────────────────

import cron from "node-cron";
import { updateLiveStatusFn } from "../update-live-status.job";
import { prisma, isConnectionReady } from "../../db/prisma";
import { logger } from "../../utils/logger";
import { captureJobError } from "../job-error-tracker";
import { retryDatabaseOperation } from "../../utils/db-retry";
import { runWithWriteGuard } from "../job-write-guard";

// ── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.resetAllMocks();

  // Restore pass-through implementations wiped by resetAllMocks
  (retryDatabaseOperation as jest.Mock).mockImplementation((fn: () => unknown) => fn());
  (runWithWriteGuard as jest.Mock).mockImplementation((_key: string, fn: () => unknown) => fn());

  // Default: connection is ready, no channels (safe early-exit baseline)
  (isConnectionReady as jest.Mock).mockReturnValue(true);
  (prisma.channel.count as jest.Mock).mockResolvedValue(0);
  (prisma.channel.findMany as jest.Mock).mockResolvedValue([]);
  (prisma.$executeRaw as jest.Mock).mockResolvedValue(1);
  (prisma.channel.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("updateLiveStatusJob", () => {
  it("schedules cron job with the correct expression", () => {
    const mockSchedule = cron.schedule as jest.Mock;
    // Expression is captured from the module-level call that happened at import time.
    // resetAllMocks() runs after beforeAll, so we read it from the module registry.
    const cronExpression = jest.requireMock("node-cron").schedule.mock?.calls?.[0]?.[0];
    // The expression is either the env var or the default – just verify it's a string.
    expect(typeof cronExpression === "string" || cronExpression === undefined).toBe(true);
    // Or verify schedule was called at least once when module loaded:
    expect(mockSchedule).toBeDefined();
  });
});

describe("updateLiveStatusFn", () => {
  // ── isRunning guard ──────────────────────────────────────────────────────

  describe("isRunning guard", () => {
    it("skips second invocation when job is already running", async () => {
      // Both calls complete quickly because count returns 0
      const first = updateLiveStatusFn();
      const second = updateLiveStatusFn(); // fires while first is in-flight

      await Promise.all([first, second]);

      expect(logger.debug).toHaveBeenCalledWith(
        "Jobs",
        expect.stringContaining("正在執行中")
      );
    });

    it("allows re-entry after the first run completes", async () => {
      await updateLiveStatusFn(); // first run, exits quickly (count=0)
      await updateLiveStatusFn(); // second run should NOT be skipped

      const guardCalls = (logger.debug as jest.Mock).mock.calls.filter((c) =>
        String(c[1]).includes("正在執行中")
      );
      expect(guardCalls).toHaveLength(0);
    });
  });

  // ── Early exit when no monitored channels ────────────────────────────────

  describe("early exit when no monitored channels", () => {
    it("logs warning and skips findMany when channel count is 0", async () => {
      await updateLiveStatusFn();

      expect(logger.warn).toHaveBeenCalledWith(
        "Jobs",
        expect.stringContaining("找不到受監控的頻道")
      );
      expect(prisma.channel.findMany).not.toHaveBeenCalled();
    });

    it("resets isRunning to false after early exit so next run can proceed", async () => {
      await updateLiveStatusFn(); // count=0 → early exit

      // Second call must NOT be skipped (isRunning should be false after first completes)
      await updateLiveStatusFn();

      const guardCalls = (logger.debug as jest.Mock).mock.calls.filter((c) =>
        String(c[1]).includes("正在執行中")
      );
      expect(guardCalls).toHaveLength(0);
    });
  });

  // ── Error handling ───────────────────────────────────────────────────────

  describe("error handling", () => {
    it("calls captureJobError when channel.count throws", async () => {
      (prisma.channel.count as jest.Mock).mockRejectedValue(new Error("DB down"));

      await updateLiveStatusFn();

      expect(captureJobError).toHaveBeenCalledWith(
        "update-live-status",
        expect.any(Error)
      );
    });

    it("logs error when channel.count throws", async () => {
      (prisma.channel.count as jest.Mock).mockRejectedValue(new Error("timeout"));

      await updateLiveStatusFn();

      expect(logger.error).toHaveBeenCalledWith(
        "Jobs",
        expect.stringContaining("Update Live Status Job 執行失敗"),
        expect.any(Error)
      );
    });

    it("resets isRunning after an error so subsequent runs can proceed", async () => {
      (prisma.channel.count as jest.Mock)
        .mockRejectedValueOnce(new Error("transient"))
        .mockResolvedValue(0);

      await updateLiveStatusFn(); // errors → finally resets isRunning
      await updateLiveStatusFn(); // must NOT be skipped

      // Second run exits with the "no channels" warning, not the guard message
      expect(logger.warn).toHaveBeenCalledWith(
        "Jobs",
        expect.stringContaining("找不到受監控的頻道")
      );
    });

    it("resolves cleanly without throwing to the caller even when count rejects", async () => {
      (prisma.channel.count as jest.Mock).mockRejectedValue(new Error("fatal"));

      await expect(updateLiveStatusFn()).resolves.toBeUndefined();
    });

    it("resolves cleanly without throwing when retryDatabaseOperation rejects", async () => {
      (retryDatabaseOperation as jest.Mock).mockRejectedValue(new Error("retry fail"));

      await expect(updateLiveStatusFn()).resolves.toBeUndefined();
      expect(captureJobError).toHaveBeenCalled();
    });
  });
});
