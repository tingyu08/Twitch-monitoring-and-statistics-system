/**
 * Tests for DataRetentionJob
 * Covers: 過期訊息刪除、stream_metrics 降採樣（截止日、分批、write guard、錯誤處理）
 */

jest.mock("../../db/prisma", () => ({
  prisma: {
    $executeRaw: jest.fn(),
  },
}));

jest.mock("../../services/account-deletion.service", () => ({
  accountDeletionService: {
    executeExpiredDeletions: jest.fn(),
  },
}));

jest.mock("../../services/data-export.service", () => ({
  dataExportService: {
    cleanupExpiredExports: jest.fn(),
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

// 讓 Prisma.sql 回傳可檢查的結構，用 SQL 內容分辨是哪一個步驟的查詢
jest.mock("@prisma/client", () => ({
  Prisma: {
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
      text: strings.join("?"),
      values,
    }),
  },
}));

import { prisma } from "../../db/prisma";
import { accountDeletionService } from "../../services/account-deletion.service";
import { dataExportService } from "../../services/data-export.service";
import { logger } from "../../utils/logger";
import { runWithWriteGuard } from "../job-write-guard";
import { DataRetentionJob } from "../data-retention.job";

type FakeSql = { text: string; values: unknown[] };

const DAY_MS = 24 * 60 * 60 * 1000;

const executeRawMock = prisma.$executeRaw as unknown as jest.Mock;

function callsTouching(table: string): FakeSql[] {
  return executeRawMock.mock.calls
    .map(([query]) => query as FakeSql)
    .filter((query) => query.text.includes(table));
}

function mockExecuteRaw(downsampleResults: Array<number | Error>, messageDeleted = 0): void {
  const queue = [...downsampleResults];
  executeRawMock.mockImplementation(async (query: FakeSql) => {
    if (query.text.includes("viewer_channel_messages")) {
      return messageDeleted;
    }
    const next = queue.shift() ?? 0;
    if (next instanceof Error) {
      throw next;
    }
    return next;
  });
}

function expectDateNear(actual: unknown, expectedMs: number): void {
  expect(actual).toBeInstanceOf(Date);
  expect(Math.abs((actual as Date).getTime() - expectedMs)).toBeLessThan(60_000);
}

describe("DataRetentionJob", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (accountDeletionService.executeExpiredDeletions as jest.Mock).mockResolvedValue({
      processed: 0,
      success: 0,
      failed: 0,
    });
    (dataExportService.cleanupExpiredExports as jest.Mock).mockResolvedValue(0);
  });

  describe("過期訊息", () => {
    it("仍會刪除 90 天前的聊天室訊息", async () => {
      mockExecuteRaw([0]);

      await new DataRetentionJob().execute();

      const [messageQuery] = callsTouching("viewer_channel_messages");
      expect(messageQuery).toBeDefined();
      expectDateNear(messageQuery.values[0], Date.now() - 90 * DAY_MS);
    });
  });

  describe("stream_metrics 降採樣", () => {
    it("只處理 30 天前的資料，並以每批 2000 個小時區段執行", async () => {
      mockExecuteRaw([3]);

      await new DataRetentionJob().execute();

      const downsampleQueries = callsTouching("stream_metrics");
      expect(downsampleQueries).toHaveLength(1);
      const [query] = downsampleQueries;
      expectDateNear(query.values[0], Date.now() - 30 * DAY_MS);
      expect(query.values[1]).toBe(2000);
    });

    it("批次滿載時繼續下一批，直到某批不足一整批為止", async () => {
      mockExecuteRaw([2000, 2000, 7]);

      await new DataRetentionJob().execute();

      expect(callsTouching("stream_metrics")).toHaveLength(3);
      expect(logger.info).toHaveBeenCalledWith("DataRetention", expect.stringContaining("4007"));
    });

    it("沒有可合併的資料時只查一次", async () => {
      mockExecuteRaw([0]);

      await new DataRetentionJob().execute();

      expect(callsTouching("stream_metrics")).toHaveLength(1);
    });

    it("使用自己的 write guard key，不和訊息刪除共用", async () => {
      mockExecuteRaw([1]);

      await new DataRetentionJob().execute();

      expect(runWithWriteGuard).toHaveBeenCalledWith(
        "data-retention:downsample-stream-metrics",
        expect.any(Function)
      );
    });

    it("可用 STREAM_METRIC_RAW_RETENTION_DAYS 與 STREAM_METRIC_DOWNSAMPLE_BATCH_SIZE 調整", async () => {
      const previousDays = process.env.STREAM_METRIC_RAW_RETENTION_DAYS;
      const previousBatch = process.env.STREAM_METRIC_DOWNSAMPLE_BATCH_SIZE;
      process.env.STREAM_METRIC_RAW_RETENTION_DAYS = "7";
      process.env.STREAM_METRIC_DOWNSAMPLE_BATCH_SIZE = "50";
      try {
        // 設定值在模組載入時讀取，要重新載入；重新載入後的 mock 也是新的一份
        jest.resetModules();
        const { DataRetentionJob: IsolatedJob } = await import("../data-retention.job");
        const isolatedExecuteRaw = (await import("../../db/prisma")).prisma
          .$executeRaw as unknown as jest.Mock;
        const isolatedDeletion = (await import("../../services/account-deletion.service"))
          .accountDeletionService.executeExpiredDeletions as jest.Mock;
        const isolatedExports = (await import("../../services/data-export.service"))
          .dataExportService.cleanupExpiredExports as jest.Mock;
        isolatedDeletion.mockResolvedValue({ processed: 0, success: 0, failed: 0 });
        isolatedExports.mockResolvedValue(0);
        isolatedExecuteRaw.mockResolvedValue(0);

        await new IsolatedJob().execute();

        const [query] = isolatedExecuteRaw.mock.calls
          .map(([q]) => q as FakeSql)
          .filter((q) => q.text.includes("stream_metrics"));
        expect(query).toBeDefined();
        expectDateNear(query.values[0], Date.now() - 7 * DAY_MS);
        expect(query.values[1]).toBe(50);
      } finally {
        restoreEnv("STREAM_METRIC_RAW_RETENTION_DAYS", previousDays);
        restoreEnv("STREAM_METRIC_DOWNSAMPLE_BATCH_SIZE", previousBatch);
      }
    });

    it("降採樣失敗時記錄錯誤，且下次仍可再執行", async () => {
      mockExecuteRaw([new Error("disk full")]);
      const job = new DataRetentionJob();

      await job.execute();

      expect(logger.error).toHaveBeenCalledWith(
        "DataRetention",
        expect.any(String),
        expect.objectContaining({ message: "disk full" })
      );

      mockExecuteRaw([0]);
      await job.execute();
      expect(logger.warn).not.toHaveBeenCalledWith(
        "DataRetention",
        expect.stringContaining("跳過")
      );
    });
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
