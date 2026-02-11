import { Queue, Worker, type JobsOptions } from "bullmq";
import type { RedisOptions } from "ioredis";
import { logger } from "./logger";
import { MemoryQueue, type RevenueSyncJobData } from "./memory-queue";
import { getBullMQConnectionOptions } from "./redis-client";

type QueueProcessor = (data: RevenueSyncJobData) => Promise<void>;

type QueueStatus = {
  queued: number;
  processing: number;
  total: number;
  overflowPersisted: number;
  overflowRecovered: number;
  failed?: number;
  oldestWaitingMs?: number;
  avgCompletedMs?: number;
  p95CompletedMs?: number;
  failedRatioPercent?: number;
};

type QueueFailedJob = {
  id: string;
  name: string;
  failedReason: string;
  attemptsMade: number;
  timestamp: number;
};

type QueueDiagnostics = {
  status: QueueStatus;
  failedJobs: QueueFailedJob[];
};

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index];
}

interface RevenueSyncQueueAdapter {
  process(processor: QueueProcessor): void;
  add(data: RevenueSyncJobData, priority?: number): Promise<string | null>;
  getStatus(): Promise<QueueStatus>;
  getDiagnostics(limit?: number): Promise<QueueDiagnostics>;
  shutdown(): Promise<void>;
}

class MemoryRevenueSyncQueueAdapter implements RevenueSyncQueueAdapter {
  private queue = new MemoryQueue<RevenueSyncJobData>({
    concurrency: 2,
    maxRetries: 2,
    maxQueueSize: 50,
    retryDelayMs: 10000,
  });

  process(processor: QueueProcessor): void {
    this.queue.process(processor);
  }

  async add(data: RevenueSyncJobData, priority: number = 0): Promise<string | null> {
    return this.queue.add(data, priority);
  }

  async getStatus(): Promise<QueueStatus> {
    const status = this.queue.getStatus();
    return status;
  }

  async getDiagnostics(): Promise<QueueDiagnostics> {
    const status = await this.getStatus();
    return { status, failedJobs: [] };
  }

  async shutdown(): Promise<void> {
    return Promise.resolve();
  }
}

class BullMQRevenueSyncQueueAdapter implements RevenueSyncQueueAdapter {
  private readonly queue: Queue<RevenueSyncJobData>;
  private worker: Worker<RevenueSyncJobData> | null = null;
  private readonly maxQueuedJobs = Number(process.env.REVENUE_QUEUE_MAX_WAITING || 500);

  constructor(private readonly connection: RedisOptions) {
    this.queue = new Queue<RevenueSyncJobData>("revenue-sync", {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 10000,
        },
        removeOnComplete: 50,
        removeOnFail: 100,
      },
    });
  }

  process(processor: QueueProcessor): void {
    if (this.worker) {
      return;
    }

    this.worker = new Worker<RevenueSyncJobData>(
      "revenue-sync",
      async (job: { data: RevenueSyncJobData }) => processor(job.data),
      {
        connection: this.connection,
        concurrency: 2,
      }
    );

    this.worker.on("failed", (job: { id?: string } | undefined, error: unknown) => {
      logger.error("RevenueQueue", `Job failed: ${job?.id || "unknown"}`, error);
    });
  }

  async add(data: RevenueSyncJobData, priority: number = 0): Promise<string | null> {
    const hourBucket = new Date().toISOString().slice(0, 13); // YYYY-MM-DDTHH
    const stableJobId = `revenue:${data.streamerId}:${hourBucket}`;

    const options: JobsOptions = {
      priority: Math.max(1, 10 - priority),
      jobId: stableJobId,
    };

    try {
      const counts = await this.queue.getJobCounts(
        "waiting",
        "delayed",
        "active",
        "prioritized",
        "waiting-children"
      );
      const queued =
        (counts.waiting || 0) +
        (counts.delayed || 0) +
        (counts.prioritized || 0) +
        (counts["waiting-children"] || 0);

      if (queued >= this.maxQueuedJobs) {
        logger.warn(
          "RevenueQueue",
          `Queue backlog too high (${queued}/${this.maxQueuedJobs}), rejected ${stableJobId}`
        );
        return null;
      }

      await this.queue.add(stableJobId, data, options);
      return stableJobId;
    } catch (error) {
      logger.error("RevenueQueue", "Failed to enqueue job", error);
      return null;
    }
  }

  async getStatus(): Promise<QueueStatus> {
    const counts = await this.queue.getJobCounts(
      "active",
      "completed",
      "delayed",
      "failed",
      "paused",
      "prioritized",
      "waiting",
      "waiting-children"
    );

    const queued =
      (counts.waiting || 0) +
      (counts.delayed || 0) +
      (counts.paused || 0) +
      (counts.prioritized || 0) +
      (counts["waiting-children"] || 0);

    const processing = counts.active || 0;

    const waitingJobs = await this.queue.getJobs(["waiting", "delayed"], 0, 29, true);
    const oldestWaitingMs =
      waitingJobs.length > 0
        ? Date.now() - Math.min(...waitingJobs.map((job) => job.timestamp || Date.now()))
        : 0;

    const completedJobs = await this.queue.getJobs(["completed"], 0, 49, true);
    const durations = completedJobs
      .map((job) => {
        if (!job.processedOn || !job.finishedOn) return null;
        return Math.max(0, job.finishedOn - job.processedOn);
      })
      .filter((v): v is number => typeof v === "number");

    const avgCompletedMs =
      durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
    const p95CompletedMs = durations.length > 0 ? Math.round(percentile(durations, 0.95)) : 0;
    const completedCount = counts.completed || 0;
    const failedCount = counts.failed || 0;
    const failedRatioPercent =
      completedCount + failedCount > 0
        ? Math.round((failedCount / (completedCount + failedCount)) * 10000) / 100
        : 0;

    return {
      queued,
      processing,
      total: queued + processing,
      overflowPersisted: 0,
      overflowRecovered: 0,
      failed: counts.failed || 0,
      oldestWaitingMs,
      avgCompletedMs,
      p95CompletedMs,
      failedRatioPercent,
    };
  }

  async getDiagnostics(limit: number = 20): Promise<QueueDiagnostics> {
    const status = await this.getStatus();
    const jobs = await this.queue.getJobs(["failed"], 0, Math.max(0, limit - 1), true);
    const failedJobs: QueueFailedJob[] = jobs.map((job) => ({
      id: String(job.id),
      name: job.name,
      failedReason: job.failedReason || "unknown",
      attemptsMade: job.attemptsMade,
      timestamp: job.timestamp,
    }));

    return { status, failedJobs };
  }

  async shutdown(): Promise<void> {
    await Promise.all([
      this.worker?.close().catch((): undefined => undefined),
      this.queue.close().catch((): undefined => undefined),
    ]);
    this.worker = null;
  }
}

function createAdapter(): RevenueSyncQueueAdapter {
  const connection = getBullMQConnectionOptions();
  if (!connection) {
    logger.info("RevenueQueue", "Using in-memory queue adapter");
    return new MemoryRevenueSyncQueueAdapter();
  }

  logger.info("RevenueQueue", "Using BullMQ queue adapter");
  return new BullMQRevenueSyncQueueAdapter(connection);
}

export const revenueSyncQueue: RevenueSyncQueueAdapter = createAdapter();

export type { RevenueSyncJobData };
