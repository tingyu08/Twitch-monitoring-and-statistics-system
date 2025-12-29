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
      let targetChannelId: string | null = null;

      const ch = await prisma.channel.findFirst({
        where: { channelName: channelName },
      });
      targetChannelId = ch?.id || null;

      if (!targetChannelId) {
        // logger.warn("ViewerMessage", `Channel not found: ${channelName}`);
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

      // 同步更新 ViewerChannelDailyStat (Format that Dashboard uses)
      await prisma.viewerChannelDailyStat.upsert({
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
          messageCount: 1,
          emoteCount: message.emotes ? message.emotes.length : 0,
          watchSeconds: 0, // Will be calculated by watch-time.service
        },
        update: {
          messageCount: { increment: 1 },
          emoteCount: message.emotes
            ? { increment: message.emotes.length }
            : undefined,
        },
      });

      // 5. 觸發觀看時間重新計算（非同步，不阻塞訊息儲存）
      import("../../services/watch-time.service").then(
        ({ updateViewerWatchTime }) => {
          updateViewerWatchTime(
            viewer.id,
            targetChannelId,
            message.timestamp
          ).catch((err) =>
            logger.error("ViewerMessage", "Failed to update watch time", err)
          );
        }
      );

      // 6. 觸發 WebSocket 廣播 (即時更新)
      // 我們只廣播必要的增量資訊來減少頻寬
      const { webSocketGateway } = await import(
        "../../services/websocket.gateway"
      );
      webSocketGateway.broadcastChannelStats(targetChannelId, {
        channelId: targetChannelId,
        messageCount: 1, // 表示這是一條新消息，前端累加
      });
    } catch (error) {
      logger.error("ViewerMessage", "Error saving message", error);
    }
  }
}

export const viewerMessageRepository = new ViewerMessageRepository();
