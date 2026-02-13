import type { PrismaClient } from "@prisma/client";
import { logger } from "../utils/logger";
import { recordQueryDuration } from "./query-metrics";

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
            logger.warn("SlowQuery", `${model ?? "Raw"}.${operation} took ${duration}ms`, {
              model,
              action: operation,
              duration,
            });
          }

          return result;
        },
      },
    },
  });

  return extended as PrismaClient;
}
