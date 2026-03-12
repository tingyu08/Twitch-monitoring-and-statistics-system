jest.mock("../logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

describe("revenue-sync-queue", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  describe("memory adapter", () => {
    const mockRevProcess = jest.fn();
    const mockRevAdd = jest.fn().mockResolvedValue("rev-job-id");
    const mockRevGetStatus = jest.fn().mockReturnValue({
      queued: 2,
      processing: 1,
      total: 3,
      overflowPersisted: 0,
      overflowRecovered: 0,
    });

    beforeEach(() => {
      jest.doMock("../redis-client", () => ({
        getBullMQConnectionOptions: jest.fn().mockReturnValue(null),
      }));
      jest.doMock("../memory-queue", () => ({
        MemoryQueue: jest.fn().mockImplementation(() => ({
          process: mockRevProcess,
          add: mockRevAdd,
          getStatus: mockRevGetStatus,
        })),
      }));
    });

    it("uses in-memory adapter methods", async () => {
      const { revenueSyncQueue } = await import("../revenue-sync-queue");
      const processor = jest.fn();
      revenueSyncQueue.process(processor);
      expect(mockRevProcess).toHaveBeenCalledWith(processor);

      await expect(
        revenueSyncQueue.add({ streamerId: "s1", streamerName: "TestStreamer" }, 3)
      ).resolves.toBe("rev-job-id");
      await expect(revenueSyncQueue.getStatus()).resolves.toEqual({
        queued: 2,
        processing: 1,
        total: 3,
        overflowPersisted: 0,
        overflowRecovered: 0,
      });
      await expect(revenueSyncQueue.getDiagnostics()).resolves.toEqual({
        status: {
          queued: 2,
          processing: 1,
          total: 3,
          overflowPersisted: 0,
          overflowRecovered: 0,
        },
        failedJobs: [],
      });
      await expect(revenueSyncQueue.shutdown()).resolves.toBeUndefined();
    });

    it("covers internal percentile helper and memory adapter directly", async () => {
      const mod = await import("../revenue-sync-queue");
      expect(mod.__revenueSyncQueueTestables.percentile([], 0.95)).toBe(0);
      expect(mod.__revenueSyncQueueTestables.percentile([30, 10, 20], 0.95)).toBe(30);

      const adapter = new mod.__revenueSyncQueueTestables.MemoryRevenueSyncQueueAdapter();
      const processor = jest.fn();
      adapter.process(processor);
      expect(mockRevProcess).toHaveBeenCalledWith(processor);
      await expect(
        adapter.add({ streamerId: "s-default", streamerName: "Default" })
      ).resolves.toBe("rev-job-id");
      await expect(
        adapter.add({ streamerId: "s-direct", streamerName: "Direct" }, 2)
      ).resolves.toBe("rev-job-id");
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

      return import("../revenue-sync-queue");
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
      const { revenueSyncQueue } = await setupBullModule();
      const processor = jest.fn();

      revenueSyncQueue.process(processor);
      revenueSyncQueue.process(processor);

      expect(mockQueueCtor).toHaveBeenCalled();
      expect(mockWorkerCtor).toHaveBeenCalledTimes(1);
      expect(mockWorkerOn).toHaveBeenCalledWith("failed", expect.any(Function));
    });

    it("passes BullMQ worker job data into the processor", async () => {
      const { revenueSyncQueue } = await setupBullModule();
      const processor = jest.fn().mockResolvedValue(undefined);

      revenueSyncQueue.process(processor);

      const workerProcessor = mockWorkerCtor.mock.calls[0]?.[1] as
        | ((job: { data: { streamerId: string; streamerName: string } }) => Promise<void>)
        | undefined;

      await workerProcessor?.({ data: { streamerId: "s-pass", streamerName: "Streamer" } });
      expect(processor).toHaveBeenCalledWith({ streamerId: "s-pass", streamerName: "Streamer" });
    });

    it("logs failed worker events", async () => {
      const { logger } = jest.requireMock("../logger") as {
        logger: { error: jest.Mock };
      };
      const { revenueSyncQueue } = await setupBullModule();
      revenueSyncQueue.process(jest.fn());

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
      const { revenueSyncQueue } = await setupBullModule();
      revenueSyncQueue.process(jest.fn());

      const failedHandler = mockWorkerOn.mock.calls.find((call) => call[0] === "failed")?.[1] as
        | ((job: { id?: string } | undefined, error: unknown) => void)
        | undefined;

      failedHandler?.(undefined, new Error("boom"));
      expect(logger.error).toHaveBeenCalledWith(
        "RevenueQueue",
        "Job failed: unknown",
        expect.any(Error)
      );
    });

    it("adds a BullMQ revenue job successfully", async () => {
      const isoSpy = jest.spyOn(Date.prototype, "toISOString").mockReturnValue("2026-03-12T15:00:00.000Z");
      const { revenueSyncQueue } = await setupBullModule();
      mockQueueGetJobCounts.mockResolvedValue({
        waiting: 1,
        delayed: 1,
        active: 0,
        prioritized: 1,
        "waiting-children": 1,
      });
      mockQueueAdd.mockResolvedValue(undefined);

      const id = await revenueSyncQueue.add({ streamerId: "s1", streamerName: "Name" }, 3);
      expect(id).toBe("revenue:s1:2026-03-12T15");
      expect(mockQueueAdd).toHaveBeenCalledWith(
        "revenue:s1:2026-03-12T15",
        { streamerId: "s1", streamerName: "Name" },
        { priority: 7, jobId: "revenue:s1:2026-03-12T15" }
      );
      isoSpy.mockRestore();
    });

    it("clamps BullMQ priority to minimum 1", async () => {
      const isoSpy = jest.spyOn(Date.prototype, "toISOString").mockReturnValue("2026-03-12T15:00:00.000Z");
      const { revenueSyncQueue } = await setupBullModule();
      mockQueueGetJobCounts.mockResolvedValue({});
      mockQueueAdd.mockResolvedValue(undefined);

      await revenueSyncQueue.add({ streamerId: "s4", streamerName: "Clamp" }, 99);

      expect(mockQueueAdd).toHaveBeenCalledWith(
        "revenue:s4:2026-03-12T15",
        { streamerId: "s4", streamerName: "Clamp" },
        { priority: 1, jobId: "revenue:s4:2026-03-12T15" }
      );
      isoSpy.mockRestore();
    });

    it("returns null when queue backlog is too high", async () => {
      const { logger } = jest.requireMock("../logger") as {
        logger: { warn: jest.Mock };
      };
      process.env.REVENUE_QUEUE_MAX_WAITING = "2";
      const { revenueSyncQueue } = await setupBullModule();
      mockQueueGetJobCounts.mockResolvedValue({
        waiting: 2,
        delayed: 0,
        active: 0,
        prioritized: 0,
        "waiting-children": 0,
      });

      await expect(
        revenueSyncQueue.add({ streamerId: "s2", streamerName: "Name" })
      ).resolves.toBeNull();
      expect(logger.warn).toHaveBeenCalled();
      delete process.env.REVENUE_QUEUE_MAX_WAITING;
    });

    it("returns null when enqueue throws", async () => {
      const { logger } = jest.requireMock("../logger") as {
        logger: { error: jest.Mock };
      };
      const { revenueSyncQueue } = await setupBullModule();
      mockQueueGetJobCounts.mockRejectedValue(new Error("counts fail"));

      await expect(
        revenueSyncQueue.add({ streamerId: "s3", streamerName: "Name" })
      ).resolves.toBeNull();
      expect(logger.error).toHaveBeenCalled();
    });

    it("computes BullMQ status metrics and diagnostics", async () => {
      const { revenueSyncQueue } = await setupBullModule();
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

      const status = await revenueSyncQueue.getStatus();
      expect(status).toEqual({
        queued: 8,
        processing: 2,
        total: 10,
        overflowPersisted: 0,
        overflowRecovered: 0,
        failed: 1,
        oldestWaitingMs: 4000,
        avgCompletedMs: 700,
        p95CompletedMs: 900,
        failedRatioPercent: 20,
      });

      const diagnostics = await revenueSyncQueue.getDiagnostics(2);
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
      const { revenueSyncQueue } = await setupBullModule();
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

      const diagnostics = await revenueSyncQueue.getDiagnostics();
      expect(diagnostics.status.oldestWaitingMs).toBe(0);
      expect(mockQueueGetJobs).toHaveBeenLastCalledWith(["failed"], 0, 19, true);
      nowSpy.mockRestore();
    });

    it("returns zeroed status metrics when no waiting or completed jobs exist", async () => {
      const { revenueSyncQueue } = await setupBullModule();
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

      await expect(revenueSyncQueue.getStatus()).resolves.toEqual({
        queued: 0,
        processing: 0,
        total: 0,
        overflowPersisted: 0,
        overflowRecovered: 0,
        failed: 0,
        oldestWaitingMs: 0,
        avgCompletedMs: 0,
        p95CompletedMs: 0,
        failedRatioPercent: 0,
      });
    });

    it("swallows shutdown close errors", async () => {
      const { revenueSyncQueue } = await setupBullModule();
      revenueSyncQueue.process(jest.fn());
      mockWorkerClose.mockRejectedValueOnce(new Error("worker close"));
      mockQueueClose.mockRejectedValueOnce(new Error("queue close"));

      await expect(revenueSyncQueue.shutdown()).resolves.toBeUndefined();
    });
  });
});
