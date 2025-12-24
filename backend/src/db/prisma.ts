import { PrismaClient } from "@prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { createClient } from "@libsql/client";
import * as path from "path";

// 使用單例模式確保只有一個 Prisma Client 實例
declare global {
  var prisma: PrismaClient | undefined;
}

// 取得資料庫 URL（預設使用本地 SQLite）
const dbPath = path.resolve(__dirname, "../../prisma/dev.db");
const databaseUrl = process.env.DATABASE_URL || `file:${dbPath}`;

// 判斷是否使用 Turso 雲端資料庫（URL 以 libsql:// 開頭）
const isTurso = databaseUrl.startsWith("libsql://");

let adapter: PrismaLibSql;

if (isTurso) {
  // 生產環境：使用 Turso 雲端資料庫
  console.log("[INFO] 使用 Turso 雲端資料庫");
  const client = createClient({
    url: databaseUrl,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  adapter = new PrismaLibSql(
    client as unknown as ConstructorParameters<typeof PrismaLibSql>[0]
  );
} else {
  // 開發環境：使用本地 SQLite 檔案
  console.log("[DEBUG] 使用本地資料庫:", databaseUrl);
  adapter = new PrismaLibSql({ url: databaseUrl });
}

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
