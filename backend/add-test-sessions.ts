/**
 * 為指定的 Streamer 建立測試 StreamSession 資料
 *
 * 使用方式：
 *   npx ts-node add-test-sessions.ts <streamerId>
 *
 * 如果不指定 streamerId，會列出所有可用的 Streamer
 */
import { prisma } from './src/db/prisma';

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomDateInRange(startDate: Date, endDate: Date): Date {
  const start = startDate.getTime();
  const end = endDate.getTime();
  return new Date(start + Math.random() * (end - start));
}

async function listStreamers() {
  console.log('\n=== Available Streamers ===\n');
  const streamers = await prisma.streamer.findMany({
    include: { channels: true }
  });

  if (streamers.length === 0) {
    console.log('No streamers found. Please login first to create a streamer record.');
    return;
  }

  for (const s of streamers) {
    const hasChannel = s.channels.length > 0;
    let sessionCount = 0;
    if (hasChannel) {
      sessionCount = await prisma.streamSession.count({
        where: { channelId: s.channels[0].id }
      });
    }
    console.log(`${s.displayName}`);
    console.log(`  Streamer ID: ${s.id}`);
    console.log(`  Has Channel: ${hasChannel ? 'Yes' : 'No'}`);
    console.log(`  Sessions: ${sessionCount}`);
    console.log('');
  }

  console.log('Usage: npx ts-node add-test-sessions.ts <streamerId>');
}

async function addTestSessions(streamerId: string) {
  console.log(`\nAdding test sessions for streamer: ${streamerId}\n`);

  // 1. 檢查 streamer 是否存在
  const streamer = await prisma.streamer.findUnique({
    where: { id: streamerId },
    include: { channels: true }
  });

  if (!streamer) {
    console.error('❌ Streamer not found!');
    return;
  }

  console.log(`Found streamer: ${streamer.displayName}`);

  // 2. 檢查或建立 Channel
  let channel = streamer.channels[0];
  if (!channel) {
    console.log('Creating channel...');
    channel = await prisma.channel.create({
      data: {
        streamerId: streamer.id,
        twitchChannelId: streamer.twitchUserId,
        channelName: streamer.displayName.toLowerCase(),
        channelUrl: `https://www.twitch.tv/${streamer.displayName.toLowerCase()}`,
      }
    });
    console.log(`✅ Created channel: ${channel.channelName}`);
  } else {
    console.log(`Using existing channel: ${channel.channelName}`);
  }

  // 3. 建立過去 90 天的開台紀錄
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

  const categories = ['Just Chatting', 'League of Legends', 'Valorant', 'Minecraft', 'Art'];
  const totalWeeks = 13;

  for (let week = 0; week < totalWeeks; week++) {
    const sessionsThisWeek = randomInt(3, 5);

    for (let i = 0; i < sessionsThisWeek; i++) {
      const weekStart = new Date(ninetyDaysAgo.getTime() + week * 7 * 24 * 60 * 60 * 1000);
      const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);

      const startedAt = randomDateInRange(weekStart, weekEnd);
      const durationHours = randomInt(2, 6);
      const durationSeconds = durationHours * 60 * 60;
      const endedAt = new Date(startedAt.getTime() + durationSeconds * 1000);

      const avgViewers = randomInt(50, 500);

      sessions.push({
        channelId: channel.id,
        twitchStreamId: `stream_${streamer.id}_${week}_${i}_${Date.now()}`,
        startedAt,
        endedAt,
        durationSeconds,
        title: `Day ${week * 7 + i + 1} Stream!`,
        category: categories[randomInt(0, categories.length - 1)],
        avgViewers,
        peakViewers: avgViewers + randomInt(50, 200),
      });
    }
  }

  // 批量建立
  await prisma.streamSession.createMany({ data: sessions });
  console.log(`✅ Created ${sessions.length} stream sessions`);

  // 統計
  const totalHours = sessions.reduce((sum, s) => sum + s.durationSeconds, 0) / 3600;
  console.log(`\n📊 Summary:`);
  console.log(`  Total sessions: ${sessions.length}`);
  console.log(`  Total hours: ${totalHours.toFixed(1)}`);
  console.log(`  Avg duration: ${(totalHours / sessions.length * 60).toFixed(0)} minutes`);
}

async function main() {
  const streamerId = process.argv[2];

  if (!streamerId) {
    await listStreamers();
  } else {
    await addTestSessions(streamerId);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
