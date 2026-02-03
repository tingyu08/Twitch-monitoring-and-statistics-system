import type { PrismaClient} from "@prisma/client";
import { logger } from "../utils/logger";
import { recordQueryDuration } from "./query-metrics";

declare global {
  // Avoid duplicate middleware in dev
  var slowQueryLoggerInitialized: boolean | undefined;
}

type MiddlewareParams = {
  model?: string;
  action: string;
};

export function setupSlowQueryLogger(prisma: PrismaClient, thresholdMs = 1000): void {
  if (global.slowQueryLoggerInitialized) {
    return;
  }
  global.slowQueryLoggerInitialized = true;

  const prismaWithMiddleware = prisma as unknown as {
    $use?: (
      fn: (params: MiddlewareParams, next: (params: MiddlewareParams) => Promise<unknown>) => Promise<unknown>
    ) => void;
  };

  if (typeof prismaWithMiddleware.$use !== "function") {
    logger.warn("SlowQuery", "Prisma middleware not supported in this runtime");
    return;
  }

  prismaWithMiddleware.$use(async (params, next) => {
    const before = Date.now();
    const result = await next(params);
    const duration = Date.now() - before;

    recordQueryDuration(duration);

    if (duration >= thresholdMs) {
      logger.warn(
        "SlowQuery",
        `${params.model ?? "Raw"}.${params.action} took ${duration}ms`,
        {
          model: params.model,
          action: params.action,
          duration,
        }
      );
    }

    return result;
  });
}
