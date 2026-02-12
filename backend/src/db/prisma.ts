import { PrismaClient } from "@prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import * as path from "path";
import { setupSlowQueryLogger } from "./slow-query-logger";
import { logger } from "../utils/logger";

// 使用單例模式確保只有一個 Prisma Client 實例
declare global {
  var prisma: PrismaClient | undefined;
}

// 取得資料庫 URL（預設使用本地 SQLite）
const dbPath = path.resolve(__dirname, "../../prisma/dev.db");
// Revert: 恢復預設連線限制。SQLite 即使在 WAL 模式下，過多的連線池也可能導致鎖競爭惡化。
const databaseUrl = process.env.DATABASE_URL || `file:${dbPath}`;
const authToken = process.env.TURSO_AUTH_TOKEN;

// 判斷是否使用 Turso 雲端資料庫（URL 以 libsql:// 開頭）
const isTurso = databaseUrl.startsWith("libsql://");

logger.info("Prisma", `資料庫模式: ${isTurso ? "Turso 雲端" : "本地 SQLite"}`);

// 建立 Prisma adapter
let adapter: PrismaLibSql | null = null;

if (isTurso && authToken) {
  logger.info("Prisma", "使用 Turso 雲端資料庫");

  const adapterConfig = {
    url: databaseUrl,
    authToken: authToken,
  };

  if (process.env.NODE_ENV === "development") {
    logger.debug("Prisma", `databaseUrl = ${databaseUrl.substring(0, 30)}...`);
    logger.debug("Prisma", `authToken length = ${authToken?.length || 0}`);
  }

  adapter = new PrismaLibSql(adapterConfig);

  logger.info("Prisma", "Turso 連線配置完成");
} else {
  if (process.env.NODE_ENV === "development") {
    logger.debug("Prisma", "使用原生 Prisma Client (本地 SQLite)");
  }
}

const prismaOptions = {
  log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  adapter: adapter ?? null,
  // 注意：使用 Driver Adapter 時，datasource URL 在 adapter 中設定，不能在這裡重複設定
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const prisma = global.prisma || new PrismaClient(prismaOptions as any);

setupSlowQueryLogger(prisma);

if (process.env.NODE_ENV !== "production") {
  global.prisma = prisma;
}

// 連線狀態追蹤
let isConnectionWarmed = false;
let sqlitePragmasApplied = false;
let keepAliveStarted = false;
let shutdownHooksRegistered = false;

async function applyLocalSqlitePragmas(): Promise<void> {
  if (isTurso || sqlitePragmasApplied) {
    return;
  }

  try {
    await prisma.$executeRawUnsafe("PRAGMA journal_mode=WAL;");
    await prisma.$executeRawUnsafe("PRAGMA busy_timeout=5000;");
    await prisma.$executeRawUnsafe("PRAGMA synchronous=NORMAL;");
    sqlitePragmasApplied = true;
    logger.info("Prisma", "已套用本機 SQLite PRAGMA (WAL/busy_timeout/synchronous)");
  } catch (error) {
    logger.warn("Prisma", `套用本機 SQLite PRAGMA 失敗: ${error instanceof Error ? error.message : error}`);
  }
}

/**
 * 預熱資料庫連線
 * 在應用啟動時調用，避免 Job 執行時冷啟動超時
 * Turso 雲端資料庫可能需要 10-15 秒從休眠狀態喚醒
 */
export async function warmupConnection(maxRetries = 3, timeoutMs = 15000): Promise<boolean> {
  if (isConnectionWarmed) {
    logger.info("Prisma", "連線已預熱，跳過");
    return true;
  }

  logger.info("Prisma", "開始預熱連線...");

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await applyLocalSqlitePragmas();

      const result = await Promise.race([
        prisma.$queryRaw`SELECT 1 as ping`,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`連線超時 (${timeoutMs}ms)`)), timeoutMs)
        ),
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
    }
  }

  logger.error("Prisma", `連線預熱失敗，已重試 ${maxRetries} 次`);
  return false;
}

function startConnectionKeepAlive(): void {
  if (!isTurso || keepAliveStarted) {
    return;
  }

  const keepAliveMinutes = Number(process.env.PRISMA_KEEP_ALIVE_MINUTES || 5);
  const intervalMs = Math.max(1, keepAliveMinutes) * 60 * 1000;

  const timer = setInterval(async () => {
    try {
      await prisma.$queryRaw`SELECT 1 as ping`;
    } catch (error) {
      isConnectionWarmed = false;
      logger.warn("Prisma", `keep-alive ping failed: ${error instanceof Error ? error.message : error}`);
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
    isTurso,
    keepAliveStarted,
  };
}

export default prisma;
