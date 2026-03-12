/**
 * data-export-queue.ts 單元測試
 *
 * 測試 MemoryDataExportQueueAdapter（BullMQ 未連接時使用）
 */

jest.mock("../logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// Force MemoryQueue adapter by making getBullMQConnectionOptions return null
jest.mock("../redis-client", () => ({
  getBullMQConnectionOptions: jest.fn().mockReturnValue(null),
  isRedisReady: jest.fn().mockReturnValue(false),
}));

// Mock MemoryQueue
const mockMemoryQueueProcess = jest.fn();
const mockMemoryQueueAdd = jest.fn().mockResolvedValue("mem-job-id");
const mockMemoryQueueGetStatus = jest.fn().mockReturnValue({
  queued: 1,
  processing: 0,
  total: 1,
});

jest.mock("../memory-queue", () => ({
  MemoryQueue: jest.fn().mockImplementation(() => ({
    process: mockMemoryQueueProcess,
    add: mockMemoryQueueAdd,
    getStatus: mockMemoryQueueGetStatus,
  })),
}));

describe("MemoryDataExportQueueAdapter", () => {
  let dataExportQueue: typeof import("../data-export-queue")["dataExportQueue"];

  beforeEach(async () => {
    jest.resetModules();
    jest.mock("../logger", () => ({
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    }));
    jest.mock("../redis-client", () => ({
      getBullMQConnectionOptions: jest.fn().mockReturnValue(null),
      isRedisReady: jest.fn().mockReturnValue(false),
    }));
    jest.mock("../memory-queue", () => ({
      MemoryQueue: jest.fn().mockImplementation(() => ({
        process: mockMemoryQueueProcess,
        add: mockMemoryQueueAdd,
        getStatus: mockMemoryQueueGetStatus,
      })),
    }));
    const mod = await import("../data-export-queue");
    dataExportQueue = mod.dataExportQueue;
  });

  it("process registers a processor", () => {
    const processor = jest.fn();
    dataExportQueue.process(processor);
    expect(mockMemoryQueueProcess).toHaveBeenCalledWith(processor);
  });

  it("add returns a job id", async () => {
    const id = await dataExportQueue.add({ exportJobId: "exp-1" });
    expect(id).toBe("mem-job-id");
  });

  it("add accepts priority parameter", async () => {
    const id = await dataExportQueue.add({ exportJobId: "exp-2" }, 5);
    expect(id).toBe("mem-job-id");
  });

  it("getStatus returns queue status", async () => {
    const status = await dataExportQueue.getStatus();
    expect(status.queued).toBe(1);
    expect(status.processing).toBe(0);
    expect(status.total).toBe(1);
  });

  it("getDiagnostics returns status with empty failedJobs", async () => {
    const diag = await dataExportQueue.getDiagnostics();
    expect(diag.status.queued).toBe(1);
    expect(diag.failedJobs).toEqual([]);
  });

  it("shutdown resolves without error", async () => {
    await expect(dataExportQueue.shutdown()).resolves.toBeUndefined();
  });
});

describe("percentile helper (via getStatus)", () => {
  it("handles empty array in status call without crashing", async () => {
    jest.resetModules();
    jest.mock("../logger", () => ({
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    }));
    jest.mock("../redis-client", () => ({
      getBullMQConnectionOptions: jest.fn().mockReturnValue(null),
    }));
    jest.mock("../memory-queue", () => ({
      MemoryQueue: jest.fn().mockImplementation(() => ({
        process: jest.fn(),
        add: jest.fn().mockResolvedValue(null),
        getStatus: jest.fn().mockReturnValue({ queued: 0, processing: 0, total: 0 }),
      })),
    }));

    const { dataExportQueue: q } = await import("../data-export-queue");
    const status = await q.getStatus();
    expect(status.total).toBe(0);
  });
});
