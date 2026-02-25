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
import { appendFile, mkdir, open, rename, stat, unlink } from "fs/promises";
import { appendFileSync, createReadStream, createWriteStream, mkdirSync } from "fs";
import path from "path";
import { createInterface } from "readline";
import { once } from "events";

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
  overflowFilePath?: string;
}

type JobProcessor<T> = (data: T) => Promise<void>;

const OVERFLOW_LOCK_WAIT_MS = 25;
const OVERFLOW_LOCK_MAX_WAIT_MS = 250;
const OVERFLOW_LOCK_MAX_ATTEMPTS = 120;
const OVERFLOW_LOCK_STALE_MS = 2 * 60 * 1000;
const SYNC_OVERFLOW_PRIORITY_THRESHOLD = Number(process.env.QUEUE_SYNC_OVERFLOW_PRIORITY || 10);

export class MemoryQueue<T = unknown> {
  private queue: QueueJob<T>[] = [];
  private retryQueue: Array<{ executeAt: number; job: QueueJob<T> }> = [];
  private retryTimer: NodeJS.Timeout | null = null;
  private processing = 0;
  private processor: JobProcessor<T> | null = null;
  private jobIdCounter = 0;
  private overflowRecovering = false;
  private overflowPersisted = 0;
  private overflowRecovered = 0;
  private overflowFileOpChain: Promise<void> = Promise.resolve();

  private readonly concurrency: number;
  private readonly maxRetries: number;
  private readonly maxQueueSize: number;
  private readonly retryDelayMs: number;
  private readonly overflowFilePath: string | null;

  constructor(options: QueueOptions = {}) {
    this.concurrency = options.concurrency ?? 2;
    this.maxRetries = options.maxRetries ?? 2;
    this.maxQueueSize = options.maxQueueSize ?? 50;
    this.retryDelayMs = options.retryDelayMs ?? 5000;
    this.overflowFilePath = options.overflowFilePath ?? null;

    if (this.overflowFilePath) {
      const recoveryTimer = setInterval(() => {
        this.recoverOverflowJobs().catch((error) => {
          logger.error("MemoryQueue", "Overflow recovery failed", error);
        });
      }, 30 * 1000);

      if (recoveryTimer.unref) {
        recoveryTimer.unref();
      }
    }
  }

  /**
   * 設定任務處理器
   */
  process(processor: JobProcessor<T>): void {
    this.processor = processor;
    // 開始處理佇列中的任務
    this.tick();
    this.recoverOverflowJobs().catch((error) => {
      logger.error("MemoryQueue", "Initial overflow recovery failed", error);
    });
  }

  private createJob(data: T, priority: number): QueueJob<T> {
    return {
      id: `job_${++this.jobIdCounter}`,
      data,
      priority,
      retries: 0,
      createdAt: new Date(),
    };
  }

  private enqueueJob(job: QueueJob<T>): boolean {
    if (this.queue.length >= this.maxQueueSize) {
      return false;
    }

    const insertIndex = this.queue.findIndex((queued) => queued.priority < job.priority);
    if (insertIndex === -1) {
      this.queue.push(job);
    } else {
      this.queue.splice(insertIndex, 0, job);
    }

    return true;
  }

  private scheduleRetry(job: QueueJob<T>): void {
    const executeAt = Date.now() + this.retryDelayMs;
    const insertIndex = this.retryQueue.findIndex((retryItem) => retryItem.executeAt > executeAt);

    const retryItem = { executeAt, job };
    if (insertIndex === -1) {
      this.retryQueue.push(retryItem);
    } else {
      this.retryQueue.splice(insertIndex, 0, retryItem);
    }

    this.armRetryTimer();
  }

  private armRetryTimer(): void {
    if (this.retryTimer || this.retryQueue.length === 0) {
      return;
    }

    const nextExecuteAt = this.retryQueue[0]?.executeAt ?? Date.now();
    const delayMs = Math.max(0, nextExecuteAt - Date.now());

    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.processRetryQueue().catch((err) =>
        logger.warn("MemoryQueue", "processRetryQueue failed in timer callback", err)
      );
    }, delayMs);

    if (this.retryTimer.unref) {
      this.retryTimer.unref();
    }
  }

  private async processRetryQueue(): Promise<void> {
    const now = Date.now();

    // Find the boundary index where executeAt > now
    let boundaryIndex = 0;
    while (boundaryIndex < this.retryQueue.length) {
      const item = this.retryQueue[boundaryIndex];
      if (!item || item.executeAt > now) break;
      boundaryIndex++;
    }

    if (boundaryIndex === 0) {
      this.armRetryTimer();
      return;
    }

    // Batch extract due jobs (single splice instead of repeated shift)
    const dueItems = this.retryQueue.splice(0, boundaryIndex);
    const dueJobs = dueItems.map((item) => item.job);

    for (const job of dueJobs) {
      const retryJob: QueueJob<T> = {
        ...job,
        priority: job.priority - 1,
      };

      if (!this.enqueueJob(retryJob)) {
        if (this.overflowFilePath) {
          if (retryJob.priority >= SYNC_OVERFLOW_PRIORITY_THRESHOLD) {
            await this.persistOverflowJob(retryJob);
          } else {
            void this.persistOverflowJob(retryJob).catch((err) =>
              logger.warn("MemoryQueue", `persistOverflowJob failed for retry job ${retryJob.id}`, err)
            );

          }
        } else {
          logger.warn("MemoryQueue", `Retry queue full, dropping job ${retryJob.id}`);
        }
      }
    }

    if (dueJobs.length > 0) {
      this.tick();
    }

    this.armRetryTimer();
  }

  private async persistOverflowJob(job: QueueJob<T>): Promise<void> {
    if (!this.overflowFilePath) {
      return;
    }

    await this.withOverflowFileLock(async () => {
      try {
        await mkdir(path.dirname(this.overflowFilePath), { recursive: true });
        const serialized = JSON.stringify({
          id: job.id,
          data: job.data,
          priority: job.priority,
          retries: job.retries,
          createdAt: job.createdAt.toISOString(),
        });
        await appendFile(this.overflowFilePath, `${serialized}\n`, "utf8");
        this.overflowPersisted += 1;
        logger.warn("MemoryQueue", `Queue full, persisted overflow job ${job.id}`);
      } catch (error) {
        logger.error("MemoryQueue", `Failed to persist overflow job ${job.id}`, error);
      }
    });
  }

  private persistOverflowJobSync(job: QueueJob<T>): void {
    if (!this.overflowFilePath) {
      return;
    }

    mkdirSync(path.dirname(this.overflowFilePath), { recursive: true });
    const serialized = JSON.stringify({
      id: job.id,
      data: job.data,
      priority: job.priority,
      retries: job.retries,
      createdAt: job.createdAt.toISOString(),
    });
    appendFileSync(this.overflowFilePath, `${serialized}\n`, "utf8");
    this.overflowPersisted += 1;
  }

  private async withOverflowFileLock(work: () => Promise<void>): Promise<void> {
    const run = this.overflowFileOpChain.then(
      async () => this.runWithOptionalCrossProcessLock(work),
      async () => this.runWithOptionalCrossProcessLock(work)
    );
    this.overflowFileOpChain = run.then(
      (): void => undefined,
      (): void => undefined
    );
    await run;
  }

  private async runWithOptionalCrossProcessLock(work: () => Promise<void>): Promise<void> {
    if (!this.overflowFilePath) {
      await work();
      return;
    }

    const lockPath = `${this.overflowFilePath}.lock`;
    let lockHandle: Awaited<ReturnType<typeof open>> | null = null;

    try {
      lockHandle = await this.acquireOverflowLock(lockPath);
      await work();
    } finally {
      if (lockHandle) {
        try {
          await lockHandle.close();
        } catch {
          // noop
        }
        try {
          await unlink(lockPath);
        } catch {
          // noop
        }
      }
    }
  }

  private async acquireOverflowLock(lockPath: string): Promise<Awaited<ReturnType<typeof open>> | null> {
    for (let attempt = 1; attempt <= OVERFLOW_LOCK_MAX_ATTEMPTS; attempt += 1) {
      try {
        return await open(lockPath, "wx");
      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException;
        if (nodeError.code !== "EEXIST") {
          logger.warn("MemoryQueue", `Overflow lock unexpected error: ${nodeError.message}`);
          return null;
        }

        const removedStale = await this.tryRemoveStaleOverflowLock(lockPath);
        if (removedStale) {
          continue;
        }

        if (attempt < OVERFLOW_LOCK_MAX_ATTEMPTS) {
          const waitMs = Math.min(
            OVERFLOW_LOCK_WAIT_MS * 2 ** Math.floor(attempt / 20),
            OVERFLOW_LOCK_MAX_WAIT_MS
          );
          await new Promise((resolve) => setTimeout(resolve, waitMs));
        }
      }
    }

    logger.warn("MemoryQueue", "Overflow lock acquire timeout, fallback to in-process lock only");
    return null;
  }

  private async tryRemoveStaleOverflowLock(lockPath: string): Promise<boolean> {
    try {
      const lockStat = await stat(lockPath);
      const lockAgeMs = Date.now() - lockStat.mtimeMs;

      if (lockAgeMs < OVERFLOW_LOCK_STALE_MS) {
        return false;
      }

      await unlink(lockPath);
      logger.warn("MemoryQueue", `Removed stale overflow lock: ${lockPath}`);
      return true;
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === "ENOENT") {
        return true;
      }
      return false;
    }
  }

  private async recoverOverflowJobs(): Promise<void> {
    if (!this.overflowFilePath || this.overflowRecovering) {
      return;
    }

    if (this.queue.length >= this.maxQueueSize) {
      return;
    }

    this.overflowRecovering = true;

    try {
      await this.withOverflowFileLock(async () => {
        try {
          await stat(this.overflowFilePath);
        } catch (error) {
          const nodeError = error as NodeJS.ErrnoException;
          if (nodeError.code === "ENOENT") {
            return;
          }
          throw error;
        }

        const tempPath = `${this.overflowFilePath}.tmp`;
        const readStream = createReadStream(this.overflowFilePath, { encoding: "utf8" });
        const writeStream = createWriteStream(tempPath, { encoding: "utf8" });
        const lineReader = createInterface({ input: readStream, crlfDelay: Infinity });

        try {
          for await (const rawLine of lineReader) {
            const line = rawLine.trim();
            if (line.length === 0) {
              continue;
            }

            if (this.queue.length >= this.maxQueueSize) {
              await this.writeOverflowLine(writeStream, line);
              continue;
            }

            try {
              const parsed = JSON.parse(line) as {
                data?: T;
                priority?: number;
                retries?: number;
                createdAt?: string;
              };

              if (typeof parsed.priority !== "number") {
                continue;
              }

              const recoveredJob: QueueJob<T> = {
                id: `job_${++this.jobIdCounter}`,
                data: parsed.data as T,
                priority: parsed.priority,
                retries: typeof parsed.retries === "number" ? parsed.retries : 0,
                createdAt: parsed.createdAt ? new Date(parsed.createdAt) : new Date(),
              };

              if (this.enqueueJob(recoveredJob)) {
                this.overflowRecovered += 1;
              } else {
                await this.writeOverflowLine(writeStream, line);
              }
            } catch {
              logger.warn("MemoryQueue", "Skipped invalid overflow payload line");
            }
          }

          await new Promise<void>((resolve, reject) => {
            writeStream.on("error", reject);
            writeStream.end(() => resolve());
          });
        } finally {
          lineReader.close();
        }

        await rename(tempPath, this.overflowFilePath);
      });

      if (this.processor && this.queue.length > 0) {
        this.tick();
      }
    } finally {
      this.overflowRecovering = false;
    }
  }

  private async writeOverflowLine(stream: ReturnType<typeof createWriteStream>, line: string): Promise<void> {
    if (stream.write(`${line}\n`)) {
      return;
    }
    await once(stream, "drain");
  }

  /**
   * 新增任務到佇列
   * @returns 任務 ID 或 null（如果佇列已滿）
   */
  add(data: T, priority: number = 0): string | null {
    const job = this.createJob(data, priority);

    if (!this.enqueueJob(job)) {
      if (this.overflowFilePath) {
        if (priority >= SYNC_OVERFLOW_PRIORITY_THRESHOLD) {
          try {
            this.persistOverflowJobSync(job);
          } catch (error) {
            logger.error("MemoryQueue", `同步寫入 overflow 失敗 (job=${job.id})`, error);
            return null;
          }
        } else {
          void this.persistOverflowJob(job).catch((err) =>
            logger.warn("MemoryQueue", `persistOverflowJob failed for job ${job.id}`, err)
          );
        }
        return job.id;
      }

      logger.warn("MemoryQueue", `Queue is full (${this.maxQueueSize} jobs). Job rejected.`);
      return null;
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
    overflowPersisted: number;
    overflowRecovered: number;
  } {
    return {
      queued: this.queue.length,
      processing: this.processing,
      total: this.queue.length + this.processing,
      overflowPersisted: this.overflowPersisted,
      overflowRecovered: this.overflowRecovered,
    };
  }

  /**
   * 清空佇列
   */
  clear(): void {
    this.queue = [];
    this.retryQueue = [];
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
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
    const slotsAvailable = this.concurrency - this.processing;
    if (slotsAvailable <= 0 || this.queue.length === 0) return;

    // Batch dequeue: single splice instead of repeated shift()
    const batchSize = Math.min(slotsAvailable, this.queue.length);
    const jobs = this.queue.splice(0, batchSize);

    for (const job of jobs) {
      this.processing++;
      this.processJob(job)
        .catch((err) => logger.warn("MemoryQueue", `processJob failed for job ${job.id}`, err))
        .finally(() => {
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
        this.scheduleRetry(job);
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
