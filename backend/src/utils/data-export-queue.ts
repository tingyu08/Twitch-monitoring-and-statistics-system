import { Queue, Worker, type JobsOptions } from "bullmq";
import type { RedisOptions } from "ioredis";
import { logger } from "./logger";
import { MemoryQueue } from "./memory-queue";
import { getBullMQConnectionOptions } from "./redis-client";

export interface DataExportJobData {
  exportJobId: string;
}

type QueueProcessor = (data: DataExportJobData) => Promise<void>;

interface QueueStatus {
  queued: number;
  processing: number;
  total: number;
}

interface DataExportQueueAdapter {
  process(processor: QueueProcessor): void;
  add(data: DataExportJobData, priority?: number): string | null;
  getStatus(): Promise<QueueStatus>;
}

class MemoryDataExportQueueAdapter implements DataExportQueueAdapter {
  private queue = new MemoryQueue<DataExportJobData>({
    concurrency: 1,
    maxRetries: 2,
    maxQueueSize: 100,
    retryDelayMs: 10000,
  });

  process(processor: QueueProcessor): void {
    this.queue.process(processor);
  }

  add(data: DataExportJobData, priority: number = 0): string | null {
    return this.queue.add(data, priority);
  }

  async getStatus(): Promise<QueueStatus> {
    const status = this.queue.getStatus();
    return {
      queued: status.queued,
      processing: status.processing,
      total: status.total,
    };
  }
}

class BullMQDataExportQueueAdapter implements DataExportQueueAdapter {
  private readonly queue: Queue<DataExportJobData>;
  private worker: Worker<DataExportJobData> | null = null;

  constructor(private readonly connection: RedisOptions) {
    this.queue = new Queue<DataExportJobData>("data-export", {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 10000 },
        removeOnComplete: 50,
        removeOnFail: 100,
      },
    });
  }

  process(processor: QueueProcessor): void {
    if (this.worker) return;

    this.worker = new Worker<DataExportJobData>(
      "data-export",
      async (job: { data: DataExportJobData }) => processor(job.data),
      {
        connection: this.connection,
        concurrency: 1,
      }
    );

    this.worker.on("failed", (job: { id?: string } | undefined, error: unknown) => {
      logger.error("DataExportQueue", `Job failed: ${job?.id || "unknown"}`, error);
    });
  }

  add(data: DataExportJobData, priority: number = 0): string | null {
    const options: JobsOptions = {
      priority: Math.max(1, 10 - priority),
    };

    const jobId = `export-${data.exportJobId}-${Date.now()}`;
    this.queue.add(jobId, data, options).catch((error: unknown) => {
      logger.error("DataExportQueue", "Failed to enqueue export job", error);
    });

    return jobId;
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
    };
  }
}

function createAdapter(): DataExportQueueAdapter {
  const connection = getBullMQConnectionOptions();
  if (!connection) {
    logger.info("DataExportQueue", "Using in-memory queue adapter");
    return new MemoryDataExportQueueAdapter();
  }

  logger.info("DataExportQueue", "Using BullMQ queue adapter");
  return new BullMQDataExportQueueAdapter(connection);
}

export const dataExportQueue: DataExportQueueAdapter = createAdapter();
