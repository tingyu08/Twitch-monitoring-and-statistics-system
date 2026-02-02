/**
 * 測試 Turso 資料庫連線
 * 用法: node scripts/test-db-connection.js
 */

const { PrismaClient } = require("@prisma/client");
const { PrismaLibSql } = require("@prisma/adapter-libsql");

// 載入環境變數
require("dotenv").config();

const databaseUrl = process.env.DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

console.log("=== Turso 連線測試 ===\n");
console.log("DATABASE_URL:", databaseUrl ? `${databaseUrl.substring(0, 30)}...` : "❌ 未設定");
console.log("TURSO_AUTH_TOKEN:", authToken ? `設定完成 (長度: ${authToken.length})` : "❌ 未設定");
console.log("isTurso:", databaseUrl?.startsWith("libsql://") || false);
console.log("");

if (!databaseUrl || !databaseUrl.startsWith("libsql://")) {
  console.error("❌ DATABASE_URL 未設定或格式錯誤（必須以 libsql:// 開頭）");
  process.exit(1);
}

if (!authToken) {
  console.error("❌ TURSO_AUTH_TOKEN 未設定");
  process.exit(1);
}

// 建立連線
const adapter = new PrismaLibSql({
  url: databaseUrl,
  authToken: authToken,
});

const prisma = new PrismaClient({ adapter });

async function testConnection() {
  const startTime = Date.now();
  
  try {
    console.log("正在連線到 Turso...");
    
    // 設定 30 秒 timeout
    const result = await Promise.race([
      prisma.$queryRaw`SELECT 1 as ping`,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("連線超時 (30秒)")), 30000)
      ),
    ]);
    
    const duration = Date.now() - startTime;
    console.log(`✅ 連線成功！(${duration}ms)`);
    console.log("回應:", result);
    
    // 測試查詢 streamers 表
    console.log("\n測試查詢資料表...");
    const count = await prisma.streamer.count();
    console.log(`✅ 資料表存在，共有 ${count} 筆 streamer 記錄`);
    
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`❌ 連線失敗 (${duration}ms)`);
    console.error("錯誤:", error.message);
    
    if (error.message.includes("SQLITE_CANTOPEN")) {
      console.error("\n💡 這通常表示 DATABASE_URL 路徑錯誤或無權限存取");
    } else if (error.message.includes("timeout") || error.message.includes("ETIMEDOUT")) {
      console.error("\n💡 資料庫連線超時，可能是：");
      console.error("   1. Turso 資料庫處於休眠狀態（需要更長時間喚醒）");
      console.error("   2. 網路連線問題");
      console.error("   3. DATABASE_URL 或 TURSO_AUTH_TOKEN 錯誤");
    } else if (error.message.includes("unauthorized") || error.message.includes("authentication")) {
      console.error("\n💡 認證失敗，請檢查 TURSO_AUTH_TOKEN 是否正確");
    }
    
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

testConnection();
