import { logger } from "../utils/logger";

const DEFAULT_WRITE_GAP_MS = 1000;
const isTursoDatabase = (process.env.DATABASE_URL || "").startsWith("libsql://");
const DEFAULT_GUARD_MODE = process.env.NODE_ENV === "production" || isTursoDatabase ? "global" : "keyed";

const parsedGapMs = Number.parseInt(process.env.JOB_WRITE_GAP_MS || `${DEFAULT_WRITE_GAP_MS}`, 10);
const WRITE_GAP_MS = Number.isFinite(parsedGapMs) && parsedGapMs >= 0 ? parsedGapMs : DEFAULT_WRITE_GAP_MS;

let writeTail: Promise<void> = Promise.resolve();
let lastWriteCompletedAt = 0;
const writeTailsByKey = new Map<string, Promise<void>>();
const lastWriteCompletedAtByKey = new Map<string, number>();

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runWithWriteGuard<T>(jobName: string, operation: () => Promise<T>): Promise<T> {
  const guardKey = resolveGuardKey(jobName);

  if (!guardKey) {
    return runWithGlobalGuard(jobName, operation);
  }

  let releaseCurrent: (() => void) | null = null;
  const previous = writeTailsByKey.get(guardKey) || Promise.resolve();

  writeTailsByKey.set(
    guardKey,
    new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    })
  );

  await previous;

  const lastCompletedAt = lastWriteCompletedAtByKey.get(guardKey) || 0;
  const sinceLastWrite = Date.now() - lastCompletedAt;
  if (sinceLastWrite < WRITE_GAP_MS) {
    await wait(WRITE_GAP_MS - sinceLastWrite);
  }

  try {
    return await operation();
  } finally {
    lastWriteCompletedAtByKey.set(guardKey, Date.now());
    releaseCurrent?.();
    logger.debug("JobWriteGuard", `Write slot released by ${jobName} (key=${guardKey})`);
  }
}

function resolveGuardKey(jobName: string): string | null {
  const configured = process.env.JOB_WRITE_GUARD_MODE || DEFAULT_GUARD_MODE;
  if (configured === "global") {
    return null;
  }

  // key format: <resource>:<operation>，例如 stream-status:update-session
  const [resource] = jobName.split(":");
  return resource || null;
}

async function runWithGlobalGuard<T>(jobName: string, operation: () => Promise<T>): Promise<T> {
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
    logger.debug("JobWriteGuard", `Write slot released by ${jobName} (global)`);
  }
}
