import { prisma } from "../../db/prisma";
import {
  ParsedMessage,
  RawChatMessage,
  MessageParser,
} from "../../utils/message-parser";
import { logger } from "../../utils/logger";

// 可以接受 ParsedMessage 或 RawChatMessage
type MessageInput = ParsedMessage | RawChatMessage;

// 類型守衛：檢查是否為 RawChatMessage
function isRawChatMessage(msg: MessageInput): msg is RawChatMessage {
  return "viewerId" in msg && "bitsAmount" in msg;
}

export class ViewerMessageRepository {
  /**
   * 保存訊息至資料庫
   * @param channelName Twitch 頻道名稱 (小寫)
   * @param message 解析後的訊息（可以是 ParsedMessage 或 RawChatMessage）
   */
  async saveMessage(
    channelName: string,
    messageInput: MessageInput
  ): Promise<void> {
    // 統一轉換為 ParsedMessage
    const message: ParsedMessage = isRawChatMessage(messageInput)
      ? MessageParser.fromRawMessage(messageInput)
      : messageInput;

    try {
      // 1. 查找對應的 Viewer (只保存已註冊 Viewer 的訊息)
      const viewer = await prisma.viewer.findUnique({
        where: { twitchUserId: message.twitchUserId },
      });

      if (!viewer) {
        // 非註冊 Viewer，忽略
        return;
      }

      // 2. 查找對應的 Channel
      // 注意：這裡假設 Channel 已經存在於我們的 DB。如果監聽功能啟動，通常意味著 Channel 已經建立。
      // 為了效能，這裡應該要有緩存，但現在先查 DB。
      const channel = await prisma.channel.findUnique({
        where: { twitchChannelId: channelName }, // 假設 twitchChannelId 存的是 username/login name
      });

      // 如果是用 twitchChannelId 找不到，嘗試用 channelName 找 (如果 schema 定義不同)
      // 根據 schema: twitchChannelId 是 @unique String

      // TODO: 我們的 schema data seeding 並沒有嚴格保證 twitchChannelId 格式。
      // 在 Story 2.2 seeding 中，twitchChannelId 是 'mock_twitch_ch_1'
      // 在真實環境，這應該是 Twitch 的 numeric user ID 還是 login name?
      // 通常 IRC channel name 是 login name (e.g. 'shroud').
      // 我們需要確認 Channel model 的 twitchChannelId 存什麼。
      // 假設它存的是 login name。

      let targetChannelId: string | null = channel?.id || null;

      if (!targetChannelId) {
        // Fallback: 嘗試用 channelName 查找
        const ch = await prisma.channel.findFirst({
          where: { channelName: channelName },
        });
        targetChannelId = ch?.id || null;
      }

      if (!targetChannelId) {
        // logger.warn('ViewerMessage', `Channel not found: ${channelName}`);
        return;
      }

      // 3. 寫入詳細記錄
      await prisma.viewerChannelMessage.create({
        data: {
          viewerId: viewer.id,
          channelId: targetChannelId,
          messageText: message.messageText,
          messageType: message.messageType,
          timestamp: message.timestamp,
          badges: message.badges ? JSON.stringify(message.badges) : null,
          emotesUsed: message.emotes ? JSON.stringify(message.emotes) : null,
          bitsAmount: message.bits > 0 ? message.bits : null,
        },
      });

      // 4. 即時更新每日聚合 (Upsert)
      // 為了簡化，我們可以在這裡直接做增量更新，或者讓 Cron Job 做。
      // AC 4 說 "每小時聚合"，但如果我們想即時顯示，增量更新更好。
      // 讓我們做一個簡單的增量更新。

      const date = new Date(message.timestamp);
      date.setHours(0, 0, 0, 0);

      await prisma.viewerChannelMessageDailyAgg.upsert({
        where: {
          viewerId_channelId_date: {
            viewerId: viewer.id,
            channelId: targetChannelId,
            date: date,
          },
        },
        create: {
          viewerId: viewer.id,
          channelId: targetChannelId,
          date: date,
          totalMessages: 1,
          chatMessages: message.messageType === "CHAT" ? 1 : 0,
          subscriptions: message.messageType === "SUBSCRIPTION" ? 1 : 0,
          cheers: message.messageType === "CHEER" ? 1 : 0,
          raids: message.messageType === "RAID" ? 1 : 0,
          totalBits: message.bits,
        },
        update: {
          totalMessages: { increment: 1 },
          chatMessages:
            message.messageType === "CHAT" ? { increment: 1 } : undefined,
          subscriptions:
            message.messageType === "SUBSCRIPTION"
              ? { increment: 1 }
              : undefined,
          cheers:
            message.messageType === "CHEER" ? { increment: 1 } : undefined,
          raids: message.messageType === "RAID" ? { increment: 1 } : undefined,
          totalBits: message.bits > 0 ? { increment: message.bits } : undefined,
        },
      });
    } catch (error) {
      logger.error("ViewerMessage", "Error saving message", error);
    }
  }
}

export const viewerMessageRepository = new ViewerMessageRepository();
