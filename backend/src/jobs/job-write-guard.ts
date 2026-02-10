import { logger } from "../utils/logger";

const DEFAULT_WRITE_GAP_MS = 1000;

const parsedGapMs = Number.parseInt(process.env.JOB_WRITE_GAP_MS || `${DEFAULT_WRITE_GAP_MS}`, 10);
const WRITE_GAP_MS = Number.isFinite(parsedGapMs) && parsedGapMs >= 0 ? parsedGapMs : DEFAULT_WRITE_GAP_MS;

let writeTail: Promise<void> = Promise.resolve();
let lastWriteCompletedAt = 0;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runWithWriteGuard<T>(jobName: string, operation: () => Promise<T>): Promise<T> {
  let releaseCurrent: (() => void) | null = null;
  const previous = writeTail;

  writeTail = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });

  await previous;

  const sinceLastWrite = Date.now() - lastWriteCompletedAt;
  if (sinceLastWrite < WRITE_GAP_MS) {
    await wait(WRITE_GAP_MS - sinceLastWrite);
  }

  try {
    return await operation();
  } finally {
    lastWriteCompletedAt = Date.now();
    releaseCurrent?.();
    logger.debug("JobWriteGuard", `Write slot released by ${jobName}`);
  }
}
