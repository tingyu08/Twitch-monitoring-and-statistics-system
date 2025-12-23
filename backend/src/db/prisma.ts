import { PrismaClient } from "@prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import * as path from "path";

// 使用單例模式確保只有一個 Prisma Client 實例
declare global {
  var prisma: PrismaClient | undefined;
}

// 建立 libSQL 適配器（用於 SQLite）
// 使用絕對路徑確保在任何執行環境下都能找到正確的資料庫檔案
const dbPath = path.resolve(__dirname, "../../prisma/dev.db");
const databaseUrl = process.env.DATABASE_URL || `file:${dbPath}`;
console.log("[DEBUG] Database URL:", databaseUrl);
console.log("[DEBUG] __dirname:", __dirname);
console.log("[DEBUG] Resolved DB path:", dbPath);
const adapter = new PrismaLibSql({ url: databaseUrl });

export const prisma =
  global.prisma ||
  new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  global.prisma = prisma;
}

export default prisma;
