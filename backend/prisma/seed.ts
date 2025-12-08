/**
 * 資料庫 Seed 腳本
 * 用於建立測試資料,包括實況主、頻道、開台紀錄和每日統計
 *
 * 執行方式：npx ts-node prisma/seed.ts
 */

import { PrismaClient } from '@prisma/client';
import { PrismaLibSql } from '@prisma/adapter-libsql';
import * as path from 'path';

// 建立 libSQL 適配器
const databaseUrl = process.env.DATABASE_URL || `file:${path.join(__dirname, './dev.db')}`;
const adapter = new PrismaLibSql({ url: databaseUrl });

const prisma = new PrismaClient({ adapter });

// 輔助函數：生成隨機日期範圍內的日期
function randomDateInRange(startDate: Date, endDate: Date): Date {
  const start = startDate.getTime();
  const end = endDate.getTime();
  return new Date(start + Math.random() * (end - start));
}

// 輔助函數：生成隨機整數
function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// 輔助函數：取得日期的 YYYY-MM-DD 格式
function getDateOnly(date: Date): Date {
  return new Date(date.toISOString().split('T')[0]);
}

async function main() {
  console.log('🌱 開始建立測試資料...');

  // 清除現有資料（開發環境使用）
  console.log('🗑️ 清除現有資料...');
  await prisma.viewerChannelDailyStat.deleteMany();
  await prisma.channelDailyStat.deleteMany();
  await prisma.streamSession.deleteMany();
  await prisma.twitchToken.deleteMany();
  await prisma.channel.deleteMany();
  await prisma.viewer.deleteMany();
  await prisma.streamer.deleteMany();

  // 建立測試實況主
  console.log('👤 建立測試實況主...');
  const streamer = await prisma.streamer.create({
    data: {
      twitchUserId: 'test_twitch_123',
      displayName: 'TestStreamer',
      avatarUrl: 'https://static-cdn.jtvnw.net/jtv_user_pictures/test-profile_image-300x300.png',
      email: 'test@example.com',
    },
  });
  console.log(`  ✅ 建立實況主: ${streamer.displayName} (ID: ${streamer.id})`);

  // 建立頻道
  console.log('📺 建立頻道...');
  const channel = await prisma.channel.create({
    data: {
      streamerId: streamer.id,
      twitchChannelId: 'test_twitch_123',
      channelName: 'teststreamer',
      channelUrl: 'https://www.twitch.tv/teststreamer',
    },
  });
  console.log(`  ✅ 建立頻道: ${channel.channelName}`);

  // 建立過去 90 天的開台紀錄
  console.log('🎮 建立開台紀錄...');
  const now = new Date();
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  
  const sessions: Array<{
    channelId: string;
    twitchStreamId: string;
    startedAt: Date;
    endedAt: Date;
    durationSeconds: number;
    title: string;
    category: string;
    avgViewers: number;
    peakViewers: number;
  }> = [];

  // 每週大約 3-5 次開台
  const totalWeeks = 13; // 約 90 天
  const categories = ['Just Chatting', 'League of Legends', 'Valorant', 'Minecraft', 'Art'];
  
  for (let week = 0; week < totalWeeks; week++) {
    const sessionsThisWeek = randomInt(3, 5);
    
    for (let i = 0; i < sessionsThisWeek; i++) {
      const weekStart = new Date(ninetyDaysAgo.getTime() + week * 7 * 24 * 60 * 60 * 1000);
      const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
      
      const startedAt = randomDateInRange(weekStart, weekEnd);
      const durationHours = randomInt(2, 6); // 2-6 小時
      const durationSeconds = durationHours * 60 * 60;
      const endedAt = new Date(startedAt.getTime() + durationSeconds * 1000);
      
      const avgViewers = randomInt(50, 500);
      
      sessions.push({
        channelId: channel.id,
        twitchStreamId: `stream_${week}_${i}_${Date.now()}`,
        startedAt,
        endedAt,
        durationSeconds,
        title: `Day ${week * 7 + i + 1} 開台！`,
        category: categories[randomInt(0, categories.length - 1)],
        avgViewers,
        peakViewers: avgViewers + randomInt(50, 200),
      });
    }
  }

  // 批量建立開台紀錄
  await prisma.streamSession.createMany({
    data: sessions,
  });
  console.log(`  ✅ 建立 ${sessions.length} 筆開台紀錄`);

  // 建立每日統計資料
  console.log('📊 建立每日統計資料...');
  const dailyStats: Array<{
    channelId: string;
    date: Date;
    streamSeconds: number;
    streamCount: number;
    avgViewers: number;
    peakViewers: number;
  }> = [];

  // 按日期分組計算統計
  const sessionsByDate = new Map<string, typeof sessions>();
  
  for (const session of sessions) {
    const dateKey = session.startedAt.toISOString().split('T')[0];
    if (!sessionsByDate.has(dateKey)) {
      sessionsByDate.set(dateKey, []);
    }
    sessionsByDate.get(dateKey)!.push(session);
  }

  for (const [dateStr, daySessions] of sessionsByDate) {
    const totalSeconds = daySessions.reduce((sum, s) => sum + s.durationSeconds, 0);
    const avgViewers = Math.round(
      daySessions.reduce((sum, s) => sum + s.avgViewers, 0) / daySessions.length
    );
    const peakViewers = Math.max(...daySessions.map(s => s.peakViewers));

    dailyStats.push({
      channelId: channel.id,
      date: new Date(dateStr),
      streamSeconds: totalSeconds,
      streamCount: daySessions.length,
      avgViewers,
      peakViewers,
    });
  }

  await prisma.channelDailyStat.createMany({
    data: dailyStats,
  });
  console.log(`  ✅ 建立 ${dailyStats.length} 筆每日統計`);

  // 建立測試觀眾
  console.log('👥 建立測試觀眾...');
  const viewers = await prisma.viewer.createMany({
    data: [
      { twitchUserId: 'viewer_1', displayName: 'Viewer1' },
      { twitchUserId: 'viewer_2', displayName: 'Viewer2' },
      { twitchUserId: 'viewer_3', displayName: 'Viewer3' },
    ],
  });
  console.log(`  ✅ 建立 ${viewers.count} 個測試觀眾`);

  // 統計摘要
  console.log('\n📈 測試資料摘要:');
  console.log(`  - 實況主: 1`);
  console.log(`  - 頻道: 1`);
  console.log(`  - 開台紀錄: ${sessions.length} 筆`);
  console.log(`  - 每日統計: ${dailyStats.length} 筆`);
  console.log(`  - 觀眾: 3`);
  
  const totalHours = sessions.reduce((sum, s) => sum + s.durationSeconds, 0) / 3600;
  console.log(`  - 總開台時數: ${totalHours.toFixed(1)} 小時`);
  console.log(`  - 平均單場時長: ${(totalHours / sessions.length).toFixed(1)} 小時`);

  console.log('\n✨ 測試資料建立完成！');
}

main()
  .catch((e) => {
    console.error('❌ Seed 執行失敗:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
