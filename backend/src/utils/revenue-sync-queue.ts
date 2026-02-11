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
};

interface RevenueSyncQueueAdapter {
  process(processor: QueueProcessor): void;
  add(data: RevenueSyncJobData, priority?: number): string | null;
  getStatus(): Promise<QueueStatus>;
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

  add(data: RevenueSyncJobData, priority: number = 0): string | null {
    return this.queue.add(data, priority);
  }

  async getStatus(): Promise<QueueStatus> {
    const status = this.queue.getStatus();
    return status;
  }
}

class BullMQRevenueSyncQueueAdapter implements RevenueSyncQueueAdapter {
  private readonly queue: Queue<RevenueSyncJobData>;
  private worker: Worker<RevenueSyncJobData> | null = null;

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

  add(data: RevenueSyncJobData, priority: number = 0): string | null {
    const options: JobsOptions = {
      priority: Math.max(1, 10 - priority),
    };

    this.queue
      .add(`revenue-${data.streamerId}-${Date.now()}`, data, options)
      .catch((error: unknown) => logger.error("RevenueQueue", "Failed to enqueue job", error));

    return `queued-${data.streamerId}-${Date.now()}`;
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
    return {
      queued,
      processing,
      total: queued + processing,
      overflowPersisted: 0,
      overflowRecovered: 0,
    };
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
