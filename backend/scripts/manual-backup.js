/**
 * 手動備份資料庫（緊急用）
 * 將關鍵資料匯出為 JSON 格式
 */

const { createClient } = require('@libsql/client');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function manualBackup() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(__dirname, '..', 'backups');

  // 建立備份目錄
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  console.log('🔄 開始緊急備份...\n');

  const client = createClient({
    url: process.env.DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  try {
    const backup = {
      timestamp: new Date().toISOString(),
      version: '1.0',
      data: {}
    };

    // 備份關鍵資料表
    const tables = [
      'viewer_channel_messages',
      'viewer_channel_daily_stats',
      'viewer_channel_lifetime_stats',
      'viewers',
      'channels',
      'streamers'
    ];

    for (const table of tables) {
      console.log(`📦 備份 ${table}...`);
      const result = await client.execute(`SELECT * FROM ${table}`);
      backup.data[table] = {
        count: result.rows.length,
        rows: result.rows
      };
      console.log(`   ✅ ${result.rows.length} 筆記錄`);
    }

    // 寫入備份檔案
    const backupFile = path.join(backupDir, `backup_${timestamp}.json`);
    fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2));

    const fileSize = (fs.statSync(backupFile).size / 1024 / 1024).toFixed(2);

    console.log('\n' + '='.repeat(70));
    console.log('✅ 備份完成！');
    console.log('='.repeat(70));
    console.log(`📁 備份檔案: ${backupFile}`);
    console.log(`📊 檔案大小: ${fileSize} MB`);
    console.log(`⏰ 備份時間: ${backup.timestamp}`);
    console.log('\n💡 建議將此檔案複製到安全的地方（如 Google Drive、Dropbox）');
    console.log('='.repeat(70));

  } catch (error) {
    console.error('❌ 備份失敗:', error.message);
  } finally {
    client.close();
  }
}

manualBackup().catch(console.error);
