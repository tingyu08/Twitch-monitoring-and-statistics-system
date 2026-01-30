import { PrismaClient } from "@prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import * as path from "path";

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

  // 直接傳配置物件給 PrismaLibSql adapter
  adapter = new PrismaLibSql({
    url: databaseUrl,
    authToken: authToken,
  });

  console.log("[INFO] Turso 連線配置完成");
} else {
  // 開發環境：使用本地原生 SQLite (避免 Adapter 版本相容問題)
  console.log("[DEBUG] 使用原生 Prisma Client (本地 SQLite)");
}

const prismaOptions = {
  log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  adapter: adapter ?? null,
  // 注意：使用 Driver Adapter 時，datasource URL 在 adapter 中設定，不能在這裡重複設定
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const prisma = global.prisma || new PrismaClient(prismaOptions as any);

if (process.env.NODE_ENV !== "production") {
  global.prisma = prisma;
}

export default prisma;
