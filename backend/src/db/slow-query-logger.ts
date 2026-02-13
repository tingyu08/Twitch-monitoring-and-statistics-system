import type { PrismaClient } from "@prisma/client";
import { logger } from "../utils/logger";
import { recordQueryDuration } from "./query-metrics";

type SlowQueryLogState = {
  lastLoggedAt: number;
  suppressedCount: number;
  maxSuppressedDuration: number;
};

const SLOW_QUERY_LOG_THROTTLE_MS = Number(process.env.SLOW_QUERY_LOG_THROTTLE_MS || 120000);
const SLOW_QUERY_LOG_IGNORE_KEYS = new Set(
  (process.env.SLOW_QUERY_LOG_IGNORE || "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
);

const slowQueryLogStates = new Map<string, SlowQueryLogState>();

function logSlowQueryWithThrottle(model: string | undefined, operation: string, duration: number): void {
  const queryKey = `${model ?? "Raw"}.${operation}`;

  if (SLOW_QUERY_LOG_IGNORE_KEYS.has(queryKey)) {
    return;
  }

  const now = Date.now();
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
      suppressedCount: 0,
      maxSuppressedDuration: duration,
    });

    return;
  }

  current.suppressedCount += 1;
  current.maxSuppressedDuration = Math.max(current.maxSuppressedDuration, duration);
  slowQueryLogStates.set(queryKey, current);
}

declare global {
  // Avoid duplicate middleware in dev
  var slowQueryLoggerInitialized: boolean | undefined;
}

export function setupSlowQueryLogger(prisma: PrismaClient, thresholdMs = 1000): PrismaClient {
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
            logSlowQueryWithThrottle(model, operation, duration);
          }

          return result;
        },
      },
    },
  });

  return extended as PrismaClient;
}
