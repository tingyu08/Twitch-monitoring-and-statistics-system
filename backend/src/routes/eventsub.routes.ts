/**
 * EventSub Routes
 * Twitch EventSub Webhook 路由處理
 *
 * Story 3.3: 定時資料抓取與 EventSub 整合
 */

import { Router, Request, Response, json } from "express";
import {
  verifyEventSubSignature,
  EventSubRequest,
  EVENTSUB_MESSAGE_TYPE,
} from "../middleware/eventsub.middleware";
import {
  eventSubService,
  EVENTSUB_TYPES,
  type EventSubNotification,
  type StreamOnlineEvent,
  type StreamOfflineEvent,
  type ChannelUpdateEvent,
  type ChannelSubscribeEvent,
  type ChannelCheerEvent,
} from "../services/eventsub.service";

const router = Router();

// 使用 JSON 解析，但保留 raw body 用於簽名驗證
router.use(
  json({
    verify: (req: Request, _res, buf) => {
      // 保存 raw body 用於 HMAC 驗證
      (req as Request & { rawBody?: string }).rawBody = buf.toString();
    },
  })
);

/**
 * POST /eventsub/callback
 * 接收所有 Twitch EventSub Webhook 事件
 */
router.post(
  "/callback",
  verifyEventSubSignature,
  async (req: EventSubRequest, res: Response) => {
    const messageType = req.eventsubMessageType;

    try {
      // 處理 Challenge 驗證請求
      if (messageType === EVENTSUB_MESSAGE_TYPE.VERIFICATION) {
        const challenge = req.body.challenge;
        console.log("🔐 EventSub Challenge 驗證請求");
        res.status(200).type("text/plain").send(challenge);
        return;
      }

      // 處理訂閱撤銷通知
      if (messageType === EVENTSUB_MESSAGE_TYPE.REVOCATION) {
        const subscription = req.body.subscription;
        console.warn(
          `⚠️ EventSub 訂閱已撤銷: ${subscription.type} (${subscription.status})`
        );
        res.status(204).send();
        return;
      }

      // 處理一般通知
      if (messageType === EVENTSUB_MESSAGE_TYPE.NOTIFICATION) {
        const notification = req.body as EventSubNotification;
        const eventType = notification.subscription.type;

        console.log(`📩 收到 EventSub 事件: ${eventType}`);

        // 根據事件類型分發處理
        switch (eventType) {
          case EVENTSUB_TYPES.STREAM_ONLINE:
            await eventSubService.handleStreamOnline(
              notification.event as StreamOnlineEvent
            );
            break;

          case EVENTSUB_TYPES.STREAM_OFFLINE:
            await eventSubService.handleStreamOffline(
              notification.event as StreamOfflineEvent
            );
            break;

          case EVENTSUB_TYPES.CHANNEL_UPDATE:
            await eventSubService.handleChannelUpdate(
              notification.event as ChannelUpdateEvent
            );
            break;

          case EVENTSUB_TYPES.CHANNEL_SUBSCRIBE:
          case EVENTSUB_TYPES.CHANNEL_SUBSCRIPTION_MESSAGE:
            await eventSubService.handleSubscription(
              notification.event as ChannelSubscribeEvent
            );
            break;

          case EVENTSUB_TYPES.CHANNEL_CHEER:
            await eventSubService.handleCheer(
              notification.event as ChannelCheerEvent
            );
            break;

          default:
            console.log(`ℹ️ 未處理的事件類型: ${eventType}`);
        }

        res.status(204).send();
        return;
      }

      // 未知的 message type
      console.warn(`⚠️ 未知的 EventSub message type: ${messageType}`);
      res.status(400).json({ error: "Unknown message type" });
    } catch (error) {
      console.error("❌ EventSub 處理錯誤:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

import { twurpleEventSubService } from "../services/twurple-eventsub.service";

/**
 * GET /eventsub/status
 * 檢查 EventSub 服務狀態 (開發用)
 */
router.get("/status", (_req: Request, res: Response) => {
  const status = twurpleEventSubService.getStatus();
  res.json({
    ...status,
    enabled: process.env.EVENTSUB_ENABLED === "true",
    callbackUrl: process.env.EVENTSUB_CALLBACK_URL,
  });
});

export const eventSubRoutes = router;
