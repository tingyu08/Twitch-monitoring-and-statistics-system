import { mkdtemp } from "fs/promises";
import os from "os";
import path from "path";

import { CacheManager } from "../utils/cache-manager";
import { MemoryQueue } from "../utils/memory-queue";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runCacheStampedePressure(): Promise<{
  passed: boolean;
  factoryRuns: number;
  requestCount: number;
}> {
  const cache = new CacheManager(10);
  let factoryRuns = 0;
  const requestCount = 300;

  const values = await Promise.all(
    Array.from({ length: requestCount }, () =>
      cache.getOrSetWithTags(
        "pressure:cache:single-key",
        async () => {
          factoryRuns += 1;
          await sleep(20);
          return { value: "ok" };
        },
        120,
        ["pressure-test"]
      )
    )
  );

  const allConsistent = values.every((item) => item.value === "ok");
  const passed = allConsistent && factoryRuns <= 2;

  return {
    passed,
    factoryRuns,
    requestCount,
  };
}

async function runOverflowPressure(): Promise<{
  passed: boolean;
  totalJobs: number;
  processedJobs: number;
  overflowPersisted: number;
  overflowRecovered: number;
}> {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "memory-queue-pressure-"));
  const overflowFilePath = path.join(tmpDir, "overflow.log");
  const totalJobs = 400;

  const queue = new MemoryQueue<number>({
    concurrency: 1,
    maxQueueSize: 1,
    maxRetries: 0,
    retryDelayMs: 5,
    overflowFilePath,
  });

  let processedJobs = 0;
  queue.process(async () => {
    processedJobs += 1;
    await sleep(2);
  });

  for (let i = 0; i < totalJobs; i += 1) {
    queue.add(i);
  }

  const deadline = Date.now() + 45000;
  while (Date.now() < deadline && processedJobs < totalJobs) {
    await (queue as unknown as { recoverOverflowJobs: () => Promise<void> }).recoverOverflowJobs();
    await sleep(20);
  }

  const status = queue.getStatus();
  const passed = processedJobs === totalJobs;

  return {
    passed,
    totalJobs,
    processedJobs,
    overflowPersisted: status.overflowPersisted,
    overflowRecovered: status.overflowRecovered,
  };
}

async function main(): Promise<void> {
  console.log("\n[Pressure] MEM-10 cache stampede test");
  const cacheResult = await runCacheStampedePressure();
  console.log(
    `- requests=${cacheResult.requestCount}, factoryRuns=${cacheResult.factoryRuns}, passed=${cacheResult.passed}`
  );

  console.log("\n[Pressure] MEM-12 overflow recovery test");
  const overflowResult = await runOverflowPressure();
  console.log(
    `- processed=${overflowResult.processedJobs}/${overflowResult.totalJobs}, overflowPersisted=${overflowResult.overflowPersisted}, overflowRecovered=${overflowResult.overflowRecovered}, passed=${overflowResult.passed}`
  );

  if (!cacheResult.passed || !overflowResult.passed) {
    process.exitCode = 1;
    return;
  }

  console.log("\nPressure checks passed.\n");
}

void main();
