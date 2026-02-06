/**
 * 輕量級記憶體佇列
 *
 * 為 Zeabur 免費層設計的簡單佇列系統
 * - 支援優先級排序
 * - 併發控制
 * - 重試機制
 * - 最大佇列大小限制
 */

import { logger } from "./logger";

export interface QueueJob<T = unknown> {
  id: string;
  data: T;
  priority: number;
  retries: number;
  createdAt: Date;
}

export interface QueueOptions {
  concurrency?: number;
  maxRetries?: number;
  maxQueueSize?: number;
  retryDelayMs?: number;
}

type JobProcessor<T> = (data: T) => Promise<void>;

export class MemoryQueue<T = unknown> {
  private queue: QueueJob<T>[] = [];
  private processing = 0;
  private processor: JobProcessor<T> | null = null;
  private jobIdCounter = 0;

  private readonly concurrency: number;
  private readonly maxRetries: number;
  private readonly maxQueueSize: number;
  private readonly retryDelayMs: number;

  constructor(options: QueueOptions = {}) {
    this.concurrency = options.concurrency ?? 2;
    this.maxRetries = options.maxRetries ?? 2;
    this.maxQueueSize = options.maxQueueSize ?? 50;
    this.retryDelayMs = options.retryDelayMs ?? 5000;
  }

  /**
   * 設定任務處理器
   */
  process(processor: JobProcessor<T>): void {
    this.processor = processor;
    // 開始處理佇列中的任務
    this.tick();
  }

  /**
   * 新增任務到佇列
   * @returns 任務 ID 或 null（如果佇列已滿）
   */
  add(data: T, priority: number = 0): string | null {
    if (this.queue.length >= this.maxQueueSize) {
      logger.warn("MemoryQueue", `Queue is full (${this.maxQueueSize} jobs). Job rejected.`);
      return null;
    }

    const job: QueueJob<T> = {
      id: `job_${++this.jobIdCounter}`,
      data,
      priority,
      retries: 0,
      createdAt: new Date(),
    };

    // 依優先級插入（高優先級在前）
    const insertIndex = this.queue.findIndex((j) => j.priority < priority);
    if (insertIndex === -1) {
      this.queue.push(job);
    } else {
      this.queue.splice(insertIndex, 0, job);
    }

    logger.debug("MemoryQueue", `Job ${job.id} added. Queue size: ${this.queue.length}`);

    // 嘗試處理
    this.tick();

    return job.id;
  }

  /**
   * 取得佇列狀態
   */
  getStatus(): {
    queued: number;
    processing: number;
    total: number;
  } {
    return {
      queued: this.queue.length,
      processing: this.processing,
      total: this.queue.length + this.processing,
    };
  }

  /**
   * 清空佇列
   */
  clear(): void {
    this.queue = [];
    logger.debug("MemoryQueue", "Queue cleared");
  }

  /**
   * 處理佇列中的任務
   */
  private async tick(): Promise<void> {
    if (!this.processor) {
      return;
    }

    // 檢查是否可以處理更多任務
    while (this.processing < this.concurrency && this.queue.length > 0) {
      const job = this.queue.shift();
      if (!job) break;

      this.processing++;
      this.processJob(job).finally(() => {
        this.processing--;
        // 處理完成後繼續檢查佇列
        this.tick();
      });
    }
  }

  /**
   * 處理單個任務
   */
  private async processJob(job: QueueJob<T>): Promise<void> {
    if (!this.processor) {
      logger.warn("MemoryQueue", `No processor set, skipping job ${job.id}`);
      return;
    }

    try {
      logger.debug("MemoryQueue", `Processing job ${job.id}...`);
      await this.processor(job.data);
      logger.debug("MemoryQueue", `Job ${job.id} completed successfully`);
    } catch (error) {
      logger.error("MemoryQueue", `Job ${job.id} failed:`, error);

      // 檢查是否可以重試
      if (job.retries < this.maxRetries) {
        job.retries++;
        logger.info(
          "MemoryQueue",
          `Job ${job.id} will retry (${job.retries}/${this.maxRetries}) in ${this.retryDelayMs}ms`
        );

        // 延遲後重新加入佇列
        setTimeout(() => {
          // 重試時降低優先級
          const newPriority = job.priority - 1;
          const insertIndex = this.queue.findIndex((j) => j.priority < newPriority);
          if (insertIndex === -1) {
            this.queue.push({ ...job, priority: newPriority });
          } else {
            this.queue.splice(insertIndex, 0, { ...job, priority: newPriority });
          }
          this.tick();
        }, this.retryDelayMs);
      } else {
        logger.error("MemoryQueue", `Job ${job.id} failed after ${this.maxRetries} retries. Giving up.`);
      }
    }
  }
}

/**
 * Revenue Sync 專用佇列配置
 */
export interface RevenueSyncJobData {
  streamerId: string;
  streamerName?: string;
}

/**
 * Revenue Sync 佇列單例
 */
export const revenueSyncQueue = new MemoryQueue<RevenueSyncJobData>({
  concurrency: 2,      // 同時處理 2 個任務
  maxRetries: 2,       // 最多重試 2 次
  maxQueueSize: 50,    // 最大 50 個待處理任務
  retryDelayMs: 10000, // 重試間隔 10 秒
});
