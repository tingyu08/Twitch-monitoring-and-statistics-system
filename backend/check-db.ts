import { prisma } from './src/db/prisma';

async function check() {
  const myId = 'cab44be4-c427-4afa-8e2e-43ee6a497cfd';

  const channel = await prisma.channel.findFirst({
    where: { streamerId: myId }
  });

  if (channel) {
    const now = new Date();
    const cutoff30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const recent = await prisma.streamSession.count({
      where: {
        channelId: channel.id,
        startedAt: { gte: cutoff30d }
      }
    });

    const total = await prisma.streamSession.count({
      where: { channelId: channel.id }
    });

    console.log('Total sessions:', total);
    console.log('Sessions in last 30 days:', recent);

    const sample = await prisma.streamSession.findMany({
      where: { channelId: channel.id },
      take: 3,
      orderBy: { startedAt: 'desc' }
    });
    console.log('\nRecent sessions:');
    for (const s of sample) {
      console.log('  -', s.startedAt, s.durationSeconds + 's');
    }
  }
}

check()
  .then(() => prisma.$disconnect())
  .catch(e => {
    console.error(e);
    prisma.$disconnect();
  });
