/**
 * 資料庫 Seed 腳本
 * 用於建立測試資料,包括實況主、頻道、開台紀錄和每日統計
 *
 * 執行方式：npm run db:seed
 */

import { PrismaClient } from "@prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import * as path from "path";

// 建立 libSQL 適配器
const databaseUrl =
  process.env.DATABASE_URL || `file:${path.join(__dirname, "./dev.db")}`;
const adapter = new PrismaLibSql({ url: databaseUrl });

const prisma = new PrismaClient({ adapter });

// ========== 輔助函數 ==========

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomDateInRange(startDate: Date, endDate: Date): Date {
  const start = startDate.getTime();
  const end = endDate.getTime();
  return new Date(start + Math.random() * (end - start));
}

// ========== 資料型別 ==========

interface StreamerConfig {
  twitchUserId: string;
  displayName: string;
  email?: string;
  avatarUrl?: string;
}

interface ChannelConfig {
  twitchChannelId: string;
  channelName: string;
  channelUrl: string;
}

// ========== 主函數 ==========

async function main() {
  console.log("🌱 開始建立測試資料...\n");

  // 清除現有資料（開發環境使用）
  console.log("🗑️ 清除現有資料...");
  await prisma.viewerChannelMessage.deleteMany();
  await prisma.viewerChannelMessageDailyAgg.deleteMany();
  await prisma.viewerChannelDailyStat.deleteMany();
  await prisma.channelDailyStat.deleteMany();
  await prisma.streamSession.deleteMany();
  await prisma.twitchToken.deleteMany();
  await prisma.channel.deleteMany();
  await prisma.viewer.deleteMany();
  await prisma.streamer.deleteMany();

  // ========== 建立實況主和頻道 ==========

  const streamers: StreamerConfig[] = [
    {
      twitchUserId: "test_twitch_123",
      displayName: "TestStreamer",
      email: "test@example.com",
      avatarUrl:
        "https://static-cdn.jtvnw.net/jtv_user_pictures/test-profile_image-300x300.png",
    },
    {
      twitchUserId: "56889365",
      displayName: "咖波可可愛愛",
      email: "capookawaii@example.com",
      avatarUrl:
        "https://static-cdn.jtvnw.net/jtv_user_pictures/capookawaii-profile_image-300x300.png",
    },
  ];

  const channels: ChannelConfig[] = [
    {
      twitchChannelId: "test_twitch_123",
      channelName: "teststreamer",
      channelUrl: "https://www.twitch.tv/teststreamer",
    },
    {
      twitchChannelId: "56889365",
      channelName: "capookawaii",
      channelUrl: "https://www.twitch.tv/capookawaii",
    },
  ];

  // Mock 頻道（與前端 MOCK_CHANNELS 和後端 viewer.service.ts 對應）
  const mockStreamers: StreamerConfig[] = [
    {
      twitchUserId: "mock_streamer_ch_1",
      displayName: "Shroud",
      email: "shroud@example.com",
      avatarUrl: "https://ui-avatars.com/api/?name=Shroud&background=random",
    },
    {
      twitchUserId: "mock_streamer_ch_2",
      displayName: "Pokimane",
      email: "pokimane@example.com",
      avatarUrl: "https://ui-avatars.com/api/?name=Pokimane&background=random",
    },
    {
      twitchUserId: "mock_streamer_ch_3",
      displayName: "xQc",
      email: "xqc@example.com",
      avatarUrl: "https://ui-avatars.com/api/?name=xQc&background=random",
    },
    {
      twitchUserId: "mock_streamer_ch_4",
      displayName: "LilyPichu",
      email: "lilypichu@example.com",
      avatarUrl: "https://ui-avatars.com/api/?name=LilyPichu&background=random",
    },
    {
      twitchUserId: "mock_streamer_ch_5",
      displayName: "DisguisedToast",
      email: "toast@example.com",
      avatarUrl: "https://ui-avatars.com/api/?name=Toast&background=random",
    },
  ];

  interface MockChannelConfig {
    id: string; // 固定 ID，與前端一致
    twitchChannelId: string;
    channelName: string;
    channelUrl: string;
  }

  const mockChannels: MockChannelConfig[] = [
    {
      id: "ch_1",
      twitchChannelId: "mock_twitch_ch_1",
      channelName: "shroud",
      channelUrl: "https://twitch.tv/shroud",
    },
    {
      id: "ch_2",
      twitchChannelId: "mock_twitch_ch_2",
      channelName: "pokimane",
      channelUrl: "https://twitch.tv/pokimane",
    },
    {
      id: "ch_3",
      twitchChannelId: "mock_twitch_ch_3",
      channelName: "xqcow",
      channelUrl: "https://twitch.tv/xqcow",
    },
    {
      id: "ch_4",
      twitchChannelId: "mock_twitch_ch_4",
      channelName: "lilypichu",
      channelUrl: "https://twitch.tv/lilypichu",
    },
    {
      id: "ch_5",
      twitchChannelId: "mock_twitch_ch_5",
      channelName: "disguisedtoast",
      channelUrl: "https://twitch.tv/disguisedtoast",
    },
  ];

  console.log("👤 建立測試實況主...");
  const createdStreamers: Record<string, string> = {};

  for (const streamerConfig of streamers) {
    const streamer = await prisma.streamer.create({
      data: {
        twitchUserId: streamerConfig.twitchUserId,
        displayName: streamerConfig.displayName,
        avatarUrl: streamerConfig.avatarUrl,
        email: streamerConfig.email,
      },
    });
    createdStreamers[streamerConfig.twitchUserId] = streamer.id;
    console.log(`  ✅ 實況主: ${streamer.displayName}`);
  }

  // 建立 Mock Streamers
  for (const streamerConfig of mockStreamers) {
    const streamer = await prisma.streamer.create({
      data: {
        twitchUserId: streamerConfig.twitchUserId,
        displayName: streamerConfig.displayName,
        avatarUrl: streamerConfig.avatarUrl,
        email: streamerConfig.email,
      },
    });
    createdStreamers[streamerConfig.twitchUserId] = streamer.id;
    console.log(`  ✅ Mock 實況主: ${streamer.displayName}`);
  }

  console.log("📺 建立頻道...");
  const createdChannels: Record<string, string> = {};

  for (const channelConfig of channels) {
    const streamerId = createdStreamers[channelConfig.twitchChannelId];
    const channel = await prisma.channel.create({
      data: {
        streamerId,
        twitchChannelId: channelConfig.twitchChannelId,
        channelName: channelConfig.channelName,
        channelUrl: channelConfig.channelUrl,
      },
    });
    createdChannels[channelConfig.twitchChannelId] = channel.id;
    console.log(`  ✅ 頻道: ${channel.channelName}`);
  }

  // 建立 Mock Channels（使用固定 ID）
  for (const mockChannel of mockChannels) {
    const streamerId = createdStreamers[`mock_streamer_${mockChannel.id}`];
    await prisma.channel.create({
      data: {
        id: mockChannel.id, // 使用固定 ID
        streamerId,
        twitchChannelId: mockChannel.twitchChannelId,
        channelName: mockChannel.channelName,
        channelUrl: mockChannel.channelUrl,
      },
    });
    createdChannels[mockChannel.id] = mockChannel.id;
    console.log(
      `  ✅ Mock 頻道: ${mockChannel.channelName} (${mockChannel.id})`
    );
  }

  // ========== 建立開台紀錄（90 天）==========
  console.log("🎮 建立開台紀錄...");

  const now = new Date();
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

  const categories = [
    "Just Chatting",
    "League of Legends",
    "Valorant",
    "原神",
    "Minecraft",
    "APEX Legends",
    "Art",
  ];

  const titles = [
    "今日開台！歡迎來聊天 ❤️",
    "週末打遊戲！",
    "睡前閒聊台",
    "來看看新遊戲！",
    "粉絲同樂會",
    "練習中...",
    "新手上路請多指教！",
  ];

  let totalSessions = 0;

  for (const [twitchId, channelId] of Object.entries(createdChannels)) {
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

    // 每週 3-5 次開台
    const totalWeeks = 13;
    for (let week = 0; week < totalWeeks; week++) {
      const sessionsThisWeek = randomInt(3, 5);

      for (let i = 0; i < sessionsThisWeek; i++) {
        const weekStart = new Date(
          ninetyDaysAgo.getTime() + week * 7 * 24 * 60 * 60 * 1000
        );
        const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);

        const startedAt = randomDateInRange(weekStart, weekEnd);
        // 設定開台時間為晚上 7-10 點
        startedAt.setHours(randomInt(19, 22), randomInt(0, 59), 0, 0);

        const durationHours = randomInt(2, 6);
        const durationSeconds = durationHours * 60 * 60;
        const endedAt = new Date(startedAt.getTime() + durationSeconds * 1000);

        const avgViewers = randomInt(50, 500);

        sessions.push({
          channelId,
          twitchStreamId: `stream_${twitchId}_${week}_${i}_${Date.now()}`,
          startedAt,
          endedAt,
          durationSeconds,
          title: titles[randomInt(0, titles.length - 1)],
          category: categories[randomInt(0, categories.length - 1)],
          avgViewers,
          peakViewers: avgViewers + randomInt(50, 200),
        });
      }
    }

    await prisma.streamSession.createMany({ data: sessions });
    totalSessions += sessions.length;

    // 建立每日統計
    const dailyStats: Array<{
      channelId: string;
      date: Date;
      streamSeconds: number;
      streamCount: number;
      avgViewers: number;
      peakViewers: number;
      subsTotal: number;
      subsDelta: number;
    }> = [];

    const sessionsByDate = new Map<string, typeof sessions>();
    for (const session of sessions) {
      const dateKey = session.startedAt.toISOString().split("T")[0];
      const bucket = sessionsByDate.get(dateKey);
      if (bucket) {
        bucket.push(session);
      } else {
        sessionsByDate.set(dateKey, [session]);
      }
    }

    let runningSubsTotal = randomInt(500, 2000);
    for (const [dateStr, daySessions] of sessionsByDate) {
      const totalSeconds = daySessions.reduce(
        (sum, s) => sum + s.durationSeconds,
        0
      );
      const avgViewers = Math.round(
        daySessions.reduce((sum, s) => sum + s.avgViewers, 0) /
          daySessions.length
      );
      const peakViewers = Math.max(...daySessions.map((s) => s.peakViewers));
      const subsDelta = randomInt(-5, 20);
      runningSubsTotal += subsDelta;

      dailyStats.push({
        channelId,
        date: new Date(dateStr),
        streamSeconds: totalSeconds,
        streamCount: daySessions.length,
        avgViewers,
        peakViewers,
        subsTotal: runningSubsTotal,
        subsDelta,
      });
    }

    await prisma.channelDailyStat.createMany({ data: dailyStats });
  }
  console.log(`  ✅ 建立 ${totalSessions} 筆開台紀錄`);

  // ========== 建立測試觀眾 ==========
  console.log("👥 建立測試觀眾...");

  const viewers = await prisma.viewer.createMany({
    data: [
      {
        twitchUserId: "viewer_1",
        displayName: "Viewer1",
        consentedAt: new Date(),
        consentVersion: 1,
      },
      {
        twitchUserId: "viewer_2",
        displayName: "Viewer2",
        consentedAt: new Date(),
        consentVersion: 1,
      },
      {
        twitchUserId: "viewer_3",
        displayName: "Viewer3",
        consentedAt: new Date(),
        consentVersion: 1,
      },
      {
        twitchUserId: "test_viewer_capoo",
        displayName: "TestViewerCapoo",
        consentedAt: new Date(),
        consentVersion: 1,
      },
      {
        twitchUserId: "56889365",
        displayName: "咖波可可愛愛",
        consentedAt: new Date(),
        consentVersion: 1,
      },
    ],
  });
  console.log(`  ✅ 建立 ${viewers.count} 個測試觀眾`);

  // 獲取觀眾 ID
  const capooViewer = await prisma.viewer.findUnique({
    where: { twitchUserId: "56889365" },
  });
  const capooChannelId = createdChannels["56889365"];

  // ========== 建立觀眾訊息（針對 capookawaii）==========
  if (capooViewer && capooChannelId) {
    console.log("💬 建立觀眾訊息...");

    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sampleMessages = [
      "哈囉！",
      "今天玩什麼？",
      "太強了吧！",
      "笑死 XDDD",
      "加油加油！",
      "這個厲害",
      "晚安～",
      "+1",
      "好好笑",
      "來了來了",
    ];

    const messages: Array<{
      viewerId: string;
      channelId: string;
      messageText: string;
      messageType: string;
      timestamp: Date;
    }> = [];

    for (let day = 0; day < 30; day++) {
      const baseDate = new Date(
        thirtyDaysAgo.getTime() + day * 24 * 60 * 60 * 1000
      );
      const msgCount = randomInt(5, 30);

      for (let i = 0; i < msgCount; i++) {
        const timestamp = new Date(baseDate);
        timestamp.setHours(
          randomInt(19, 23),
          randomInt(0, 59),
          randomInt(0, 59)
        );

        messages.push({
          viewerId: capooViewer.id,
          channelId: capooChannelId,
          messageText: sampleMessages[randomInt(0, sampleMessages.length - 1)],
          messageType: Math.random() > 0.95 ? "CHEER" : "CHAT",
          timestamp,
        });
      }
    }

    await prisma.viewerChannelMessage.createMany({ data: messages });
    console.log(`  ✅ 建立 ${messages.length} 則訊息`);

    // 建立訊息每日聚合
    const messagesByDate = new Map<string, typeof messages>();
    for (const msg of messages) {
      const dateKey = msg.timestamp.toISOString().split("T")[0];
      const bucket = messagesByDate.get(dateKey);
      if (bucket) {
        bucket.push(msg);
      } else {
        messagesByDate.set(dateKey, [msg]);
      }
    }

    const messageAggs: Array<{
      viewerId: string;
      channelId: string;
      date: Date;
      totalMessages: number;
      chatMessages: number;
      subscriptions: number;
      cheers: number;
      giftSubs: number;
      raids: number;
      totalBits: number;
    }> = [];

    for (const [dateStr, dayMessages] of messagesByDate) {
      const chatCount = dayMessages.filter(
        (m) => m.messageType === "CHAT"
      ).length;
      const cheerCount = dayMessages.filter(
        (m) => m.messageType === "CHEER"
      ).length;

      messageAggs.push({
        viewerId: capooViewer.id,
        channelId: capooChannelId,
        date: new Date(dateStr),
        totalMessages: dayMessages.length,
        chatMessages: chatCount,
        subscriptions: 0,
        cheers: cheerCount,
        giftSubs: 0,
        raids: 0,
        totalBits: cheerCount * randomInt(100, 500),
      });
    }

    await prisma.viewerChannelMessageDailyAgg.createMany({ data: messageAggs });
    console.log(`  ✅ 建立 ${messageAggs.length} 筆訊息統計`);
  }

  // ========== 為您的 Viewer 建立與 Mock Channels 的訊息資料 ==========
  const yourViewer = await prisma.viewer.findUnique({
    where: { twitchUserId: "56889365" },
  });

  if (yourViewer) {
    console.log("💬 建立 Mock 頻道訊息資料...");
    const mockChannelIds = ["ch_1", "ch_2", "ch_3"];

    for (const mockChannelId of mockChannelIds) {
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const mockMessages: Array<{
        viewerId: string;
        channelId: string;
        messageText: string;
        messageType: string;
        timestamp: Date;
      }> = [];

      const sampleMsgs = ["Hello!", "Nice!", "哈囉", "LOL", "GG", "+1"];

      for (let day = 0; day < 30; day++) {
        const baseDate = new Date(
          thirtyDaysAgo.getTime() + day * 24 * 60 * 60 * 1000
        );
        const msgCount = randomInt(3, 15);

        for (let i = 0; i < msgCount; i++) {
          const timestamp = new Date(baseDate);
          timestamp.setHours(
            randomInt(19, 23),
            randomInt(0, 59),
            randomInt(0, 59)
          );

          mockMessages.push({
            viewerId: yourViewer.id,
            channelId: mockChannelId,
            messageText: sampleMsgs[randomInt(0, sampleMsgs.length - 1)],
            messageType: Math.random() > 0.95 ? "CHEER" : "CHAT",
            timestamp,
          });
        }
      }

      await prisma.viewerChannelMessage.createMany({ data: mockMessages });

      // 建立訊息每日聚合
      const mockMsgsByDate = new Map<string, typeof mockMessages>();
      for (const msg of mockMessages) {
        const dateKey = msg.timestamp.toISOString().split("T")[0];
        const bucket = mockMsgsByDate.get(dateKey);
        if (bucket) {
          bucket.push(msg);
        } else {
          mockMsgsByDate.set(dateKey, [msg]);
        }
      }

      const mockMsgAggs: Array<{
        viewerId: string;
        channelId: string;
        date: Date;
        totalMessages: number;
        chatMessages: number;
        subscriptions: number;
        cheers: number;
        giftSubs: number;
        raids: number;
        totalBits: number;
      }> = [];

      for (const [dateStr, dayMsgs] of mockMsgsByDate) {
        const chatCount = dayMsgs.filter(
          (m) => m.messageType === "CHAT"
        ).length;
        const cheerCount = dayMsgs.filter(
          (m) => m.messageType === "CHEER"
        ).length;

        mockMsgAggs.push({
          viewerId: yourViewer.id,
          channelId: mockChannelId,
          date: new Date(dateStr),
          totalMessages: dayMsgs.length,
          chatMessages: chatCount,
          subscriptions: 0,
          cheers: cheerCount,
          giftSubs: 0,
          raids: 0,
          totalBits: cheerCount * randomInt(100, 500),
        });
      }

      await prisma.viewerChannelMessageDailyAgg.createMany({
        data: mockMsgAggs,
      });

      // 建立 ViewerChannelDailyStat（讓 getFollowedChannels 能查詢到）
      const dailyStats: Array<{
        viewerId: string;
        channelId: string;
        date: Date;
        watchSeconds: number;
        messageCount: number;
        emoteCount: number;
      }> = [];

      for (const [dateStr, dayMsgs] of mockMsgsByDate) {
        dailyStats.push({
          viewerId: yourViewer.id,
          channelId: mockChannelId,
          date: new Date(dateStr),
          watchSeconds: randomInt(1800, 14400), // 30 分鐘到 4 小時
          messageCount: dayMsgs.length,
          emoteCount: Math.floor(dayMsgs.length * 0.3),
        });
      }

      await prisma.viewerChannelDailyStat.createMany({ data: dailyStats });

      console.log(
        `  ✅ Mock 頻道 ${mockChannelId}: ${mockMessages.length} 則訊息, ${mockMsgAggs.length} 筆統計, ${dailyStats.length} 筆觀看紀錄`
      );
    }
  }

  // ========== 統計摘要 ==========
  console.log("\n📈 測試資料摘要:");
  console.log(`  - 實況主: ${streamers.length + mockStreamers.length}`);
  console.log(`  - 頻道: ${channels.length + mockChannels.length}`);
  console.log(`  - 觀眾: ${viewers.count}`);

  console.log("\n✨ 測試資料建立完成！");
}

main()
  .catch((e) => {
    console.error("❌ Seed 執行失敗:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
