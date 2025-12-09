const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function createTestData() {
  try {
    const streamer = await prisma.streamer.findFirst();
    if (!streamer) {
      console.log('找不到 streamer，請先登入');
      process.exit(1);
    }
    
    console.log('為 streamer', streamer.displayName, '建立測試資料...');
    
    const sessions = [];
    const now = new Date();
    
    for (let i = 0; i < 30; i++) {
      const date = new Date(now);
      date.setDate(date.getDate() - (30 - i));
      
      if (Math.random() > 0.3) {
        const numSessions = Math.floor(Math.random() * 2) + 1;
        
        for (let j = 0; j < numSessions; j++) {
          const startHour = 14 + Math.floor(Math.random() * 8);
          const startTime = new Date(date);
          startTime.setHours(startHour, 0, 0);
          
          const endTime = new Date(startTime);
          endTime.setHours(startTime.getHours() + 2 + Math.floor(Math.random() * 2));
          
          sessions.push({
            streamerId: streamer.id,
            startTime,
            endTime,
            peakViewers: Math.floor(Math.random() * 500) + 50,
            avgViewers: Math.floor(Math.random() * 300) + 30,
            newFollowers: Math.floor(Math.random() * 50),
            newSubscribers: Math.floor(Math.random() * 10)
          });
        }
      }
    }
    
    await prisma.streamSession.createMany({ data: sessions });
    console.log(' 成功建立', sessions.length, '筆測試資料');
    
  } catch (error) {
    console.error('錯誤:', error);
  } finally {
    await prisma.$disconnect();
  }
}

createTestData();
