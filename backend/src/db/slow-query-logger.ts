import type { PrismaClient } from "@prisma/client";
import { logger } from "../utils/logger";
import { recordQueryDuration } from "./query-metrics";

type SlowQueryLogState = {
  lastLoggedAt: number;
  lastSeenAt: number;
  suppressedCount: number;
  maxSuppressedDuration: number;
};

type SlowQueryAggregate = {
  model: string | undefined;
  operation: string;
  count: number;
  maxDuration: number;
  totalDuration: number;
  lastDuration: number;
};

const SLOW_QUERY_LOG_THROTTLE_MS = Number(process.env.SLOW_QUERY_LOG_THROTTLE_MS || 120000);
const SLOW_QUERY_LOG_STATE_TTL_MS = Number(
  process.env.SLOW_QUERY_LOG_STATE_TTL_MS || Math.max(10 * 60 * 1000, SLOW_QUERY_LOG_THROTTLE_MS * 10)
);
const SLOW_QUERY_TOP_N = Math.max(0, Number(process.env.SLOW_QUERY_TOP_N || 0));
const SLOW_QUERY_TOP_N_WINDOW_MS = Number(
  process.env.SLOW_QUERY_TOP_N_WINDOW_MS || SLOW_QUERY_LOG_THROTTLE_MS
);
const SLOW_QUERY_LOG_STATE_MAX_ENTRIES = Math.max(
  100,
  Number(process.env.SLOW_QUERY_LOG_STATE_MAX_ENTRIES || 5000)
);
const SLOW_QUERY_AGGREGATE_MAX_ENTRIES = Math.max(
  100,
  Number(process.env.SLOW_QUERY_AGGREGATE_MAX_ENTRIES || 5000)
);
const SLOW_QUERY_LOG_IGNORE_KEYS = new Set(
  (process.env.SLOW_QUERY_LOG_IGNORE || "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
);

const slowQueryLogStates = new Map<string, SlowQueryLogState>();
const slowQueryAggregates = new Map<string, SlowQueryAggregate>();
let topNFlushTimer: NodeJS.Timeout | null = null;
let statesCleanupTimer: NodeJS.Timeout | null = null;

function getQueryKey(model: string | undefined, operation: string): string {
  return `${model ?? "Raw"}.${operation}`;
}

function isIgnored(queryKey: string): boolean {
  return SLOW_QUERY_LOG_IGNORE_KEYS.has(queryKey);
}

function recordSlowQueryAggregate(model: string | undefined, operation: string, duration: number): void {
  const queryKey = getQueryKey(model, operation);
  if (isIgnored(queryKey)) {
    return;
  }

  const current = slowQueryAggregates.get(queryKey);
  if (!current) {
    if (slowQueryAggregates.size >= SLOW_QUERY_AGGREGATE_MAX_ENTRIES) {
      const oldestKey = slowQueryAggregates.keys().next().value;
      if (oldestKey) {
        slowQueryAggregates.delete(oldestKey);
      }
    }

    slowQueryAggregates.set(queryKey, {
      model,
      operation,
      count: 1,
      maxDuration: duration,
      totalDuration: duration,
      lastDuration: duration,
    });
    return;
  }

  current.count += 1;
  current.maxDuration = Math.max(current.maxDuration, duration);
  current.totalDuration += duration;
  current.lastDuration = duration;
  slowQueryAggregates.delete(queryKey);
  slowQueryAggregates.set(queryKey, current);
}

function flushTopNSlowQueries(): void {
  if (slowQueryAggregates.size === 0) {
    return;
  }

  const rows = Array.from(slowQueryAggregates.entries())
    .map(([queryKey, row]) => ({
      queryKey,
      count: row.count,
      maxDuration: row.maxDuration,
      avgDuration: Math.round(row.totalDuration / row.count),
      lastDuration: row.lastDuration,
    }))
    .sort((a, b) => {
      if (b.maxDuration !== a.maxDuration) {
        return b.maxDuration - a.maxDuration;
      }
      return b.count - a.count;
    })
    .slice(0, SLOW_QUERY_TOP_N);

  logger.warn("SlowQuery", `Top ${SLOW_QUERY_TOP_N} slow queries in last ${Math.round(
    SLOW_QUERY_TOP_N_WINDOW_MS / 1000
  )}s`, {
    mode: "top-n",
    topQueries: rows,
  });

  slowQueryAggregates.clear();
}

function cleanupSlowQueryLogStates(now = Date.now()): void {
  if (slowQueryLogStates.size === 0) {
    return;
  }

  for (const [queryKey, state] of slowQueryLogStates.entries()) {
    if (now - state.lastSeenAt > SLOW_QUERY_LOG_STATE_TTL_MS) {
      slowQueryLogStates.delete(queryKey);
    }
  }
}

function ensureStatesCleanupTimer(): void {
  if (statesCleanupTimer) {
    return;
  }

  statesCleanupTimer = setInterval(() => {
    cleanupSlowQueryLogStates();
  }, SLOW_QUERY_LOG_STATE_TTL_MS);

  if (statesCleanupTimer.unref) {
    statesCleanupTimer.unref();
  }
}

function ensureTopNFlushTimer(): void {
  if (SLOW_QUERY_TOP_N <= 0 || topNFlushTimer) {
    return;
  }

  const intervalMs = Math.max(1000, SLOW_QUERY_TOP_N_WINDOW_MS);
  topNFlushTimer = setInterval(() => {
    flushTopNSlowQueries();
  }, intervalMs);

  if (topNFlushTimer.unref) {
    topNFlushTimer.unref();
  }
}

function logSlowQueryWithThrottle(model: string | undefined, operation: string, duration: number): void {
  const queryKey = getQueryKey(model, operation);

  if (isIgnored(queryKey)) {
    return;
  }

  const now = Date.now();
  cleanupSlowQueryLogStates(now);
  const current = slowQueryLogStates.get(queryKey);

  if (!current || now - current.lastLoggedAt >= SLOW_QUERY_LOG_THROTTLE_MS) {
    if (current && current.suppressedCount > 0) {
      logger.warn("SlowQuery", `${queryKey} suppressed ${current.suppressedCount} repeated logs`, {
        model,
        action: operation,
        suppressedCount: current.suppressedCount,
        maxSuppressedDuration: current.maxSuppressedDuration,
      });
    }

    logger.warn("SlowQuery", `${queryKey} took ${duration}ms`, {
      model,
      action: operation,
      duration,
    });

    slowQueryLogStates.set(queryKey, {
      lastLoggedAt: now,
      lastSeenAt: now,
      suppressedCount: 0,
      maxSuppressedDuration: duration,
    });

    if (slowQueryLogStates.size > SLOW_QUERY_LOG_STATE_MAX_ENTRIES) {
      const oldestKey = slowQueryLogStates.keys().next().value;
      if (oldestKey) {
        slowQueryLogStates.delete(oldestKey);
      }
    }

    return;
  }

  current.suppressedCount += 1;
  current.lastSeenAt = now;
  current.maxSuppressedDuration = Math.max(current.maxSuppressedDuration, duration);
  slowQueryLogStates.delete(queryKey);
  slowQueryLogStates.set(queryKey, current);
}

declare global {
  // Avoid duplicate middleware in dev
  var slowQueryLoggerInitialized: boolean | undefined;
}

export function setupSlowQueryLogger(prisma: PrismaClient, thresholdMs = 1000): PrismaClient {
  ensureTopNFlushTimer();
  ensureStatesCleanupTimer();

  if (global.slowQueryLoggerInitialized) {
    return prisma;
  }
  global.slowQueryLoggerInitialized = true;

  const prismaWithExtension = prisma as unknown as {
    $extends?: (extension: unknown) => unknown;
  };

  if (typeof prismaWithExtension.$extends !== "function") {
    logger.warn("SlowQuery", "Prisma extension not supported in this runtime");
    return prisma;
  }

  const extended = prismaWithExtension.$extends({
    name: "slow-query-logger",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }: {
          model?: string;
          operation: string;
          args: unknown;
          query: (args: unknown) => Promise<unknown>;
        }) {
          const before = Date.now();
          const result = await query(args);
          const duration = Date.now() - before;

          recordQueryDuration(duration);

          if (duration >= thresholdMs) {
            if (SLOW_QUERY_TOP_N > 0) {
              recordSlowQueryAggregate(model, operation, duration);
            } else {
              logSlowQueryWithThrottle(model, operation, duration);
            }
          }

          return result;
        },
      },
    },
  });

  return extended as PrismaClient;
}
