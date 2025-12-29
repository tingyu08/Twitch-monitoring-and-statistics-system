import { prisma } from "../db/prisma";
import { twurpleChatService } from "../services/twitch-chat.service";
import { chatListenerManager } from "../services/chat-listener-manager";
import dotenv from "dotenv";

dotenv.config();

async function diagnose() {
  console.log("🔍 Starting chat diagnosis...");

  // 1. Check Listener Manager stats
  const stats = chatListenerManager.getStats();
  console.log("\n📊 Listener Manager Stats:");
  console.log(JSON.stringify(stats, null, 2));

  // 2. Check Twurple Chat stats
  const chatStatus = twurpleChatService.getStatus();
  console.log("\n📡 Twurple Chat Status:");
  console.log(JSON.stringify(chatStatus, null, 2));

  // 3. Check Token Record
  const tokenRecord = await prisma.twitchToken.findFirst({
    where: { refreshToken: { not: null } },
    include: { streamer: true },
  });
  console.log("\n🔑 Token Record:");
  if (tokenRecord) {
    console.log(`  - ID: ${tokenRecord.id}`);
    console.log(`  - Has Access Token: ${!!tokenRecord.accessToken}`);
    console.log(`  - Has Refresh Token: ${!!tokenRecord.refreshToken}`);
    console.log(`  - Streamer Linked: ${!!tokenRecord.streamer}`);
    if (tokenRecord.streamer) {
      console.log(`    - Display Name: '${tokenRecord.streamer.displayName}'`);
    }
  } else {
    console.log("  ⚠️ No Token Record found!");
  }

  process.exit(0);
}

diagnose().catch(console.error);
