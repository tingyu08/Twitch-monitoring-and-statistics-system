/**
 * revenue-sync-queue.ts 單元測試
 *
 * 測試 MemoryRevenueSyncQueueAdapter（BullMQ 未連接時使用）
 */

jest.mock("../logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock("../redis-client", () => ({
  getBullMQConnectionOptions: jest.fn().mockReturnValue(null),
  isRedisReady: jest.fn().mockReturnValue(false),
}));

const mockRevProcess = jest.fn();
const mockRevAdd = jest.fn().mockResolvedValue("rev-job-id");
const mockRevGetStatus = jest.fn().mockReturnValue({
  queued: 2,
  processing: 1,
  total: 3,
  overflowPersisted: 0,
  overflowRecovered: 0,
});

jest.mock("../memory-queue", () => ({
  MemoryQueue: jest.fn().mockImplementation(() => ({
    process: mockRevProcess,
    add: mockRevAdd,
    getStatus: mockRevGetStatus,
  })),
}));

describe("MemoryRevenueSyncQueueAdapter", () => {
  let revenueSyncQueue: typeof import("../revenue-sync-queue")["revenueSyncQueue"];

  beforeEach(async () => {
    jest.resetModules();
    jest.mock("../logger", () => ({
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    }));
    jest.mock("../redis-client", () => ({
      getBullMQConnectionOptions: jest.fn().mockReturnValue(null),
    }));
    jest.mock("../memory-queue", () => ({
      MemoryQueue: jest.fn().mockImplementation(() => ({
        process: mockRevProcess,
        add: mockRevAdd,
        getStatus: mockRevGetStatus,
      })),
    }));
    const mod = await import("../revenue-sync-queue");
    revenueSyncQueue = mod.revenueSyncQueue;
  });

  it("process registers a processor", () => {
    const processor = jest.fn();
    revenueSyncQueue.process(processor);
    expect(mockRevProcess).toHaveBeenCalledWith(processor);
  });

  it("add returns a job id", async () => {
    const id = await revenueSyncQueue.add({ streamerId: "s1", streamerName: "TestStreamer" });
    expect(id).toBe("rev-job-id");
  });

  it("add accepts priority parameter", async () => {
    const id = await revenueSyncQueue.add({ streamerId: "s2", streamerName: "S2" }, 3);
    expect(id).toBe("rev-job-id");
  });

  it("getStatus returns queue status with overflow fields", async () => {
    const status = await revenueSyncQueue.getStatus();
    expect(status.queued).toBe(2);
    expect(status.processing).toBe(1);
    expect(status.total).toBe(3);
    expect(status).toHaveProperty("overflowPersisted");
    expect(status).toHaveProperty("overflowRecovered");
  });

  it("getDiagnostics returns status with empty failedJobs", async () => {
    const diag = await revenueSyncQueue.getDiagnostics();
    expect(diag.status.queued).toBe(2);
    expect(diag.failedJobs).toEqual([]);
  });

  it("shutdown resolves without error", async () => {
    await expect(revenueSyncQueue.shutdown()).resolves.toBeUndefined();
  });
});
