jest.mock("../logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

describe("data-export-queue", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  describe("memory adapter", () => {
    const mockMemoryQueueProcess = jest.fn();
    const mockMemoryQueueAdd = jest.fn().mockResolvedValue("mem-job-id");
    const mockMemoryQueueGetStatus = jest.fn().mockReturnValue({
      queued: 1,
      processing: 0,
      total: 1,
    });

    beforeEach(() => {
      jest.doMock("../redis-client", () => ({
        getBullMQConnectionOptions: jest.fn().mockReturnValue(null),
      }));
      jest.doMock("../memory-queue", () => ({
        MemoryQueue: jest.fn().mockImplementation(() => ({
          process: mockMemoryQueueProcess,
          add: mockMemoryQueueAdd,
          getStatus: mockMemoryQueueGetStatus,
        })),
      }));
    });

    it("uses in-memory adapter methods", async () => {
      const { dataExportQueue } = await import("../data-export-queue");
      const processor = jest.fn();
      dataExportQueue.process(processor);
      expect(mockMemoryQueueProcess).toHaveBeenCalledWith(processor);

      await expect(dataExportQueue.add({ exportJobId: "exp-1" }, 5)).resolves.toBe("mem-job-id");
      await expect(dataExportQueue.getStatus()).resolves.toEqual({
        queued: 1,
        processing: 0,
        total: 1,
      });
      await expect(dataExportQueue.getDiagnostics()).resolves.toEqual({
        status: { queued: 1, processing: 0, total: 1 },
        failedJobs: [],
      });
      await expect(dataExportQueue.shutdown()).resolves.toBeUndefined();
    });

    it("covers internal percentile helper and memory adapter directly", async () => {
      const mod = await import("../data-export-queue");
      expect(mod.__dataExportQueueTestables.percentile([], 0.95)).toBe(0);
      expect(mod.__dataExportQueueTestables.percentile([30, 10, 20], 0.95)).toBe(30);

      const adapter = new mod.__dataExportQueueTestables.MemoryDataExportQueueAdapter();
      const processor = jest.fn();
      adapter.process(processor);
      expect(mockMemoryQueueProcess).toHaveBeenCalledWith(processor);
      await expect(adapter.add({ exportJobId: "exp-default" })).resolves.toBe("mem-job-id");
      await expect(adapter.add({ exportJobId: "exp-direct" }, 2)).resolves.toBe("mem-job-id");
    });
  });

  describe("bullmq adapter", () => {
    const mockQueueAdd = jest.fn();
    const mockQueueGetJobCounts = jest.fn();
    const mockQueueGetJobs = jest.fn();
    const mockQueueClose = jest.fn().mockResolvedValue(undefined);
    const mockWorkerOn = jest.fn();
    const mockWorkerClose = jest.fn().mockResolvedValue(undefined);
    const mockQueueCtor = jest.fn();
    const mockWorkerCtor = jest.fn();

    const setupBullModule = async () => {
      jest.doMock("../redis-client", () => ({
        getBullMQConnectionOptions: jest.fn().mockReturnValue({ host: "localhost", port: 6379 }),
      }));
      jest.doMock("bullmq", () => {
        class MockQueue {
          add = mockQueueAdd;
          getJobCounts = mockQueueGetJobCounts;
          getJobs = mockQueueGetJobs;
          close = mockQueueClose;

          constructor(...args: unknown[]) {
            mockQueueCtor(...args);
          }
        }

        class MockWorker {
          on = mockWorkerOn;
          close = mockWorkerClose;

          constructor(...args: unknown[]) {
            mockWorkerCtor(...args);
          }
        }

        return { Queue: MockQueue, Worker: MockWorker };
      });

      return import("../data-export-queue");
    };

    beforeEach(() => {
      mockQueueAdd.mockReset();
      mockQueueGetJobCounts.mockReset();
      mockQueueGetJobs.mockReset();
      mockQueueClose.mockReset().mockResolvedValue(undefined);
      mockWorkerOn.mockReset();
      mockWorkerClose.mockReset().mockResolvedValue(undefined);
      mockQueueCtor.mockReset();
      mockWorkerCtor.mockReset();
    });

    it("creates BullMQ adapter and only registers worker once", async () => {
      const { dataExportQueue } = await setupBullModule();
      const processor = jest.fn();

      dataExportQueue.process(processor);
      dataExportQueue.process(processor);

      expect(mockQueueCtor).toHaveBeenCalled();
      expect(mockWorkerCtor).toHaveBeenCalledTimes(1);
      expect(mockWorkerOn).toHaveBeenCalledWith("failed", expect.any(Function));
    });

    it("passes BullMQ worker job data into the processor", async () => {
      const { dataExportQueue } = await setupBullModule();
      const processor = jest.fn().mockResolvedValue(undefined);

      dataExportQueue.process(processor);

      const workerProcessor = mockWorkerCtor.mock.calls[0]?.[1] as
        | ((job: { data: { exportJobId: string } }) => Promise<void>)
        | undefined;

      await workerProcessor?.({ data: { exportJobId: "exp-pass-through" } });
      expect(processor).toHaveBeenCalledWith({ exportJobId: "exp-pass-through" });
    });

    it("logs failed worker events", async () => {
      const { logger } = jest.requireMock("../logger") as {
        logger: { error: jest.Mock };
      };
      const { dataExportQueue } = await setupBullModule();
      dataExportQueue.process(jest.fn());

      const failedHandler = mockWorkerOn.mock.calls.find((call) => call[0] === "failed")?.[1] as
        | ((job: { id?: string } | undefined, error: unknown) => void)
        | undefined;

      failedHandler?.({ id: "job-1" }, new Error("boom"));
      expect(logger.error).toHaveBeenCalled();
    });

    it("logs failed worker events with unknown job id", async () => {
      const { logger } = jest.requireMock("../logger") as {
        logger: { error: jest.Mock };
      };
      const { dataExportQueue } = await setupBullModule();
      dataExportQueue.process(jest.fn());

      const failedHandler = mockWorkerOn.mock.calls.find((call) => call[0] === "failed")?.[1] as
        | ((job: { id?: string } | undefined, error: unknown) => void)
        | undefined;

      failedHandler?.(undefined, new Error("boom"));
      expect(logger.error).toHaveBeenCalledWith(
        "DataExportQueue",
        "Job failed: unknown",
        expect.any(Error)
      );
    });

    it("adds a BullMQ job successfully", async () => {
      const { dataExportQueue } = await setupBullModule();
      mockQueueGetJobCounts.mockResolvedValue({
        waiting: 1,
        delayed: 1,
        active: 0,
        prioritized: 1,
        "waiting-children": 1,
      });
      mockQueueAdd.mockResolvedValue(undefined);

      const id = await dataExportQueue.add({ exportJobId: "exp-1" }, 3);
      expect(id).toContain("export-exp-1-");
      expect(mockQueueAdd).toHaveBeenCalledWith(
        expect.stringContaining("export-exp-1-"),
        { exportJobId: "exp-1" },
        { priority: 7 }
      );
    });

    it("clamps BullMQ priority to minimum 1", async () => {
      const { dataExportQueue } = await setupBullModule();
      mockQueueGetJobCounts.mockResolvedValue({});
      mockQueueAdd.mockResolvedValue(undefined);

      await dataExportQueue.add({ exportJobId: "exp-priority" }, 99);

      expect(mockQueueAdd).toHaveBeenCalledWith(
        expect.any(String),
        { exportJobId: "exp-priority" },
        { priority: 1 }
      );
    });

    it("returns null when queue backlog is too high", async () => {
      const { logger } = jest.requireMock("../logger") as {
        logger: { warn: jest.Mock };
      };
      process.env.EXPORT_QUEUE_MAX_WAITING = "2";
      const { dataExportQueue } = await setupBullModule();
      mockQueueGetJobCounts.mockResolvedValue({
        waiting: 2,
        delayed: 0,
        active: 0,
        prioritized: 0,
        "waiting-children": 0,
      });

      await expect(dataExportQueue.add({ exportJobId: "exp-2" })).resolves.toBeNull();
      expect(logger.warn).toHaveBeenCalled();
      delete process.env.EXPORT_QUEUE_MAX_WAITING;
    });

    it("returns null when enqueue throws", async () => {
      const { logger } = jest.requireMock("../logger") as {
        logger: { error: jest.Mock };
      };
      const { dataExportQueue } = await setupBullModule();
      mockQueueGetJobCounts.mockRejectedValue(new Error("counts fail"));

      await expect(dataExportQueue.add({ exportJobId: "exp-3" })).resolves.toBeNull();
      expect(logger.error).toHaveBeenCalled();
    });

    it("computes BullMQ status metrics and diagnostics", async () => {
      const { dataExportQueue } = await setupBullModule();
      const nowSpy = jest.spyOn(Date, "now").mockReturnValue(10_000);

      mockQueueGetJobCounts.mockResolvedValue({
        active: 2,
        completed: 4,
        delayed: 1,
        failed: 1,
        paused: 1,
        prioritized: 2,
        waiting: 3,
        "waiting-children": 1,
      });
      mockQueueGetJobs
        .mockResolvedValueOnce([
          { timestamp: 6_000 },
          { timestamp: 8_000 },
        ])
        .mockResolvedValueOnce([
          { processedOn: 1_000, finishedOn: 1_500 },
          { processedOn: 2_000, finishedOn: 2_900 },
          { processedOn: null, finishedOn: null },
        ])
        .mockResolvedValueOnce([
          { timestamp: 6_000 },
          { timestamp: 8_000 },
        ])
        .mockResolvedValueOnce([
          { processedOn: 1_000, finishedOn: 1_500 },
          { processedOn: 2_000, finishedOn: 2_900 },
          { processedOn: null, finishedOn: null },
        ])
        .mockResolvedValueOnce([
          {
            id: "1",
            name: "job-1",
            failedReason: "bad",
            attemptsMade: 2,
            timestamp: 123,
          },
          {
            id: "2",
            name: "job-2",
            failedReason: "",
            attemptsMade: 1,
            timestamp: 456,
          },
        ]);

      const status = await dataExportQueue.getStatus();
      expect(status).toEqual({
        queued: 8,
        processing: 2,
        total: 10,
        failed: 1,
        oldestWaitingMs: 4000,
        avgCompletedMs: 700,
        p95CompletedMs: 900,
        failedRatioPercent: 20,
      });

      const diagnostics = await dataExportQueue.getDiagnostics(2);
      expect(diagnostics.failedJobs).toEqual([
        {
          id: "1",
          name: "job-1",
          failedReason: "bad",
          attemptsMade: 2,
          timestamp: 123,
        },
        {
          id: "2",
          name: "job-2",
          failedReason: "unknown",
          attemptsMade: 1,
          timestamp: 456,
        },
      ]);

      nowSpy.mockRestore();
    });

    it("uses Date.now fallback when waiting job timestamp is missing and default diagnostics limit", async () => {
      const { dataExportQueue } = await setupBullModule();
      const nowSpy = jest.spyOn(Date, "now").mockReturnValue(10_000);

      mockQueueGetJobCounts.mockResolvedValue({
        active: 0,
        completed: 1,
        delayed: 0,
        failed: 0,
        paused: 0,
        prioritized: 0,
        waiting: 1,
        "waiting-children": 0,
      });
      mockQueueGetJobs
        .mockResolvedValueOnce([{ timestamp: 0 }])
        .mockResolvedValueOnce([{ processedOn: 100, finishedOn: 200 }])
        .mockResolvedValueOnce([{ timestamp: 0 }])
        .mockResolvedValueOnce([{ processedOn: 100, finishedOn: 200 }])
        .mockResolvedValueOnce([]);

      const diagnostics = await dataExportQueue.getDiagnostics();
      expect(diagnostics.status.oldestWaitingMs).toBe(0);
      expect(mockQueueGetJobs).toHaveBeenLastCalledWith(["failed"], 0, 19, true);
      nowSpy.mockRestore();
    });

    it("returns zeroed status metrics when no waiting or completed jobs exist", async () => {
      const { dataExportQueue } = await setupBullModule();
      mockQueueGetJobCounts.mockResolvedValue({
        active: 0,
        completed: 0,
        delayed: 0,
        failed: 0,
        paused: 0,
        prioritized: 0,
        waiting: 0,
        "waiting-children": 0,
      });
      mockQueueGetJobs.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

      await expect(dataExportQueue.getStatus()).resolves.toEqual({
        queued: 0,
        processing: 0,
        total: 0,
        failed: 0,
        oldestWaitingMs: 0,
        avgCompletedMs: 0,
        p95CompletedMs: 0,
        failedRatioPercent: 0,
      });
    });

    it("swallows shutdown close errors", async () => {
      const { dataExportQueue } = await setupBullModule();
      dataExportQueue.process(jest.fn());
      mockWorkerClose.mockRejectedValueOnce(new Error("worker close"));
      mockQueueClose.mockRejectedValueOnce(new Error("queue close"));

      await expect(dataExportQueue.shutdown()).resolves.toBeUndefined();
    });
  });
});
