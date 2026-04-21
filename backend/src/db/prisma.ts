import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { setupSlowQueryLogger } from "./slow-query-logger";
import { logger } from "../utils/logger";

// 使用單例模式確保只有一個 Prisma Client 實例
declare global {
  var prisma: PrismaClient | undefined;
}

// 取得資料庫 URL（必須設定 DATABASE_URL 環境變數）
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL 環境變數未設定，請設定 PostgreSQL 連線字串");
}

logger.info("Prisma", "資料庫模式: PostgreSQL (Supabase)");

if (process.env.NODE_ENV === "development") {
  const safeUrl = databaseUrl.replace(/:\/\/[^@]+@/, "://***@");
  logger.debug("Prisma", `databaseUrl = ${safeUrl}`);
}

const adapter = new PrismaPg({ connectionString: databaseUrl });

const prismaOptions = {
  adapter,
  log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const basePrisma = global.prisma || new PrismaClient(prismaOptions as any);

const SLOW_QUERY_THRESHOLD_MS = Number(process.env.SLOW_QUERY_THRESHOLD_MS || 1000);
export const prisma = setupSlowQueryLogger(basePrisma, SLOW_QUERY_THRESHOLD_MS);

if (process.env.NODE_ENV !== "production") {
  global.prisma = prisma;
}

// 連線狀態追蹤
let isConnectionWarmed = false;
let keepAliveStarted = false;
let shutdownHooksRegistered = false;
let warmupPromise: Promise<boolean> | null = null;

/**
 * 預熱資料庫連線
 * 在應用啟動時調用，避免 Job 執行時冷啟動超時
 */
export async function warmupConnection(maxRetries = 3, timeoutMs = 15000): Promise<boolean> {
  if (isConnectionWarmed) {
    logger.info("Prisma", "連線已預熱，跳過");
    return true;
  }

  if (warmupPromise) {
    logger.info("Prisma", "連線預熱進行中，等待既有任務完成");
    return warmupPromise;
  }

  warmupPromise = (async () => {
    logger.info("Prisma", "開始預熱連線...");

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      let timeoutTimer: NodeJS.Timeout | null = null;
      try {
        const result = await Promise.race([
          prisma.$queryRaw`SELECT 1 as ping`,
          new Promise<never>((_, reject) => {
            timeoutTimer = setTimeout(() => reject(new Error(`連線超時 (${timeoutMs}ms)`)), timeoutMs);
            if (timeoutTimer.unref) {
              timeoutTimer.unref();
            }
          }),
        ]);

        if (result) {
          isConnectionWarmed = true;
          startConnectionKeepAlive();
          registerShutdownHooks();
          logger.info("Prisma", `連線預熱成功 (第 ${attempt} 次嘗試)`);
          return true;
        }
      } catch (error) {
        logger.warn(
          "Prisma",
          `連線預熱失敗 (${attempt}/${maxRetries}): ${error instanceof Error ? error.message : error}`
        );

        if (attempt < maxRetries) {
          // 指數退避：1s, 2s, 4s...
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
          logger.info("Prisma", `等待 ${delay}ms 後重試...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      } finally {
        if (timeoutTimer) {
          clearTimeout(timeoutTimer);
        }
      }
    }

    logger.error("Prisma", `連線預熱失敗，已重試 ${maxRetries} 次`);
    return false;
  })();

  try {
    return await warmupPromise;
  } finally {
    warmupPromise = null;
  }
}

function startConnectionKeepAlive(): void {
  if (keepAliveStarted) {
    return;
  }

  const keepAliveMinutes = Number(process.env.PRISMA_KEEP_ALIVE_MINUTES || 5);
  const keepAliveTimeoutMs = Number(process.env.PRISMA_KEEP_ALIVE_TIMEOUT_MS || 15000);
  const intervalMs = Math.max(1, keepAliveMinutes) * 60 * 1000;

  const timer = setInterval(async () => {
    let timeoutTimer: NodeJS.Timeout | null = null;
    try {
      await Promise.race([
        prisma.$queryRaw`SELECT 1 as ping`,
        new Promise<never>((_, reject) => {
          timeoutTimer = setTimeout(
            () => reject(new Error(`keep-alive timeout (${keepAliveTimeoutMs}ms)`)),
            keepAliveTimeoutMs
          );
          if (timeoutTimer.unref) {
            timeoutTimer.unref();
          }
        }),
      ]);
      // ping 成功：若先前曾因失敗設為 false，在此恢復連線就緒狀態
      if (!isConnectionWarmed) {
        isConnectionWarmed = true;
        logger.info("Prisma", "keep-alive ping 恢復成功，連線已重新就緒");
      }
    } catch (error) {
      isConnectionWarmed = false;
      logger.warn("Prisma", `keep-alive ping failed: ${error instanceof Error ? error.message : error}`);
    } finally {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
      }
    }
  }, intervalMs);

  if (timer.unref) {
    timer.unref();
  }

  keepAliveStarted = true;
}

function registerShutdownHooks(): void {
  if (shutdownHooksRegistered) {
    return;
  }

  const gracefulDisconnect = async () => {
    try {
      await prisma.$disconnect();
    } catch (error) {
      logger.warn("Prisma", `disconnect failed: ${error instanceof Error ? error.message : error}`);
    }
  };

  // 只保留 beforeExit，避免與 server.ts 的 SIGINT/SIGTERM 優雅關閉流程互相競態。
  process.once("beforeExit", gracefulDisconnect);
  shutdownHooksRegistered = true;
}

/**
 * 檢查連線是否已預熱
 */
export function isConnectionReady(): boolean {
  return isConnectionWarmed;
}

// 連線健康度追蹤
let consecutiveFailures = 0;
const MAX_CONSECUTIVE_FAILURES = 3;

/**
 * 連線健康檢查 (帶背壓治理)
 * - 成功: 重置失敗計數器
 * - 連續失敗超過閾值: 觸發重連 warmup 並加入指數退避
 */
export async function healthCheck(): Promise<{ healthy: boolean; latencyMs: number }> {
  const start = Date.now();
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1 as ping`,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("health check timeout")), 5000)
      ),
    ]);
    const latencyMs = Date.now() - start;
    consecutiveFailures = 0;

    if (latencyMs > 3000) {
      logger.warn("Prisma", `Health check slow: ${latencyMs}ms`);
    }
    return { healthy: true, latencyMs };
  } catch (error) {
    consecutiveFailures++;
    const latencyMs = Date.now() - start;
    logger.warn(
      "Prisma",
      `Health check failed (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}): ${
        error instanceof Error ? error.message : error
      }`
    );

    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      logger.error("Prisma", "連續健康檢查失敗，嘗試重新預熱連線...");
      isConnectionWarmed = false;
      // 指數退避重連
      const backoffMs = Math.min(1000 * Math.pow(2, consecutiveFailures - MAX_CONSECUTIVE_FAILURES), 10000);
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
      await warmupConnection(2, 10000);
    }

    return { healthy: false, latencyMs };
  }
}

/**
 * 取得連線治理狀態
 */
export function getConnectionGovernanceStatus() {
  return {
    isWarmed: isConnectionWarmed,
    consecutiveFailures,
    keepAliveStarted,
  };
}

export default prisma;
