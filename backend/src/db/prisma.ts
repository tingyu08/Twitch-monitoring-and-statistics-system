import { PrismaClient } from "@prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import * as path from "path";
import { setupSlowQueryLogger } from "./slow-query-logger";

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

console.log(`[INFO] 資料庫模式: ${isTurso ? "Turso 雲端" : "本地 SQLite"}`);
console.log(`[INFO] DATABASE_URL: ${databaseUrl.substring(0, 30)}...`);

// 建立 Prisma adapter
let adapter: PrismaLibSql | null = null;

if (isTurso && authToken) {
  // 生產環境：使用 Turso 雲端資料庫
  console.log("[INFO] 使用 Turso 雲端資料庫");

  // 診斷日誌：確認變數值
  console.log("[DEBUG] databaseUrl =", databaseUrl);
  console.log("[DEBUG] authToken length =", authToken?.length || 0);
  console.log("[DEBUG] isTurso =", isTurso);

  // 直接傳配置物件給 PrismaLibSql adapter
  const adapterConfig = {
    url: databaseUrl,
    authToken: authToken,
  };

  console.log(
    "[DEBUG] Adapter config:",
    JSON.stringify({
      url: adapterConfig.url?.substring(0, 30) + "...",
      hasAuthToken: !!adapterConfig.authToken,
    })
  );

  adapter = new PrismaLibSql(adapterConfig);

  console.log("[INFO] Turso 連線配置完成");
} else {
  // 開發環境：使用本地原生 SQLite (避免 Adapter 版本相容問題)
  console.log("[DEBUG] 使用原生 Prisma Client (本地 SQLite)");
  console.log("[DEBUG] isTurso =", isTurso, "authToken =", !!authToken);
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
    console.log("[INFO] 已套用本機 SQLite PRAGMA (WAL/busy_timeout/synchronous)");
  } catch (error) {
    console.warn("[WARN] 套用本機 SQLite PRAGMA 失敗:", error);
  }
}

/**
 * 預熱資料庫連線
 * 在應用啟動時調用，避免 Job 執行時冷啟動超時
 * Turso 雲端資料庫可能需要 10-15 秒從休眠狀態喚醒
 */
export async function warmupConnection(maxRetries = 3, timeoutMs = 15000): Promise<boolean> {
  if (isConnectionWarmed) {
    console.log("[INFO] Prisma 連線已預熱，跳過");
    return true;
  }

  console.log("[INFO] 開始預熱 Prisma 連線...");

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
        console.log(`[INFO] ✅ Prisma 連線預熱成功 (第 ${attempt} 次嘗試)`);
        return true;
      }
    } catch (error) {
      console.warn(
        `[WARN] Prisma 連線預熱失敗 (${attempt}/${maxRetries}):`,
        error instanceof Error ? error.message : error
      );

      if (attempt < maxRetries) {
        // 指數退避：1s, 2s, 4s...
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
        console.log(`[INFO] 等待 ${delay}ms 後重試...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  console.error("[ERROR] ❌ Prisma 連線預熱失敗，已重試 " + maxRetries + " 次");
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
      console.warn("[WARN] Prisma keep-alive ping failed:", error);
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
      console.warn("[WARN] Prisma disconnect failed:", error);
    }
  };

  process.once("beforeExit", gracefulDisconnect);
  process.once("SIGINT", gracefulDisconnect);
  process.once("SIGTERM", gracefulDisconnect);
  shutdownHooksRegistered = true;
}

/**
 * 檢查連線是否已預熱
 */
export function isConnectionReady(): boolean {
  return isConnectionWarmed;
}

export default prisma;
