import { PrismaClient } from "@prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import * as path from "path";

// 使用單例模式確保只有一個 Prisma Client 實例
declare global {
  var prisma: PrismaClient | undefined;
}

// 取得資料庫 URL（預設使用本地 SQLite）
const dbPath = path.resolve(__dirname, "../../prisma/dev.db");
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

  adapter = new PrismaLibSql({
    url: databaseUrl,
    authToken: authToken,
  });

  // 注意：Turso 的連線池由服務端自動管理，客戶端無需配置
} else {
  // 開發環境：使用本地原生 SQLite (避免 Adapter 版本相容問題)
  console.log("[DEBUG] 使用原生 Prisma Client (本地 SQLite)");
}

const prismaOptions = {
  log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  adapter: adapter ?? null,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const prisma = global.prisma || new PrismaClient(prismaOptions as any);

if (process.env.NODE_ENV !== "production") {
  global.prisma = prisma;
}

export default prisma;
