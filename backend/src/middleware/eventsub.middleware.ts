/**
 * EventSub Middleware
 * Twitch EventSub Webhook 簽名驗證中間件
 *
 * Story 3.3: 定時資料抓取與 EventSub 整合
 */

import { Request, Response, NextFunction } from "express";
import crypto from "crypto";

// Twitch EventSub 訊息類型
export const EVENTSUB_MESSAGE_TYPE = {
  NOTIFICATION: "notification",
  VERIFICATION: "webhook_callback_verification",
  REVOCATION: "revocation",
} as const;

// Twitch EventSub Headers
const TWITCH_MESSAGE_ID = "twitch-eventsub-message-id";
const TWITCH_MESSAGE_TIMESTAMP = "twitch-eventsub-message-timestamp";
const TWITCH_MESSAGE_SIGNATURE = "twitch-eventsub-message-signature";
const TWITCH_MESSAGE_TYPE = "twitch-eventsub-message-type";

// 簽名前綴
const HMAC_PREFIX = "sha256=";

// 時間戳有效期 (10 分鐘，防重放攻擊)
const MAX_TIMESTAMP_AGE_MS = 10 * 60 * 1000;

/**
 * 獲取 EventSub Secret
 */
function getSecret(): string {
  const secret = process.env.EVENTSUB_SECRET;
  if (!secret) {
    throw new Error("EVENTSUB_SECRET 環境變數未設定");
  }
  return secret;
}

/**
 * 計算 HMAC 簽名
 */
function getHmacMessage(messageId: string, timestamp: string, body: string): string {
  return messageId + timestamp + body;
}

/**
 * 計算 HMAC-SHA256 簽名
 */
function computeHmac(secret: string, message: string): string {
  return HMAC_PREFIX + crypto.createHmac("sha256", secret).update(message).digest("hex");
}

/**
 * 驗證簽名
 */
function verifySignature(expectedSignature: string, actualSignature: string): boolean {
  // 使用 timing-safe 比較防止時序攻擊
  try {
    const expected = Buffer.from(expectedSignature);
    const actual = Buffer.from(actualSignature);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/**
 * 驗證時間戳 (防重放攻擊)
 */
function verifyTimestamp(timestamp: string): boolean {
  const messageTime = new Date(timestamp).getTime();
  const now = Date.now();
  return now - messageTime <= MAX_TIMESTAMP_AGE_MS;
}

/**
 * EventSub 驗證中間件
 * 驗證 Twitch Webhook 請求的 HMAC 簽名
 */
export function verifyEventSubSignature(req: Request, res: Response, next: NextFunction): void {
  try {
    // 獲取必要的 headers
    const messageId = req.headers[TWITCH_MESSAGE_ID] as string;
    const timestamp = req.headers[TWITCH_MESSAGE_TIMESTAMP] as string;
    const signature = req.headers[TWITCH_MESSAGE_SIGNATURE] as string;
    const messageType = req.headers[TWITCH_MESSAGE_TYPE] as string;

    // 檢查是否有必要的 headers
    if (!messageId || !timestamp || !signature) {
      console.warn("⚠️ EventSub: 缺少必要的 headers");
      res.status(403).json({ error: "Missing required headers" });
      return;
    }

    // 驗證時間戳
    if (!verifyTimestamp(timestamp)) {
      console.warn("⚠️ EventSub: 時間戳過期或無效");
      res.status(403).json({ error: "Timestamp expired" });
      return;
    }

    // 獲取 raw body (需要在 express.json() 之前使用 express.raw())
    const rawBody = typeof req.body === "string" ? req.body : JSON.stringify(req.body);

    // 計算預期的簽名
    const secret = getSecret();
    const hmacMessage = getHmacMessage(messageId, timestamp, rawBody);
    const expectedSignature = computeHmac(secret, hmacMessage);

    // 驗證簽名
    if (!verifySignature(signature, expectedSignature)) {
      console.warn("⚠️ EventSub: 簽名驗證失敗");
      res.status(403).json({ error: "Invalid signature" });
      return;
    }

    // 將 message type 附加到 request 物件
    (req as EventSubRequest).eventsubMessageType = messageType;

    console.log(`✅ EventSub: 簽名驗證成功 [${messageType}]`);
    next();
  } catch (error) {
    console.error("❌ EventSub 驗證錯誤:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}

/**
 * 擴展的 Request 類型
 */
export interface EventSubRequest extends Request {
  eventsubMessageType?: string;
  body: Record<string, unknown>;
}
