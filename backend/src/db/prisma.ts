import { PrismaClient } from "@prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { createClient } from "@libsql/client";
import * as path from "path";

// 使用單例模式確保只有一個 Prisma Client 實例
declare global {
  var prisma: PrismaClient | undefined;
}

// 判斷是否使用 Turso 雲端資料庫
const isTurso = !!process.env.TURSO_DATABASE_URL;

let adapter: PrismaLibSql;

if (isTurso) {
  // 生產環境：使用 Turso 雲端資料庫
  console.log("[INFO] 使用 Turso 雲端資料庫");
  const client = createClient({
    url: process.env.TURSO_DATABASE_URL || "",
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  adapter = new PrismaLibSql(
    client as unknown as ConstructorParameters<typeof PrismaLibSql>[0]
  );
} else {
  // 開發環境：使用本地 SQLite 檔案
  const dbPath = path.resolve(__dirname, "../../prisma/dev.db");
  const databaseUrl = process.env.DATABASE_URL || `file:${dbPath}`;
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
