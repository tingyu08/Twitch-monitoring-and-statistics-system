// Prisma 7.x Configuration
import "dotenv/config";
import { defineConfig } from "prisma/config";
import path from "path";

// 預設使用本地 SQLite，如果 DATABASE_URL 設定了則使用它
const defaultDbUrl = `file:${path.join(__dirname, "prisma", "dev.db")}`;
const databaseUrl = process.env.DATABASE_URL || defaultDbUrl;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: databaseUrl,
  },
});
