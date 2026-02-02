/**
 * 執行手動 Migration SQL 到 Turso 資料庫
 * 用法: node scripts/execute-migration.js
 */

const { createClient } = require("@libsql/client");
const fs = require("fs");
const path = require("path");

// 載入環境變數
require("dotenv").config();

const databaseUrl = process.env.DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

console.log("=== 執行 Migration SQL ===\n");
console.log("DATABASE_URL:", databaseUrl ? `${databaseUrl.substring(0, 30)}...` : "未設定");
console.log("");

if (!databaseUrl || !databaseUrl.startsWith("libsql://")) {
  console.error("DATABASE_URL 未設定或格式錯誤");
  process.exit(1);
}

if (!authToken) {
  console.error("TURSO_AUTH_TOKEN 未設定");
  process.exit(1);
}

// 建立 libsql client
const client = createClient({
  url: databaseUrl,
  authToken: authToken,
});

async function executeMigration() {
  try {
    // 讀取 migration SQL 檔案
    // 支援傳入參數指定要執行的 migration 檔案
    const migrationFile = process.argv[2] || "manual_add_viewer_channel_video.sql";
    const sqlPath = path.join(__dirname, "../prisma/migrations", migrationFile);
    const sql = fs.readFileSync(sqlPath, "utf-8");
    
    console.log("讀取 SQL 檔案:", sqlPath);
    console.log("");
    
    // 移除註解行，然後分割 SQL 語句
    const cleanedSql = sql
      .split("\n")
      .filter(line => !line.trim().startsWith("--"))
      .join("\n");
    
    const statements = cleanedSql
      .split(";")
      .map(s => s.trim())
      .filter(s => s.length > 0);
    
    console.log(`找到 ${statements.length} 個 SQL 語句\n`);
    
    // 逐一執行
    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];
      if (!stmt) continue;
      
      console.log(`[${i + 1}/${statements.length}] 執行:`);
      console.log(stmt.substring(0, 80) + (stmt.length > 80 ? "..." : ""));
      
      try {
        await client.execute(stmt);
        console.log("✅ 成功\n");
      } catch (error) {
        // 如果是 "table already exists" 或 "index already exists" 錯誤，視為成功
        if (error.message.includes("already exists")) {
          console.log("⚠️ 已存在，跳過\n");
        } else {
          throw error;
        }
      }
    }
    
    console.log("=== Migration 完成 ===");
    
    // 驗證表格是否建立成功
    console.log("\n驗證表格...");
    const result = await client.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='viewer_channel_videos'");
    
    if (result.rows.length > 0) {
      console.log("✅ viewer_channel_videos 表格已建立");
    } else {
      console.log("❌ viewer_channel_videos 表格未找到");
    }
    
  } catch (error) {
    console.error("❌ Migration 失敗:", error.message);
    process.exit(1);
  } finally {
    client.close();
  }
}

executeMigration();
