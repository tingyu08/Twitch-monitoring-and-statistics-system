import { access, mkdtemp, readFile, utimes, writeFile } from "fs/promises";
import os from "os";
import path from "path";

import { MemoryQueue } from "../memory-queue";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("MemoryQueue overflow lock", () => {
  it("should recover overflow jobs under burst writes", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "memory-queue-test-"));
    const overflowFilePath = path.join(tempDir, "overflow.log");
    const queue = new MemoryQueue<number>({
      concurrency: 1,
      maxQueueSize: 1,
      maxRetries: 0,
      retryDelayMs: 5,
      overflowFilePath,
    });

    const processed: number[] = [];
    queue.process(async (value) => {
      processed.push(value);
      await sleep(5);
    });

    for (let i = 0; i < 12; i += 1) {
      queue.add(i);
    }

    for (let i = 0; i < 80; i += 1) {
      await (queue as any).recoverOverflowJobs();
      if (processed.length >= 12) {
        break;
      }
      await sleep(10);
    }

    expect(processed.length).toBe(12);
    const status = queue.getStatus();
    expect(status.overflowPersisted).toBeGreaterThan(0);
    expect(status.overflowRecovered).toBeGreaterThan(0);
  });

  it("should remove stale lock file before overflow operation", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "memory-queue-lock-"));
    const overflowFilePath = path.join(tempDir, "overflow.log");
    const lockPath = `${overflowFilePath}.lock`;

    const queue = new MemoryQueue<number>({
      concurrency: 1,
      maxQueueSize: 1,
      maxRetries: 0,
      overflowFilePath,
    });

    await writeFile(lockPath, "stale", "utf8");
    const staleDate = new Date(Date.now() - 5 * 60 * 1000);
    await utimes(lockPath, staleDate, staleDate);

    await (queue as any).withOverflowFileLock(async () => {
      await writeFile(overflowFilePath, "ok\n", "utf8");
    });

    const content = await readFile(overflowFilePath, "utf8");
    expect(content).toContain("ok");
    await expect(access(lockPath)).rejects.toBeTruthy();
  });
});
