/**
 * 清除所有測試用的 StreamSession 資料
 * 保留實況主和頻道資料（這些是真實的）
 *
 * 使用方式：
 *   npx ts-node clear-test-sessions.ts
 */

import { prisma } from './src/db/prisma';

async function main() {
  console.log('🗑️  開始清除測試開台資料...\n');

  try {
    // 清除所有 StreamSession
    const deletedSessions = await prisma.streamSession.deleteMany({});
    console.log(`✅ 已清除 ${deletedSessions.count} 筆開台紀錄`);

    // 清除相關的每日統計（因為這些是基於 StreamSession 計算的）
    const deletedDailyStats = await prisma.channelDailyStat.deleteMany({});
    console.log(`✅ 已清除 ${deletedDailyStats.count} 筆每日統計`);

    // 清除觀眾頻道每日統計
    const deletedViewerStats = await prisma.viewerChannelDailyStat.deleteMany({});
    console.log(`✅ 已清除 ${deletedViewerStats.count} 筆觀眾統計`);

    console.log('\n✨ 清除完成！');
    console.log('📝 注意：實況主和頻道資料已保留，僅清除開台紀錄和統計資料');
    console.log('💡 Dashboard 現在應該會顯示空狀態');
  } catch (error) {
    console.error('❌ 清除失敗:', error);
    throw error;
  }
}

main()
  .catch((e) => {
    console.error('❌ 執行失敗:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

