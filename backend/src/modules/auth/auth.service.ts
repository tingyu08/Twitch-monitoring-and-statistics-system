import { exchangeCodeForToken, fetchTwitchUser } from "./twitch-oauth.client";
import { signAccessToken, signRefreshToken, type JWTPayload } from "./jwt.utils";
import { prisma } from "../../db/prisma";
import { encryptToken } from "../../utils/crypto.utils";
import { env } from "../../config/env";
import { logger } from "../../utils/logger";
import { retryDatabaseOperation } from "../../utils/db-retry";
import { triggerFollowSyncForUser } from "../../jobs/sync-user-follows.job";

// Streamer 介面（與 Prisma model 對應）
export interface Streamer {
  id: string;
  twitchUserId: string;
  displayName: string;
  avatarUrl: string;
  channelUrl: string; // 從 Channel 關聯取得
}

const CHANNEL_UPSERT_MAX_ATTEMPTS = 5;
const CHANNEL_UPSERT_BASE_DELAY_MS = 2000;

type ChannelUpsertPayload = {
  streamerId: string;
  twitchChannelId: string;
  channelName: string;
  channelUrl: string;
  displayNameForLog: string;
};

function isLockContentionError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("database is locked") ||
    message.includes("busy") ||
    message.includes("timeout") ||
    message.includes("p2028") ||
    message.includes("transaction not found")
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function upsertChannelWithCompensation(payload: ChannelUpsertPayload): Promise<void> {
  for (let attempt = 1; attempt <= CHANNEL_UPSERT_MAX_ATTEMPTS; attempt++) {
    try {
      await retryDatabaseOperation(
        () =>
          prisma.channel.upsert({
            where: { twitchChannelId: payload.twitchChannelId },
            update: {
              channelName: payload.channelName,
              channelUrl: payload.channelUrl,
            },
            create: {
              streamerId: payload.streamerId,
              twitchChannelId: payload.twitchChannelId,
              channelName: payload.channelName,
              channelUrl: payload.channelUrl,
            },
          }),
        {
          maxRetries: 1,
          initialDelayMs: 300,
          maxDelayMs: 1500,
          shouldRetry: isLockContentionError,
        }
      );

      logger.info(
        "Auth",
        `Channel upserted for ${payload.displayNameForLog} (attempt ${attempt}/${CHANNEL_UPSERT_MAX_ATTEMPTS})`
      );
      return;
    } catch (error) {
      if (attempt === CHANNEL_UPSERT_MAX_ATTEMPTS) {
        logger.error(
          "Auth",
          `Channel upsert permanently failed after ${CHANNEL_UPSERT_MAX_ATTEMPTS} attempts`,
          error
        );
        return;
      }

      const delayMs = Math.min(
        CHANNEL_UPSERT_BASE_DELAY_MS * Math.pow(2, attempt - 1),
        30000
      );
      logger.warn(
        "Auth",
        `Channel upsert attempt ${attempt} failed, retrying in ${delayMs}ms`,
        error
      );
      await sleep(delayMs);
    }
  }
}

/**
 * 處理 Twitch OAuth callback
 * - 交換 code 為 access token
 * - 取得使用者資訊
 * - 建立/更新 Streamer 和 Channel 記錄
 * - 儲存 access token
 * - 回傳 JWT token
 */
export async function handleStreamerTwitchCallback(
  code: string,
  redirectUri?: string
): Promise<{
  streamer: Streamer;
  accessToken: string;
  refreshToken: string;
}> {
  const startTime = Date.now();

  // 1. 交換 code 為 access token
  // 使用前端傳來的 redirectUri（Twitch 要求必須與授權時相同）
  // 如果沒傳則使用後端預設值（向後相容直接後端 callback 的流程）
  const tokenData = await exchangeCodeForToken(code, {
    redirectUri: redirectUri || env.twitchRedirectUri,
  });

  // 2. 取得 Twitch 使用者資訊
  const user = await fetchTwitchUser(tokenData.access_token);

  const channelLogin = user.login ?? user.display_name ?? `twitch-${user.id}`;
  const channelUrl = `https://www.twitch.tv/${channelLogin}`;

  // 3. 併發執行資料庫操作以減少網路延遲（Turso 遠端連線優化）
  // Step 1: 先建立/更新 Streamer 和 Viewer（可以併發執行）
  const [streamerRecord, viewerRecord] = await Promise.all([
    prisma.streamer.upsert({
      where: { twitchUserId: user.id },
      update: {
        displayName: user.display_name,
        avatarUrl: user.profile_image_url,
        email: user.email || null,
      },
      create: {
        twitchUserId: user.id,
        displayName: user.display_name,
        avatarUrl: user.profile_image_url,
        email: user.email || null,
      },
    }),
    prisma.viewer.upsert({
      where: { twitchUserId: user.id },
      update: {
        displayName: user.display_name,
        avatarUrl: user.profile_image_url,
        consentedAt: new Date(),
      },
      create: {
        twitchUserId: user.id,
        displayName: user.display_name,
        avatarUrl: user.profile_image_url,
        consentedAt: new Date(),
        consentVersion: 1,
      },
    }),
  ]);

  logger.info("Auth", `Processing unified login for: ${user.display_name} (${user.id})`);
  logger.info("Auth", `Viewer record upserted: ${viewerRecord.id}`);

  // 4. Token 處理：簡化流程，先刪除舊 token 再建立新的（減少查詢）

  const encryptedAccess = encryptToken(tokenData.access_token);
  const encryptedRefresh = tokenData.refresh_token ? encryptToken(tokenData.refresh_token) : null;

  const expiresAt = tokenData.expires_in
    ? new Date(Date.now() + tokenData.expires_in * 1000)
    : null;

  // 優化：使用 deleteMany + create 替代 findFirst + update/create
  // deleteMany 不會失敗即使沒有符合的記錄
  await prisma.$transaction([
    // 刪除該 streamer 的所有舊 token
    prisma.twitchToken.deleteMany({
      where: {
        streamerId: streamerRecord.id,
        ownerType: "streamer",
      },
    }),
    // 建立新 token
    prisma.twitchToken.create({
      data: {
        ownerType: "streamer",
        streamerId: streamerRecord.id,
        viewerId: viewerRecord.id,
        accessToken: encryptedAccess,
        refreshToken: encryptedRefresh,
        expiresAt,
        status: "active",
        failureCount: 0,
        scopes: JSON.stringify([
          "user:read:email",
          "channel:read:subscriptions",
          "analytics:read:games",
          "analytics:read:extensions",
          "chat:read",
          "chat:edit",
          "user:read:follows",
          "user:read:subscriptions",
          "user:read:blocked_users",
          "user:manage:blocked_users",
          "whispers:read",
        ]),
      },
    }),
  ]);

  const result = { streamerRecord, viewerRecord };

  const streamer: Streamer = {
    id: result.streamerRecord.id,
    twitchUserId: result.streamerRecord.twitchUserId,
    displayName: result.streamerRecord.displayName,
    avatarUrl: result.streamerRecord.avatarUrl || "",
    channelUrl: channelUrl,
  };

  const jwtPayload: Omit<JWTPayload, "tokenType"> = {
    streamerId: streamer.id,
    viewerId: result.viewerRecord.id, // 重要：加入 viewerId
    twitchUserId: streamer.twitchUserId,
    displayName: streamer.displayName,
    avatarUrl: streamer.avatarUrl,
    channelUrl: streamer.channelUrl,
    role: "streamer", // 保持 role 為 streamer，但在 middleware 允許其存取 viewer 資源
    consentedAt: result.viewerRecord.consentedAt?.toISOString() ?? null,
    consentVersion: result.viewerRecord.consentVersion ?? null,
    tokenVersion: result.viewerRecord.tokenVersion, // 用於 Token 失效機制
  };

  const accessToken = signAccessToken(jwtPayload);
  const refreshToken = signRefreshToken(jwtPayload);

  const totalTime = Date.now() - startTime;
  logger.info("Auth", `OAuth callback completed in ${totalTime}ms for ${user.display_name}`);

  // ✅ 非阻塞執行 Channel upsert（避免被 update-live-status Job 的寫入鎖阻塞）
  // 這是修復晚上登入 100% 失敗問題的關鍵改動
  setImmediate(() => {
    void upsertChannelWithCompensation({
      streamerId: streamerRecord.id,
      twitchChannelId: user.id,
      channelName: channelLogin,
      channelUrl,
      displayNameForLog: user.display_name,
    });
  });

  // 立即預熱快取（不阻塞登入回應）
  // 這樣當前端請求 /api/viewer/channels 時，快取已經準備好了
    if (process.env.NODE_ENV !== "test") {
      setImmediate(() => {
        import("../viewer/viewer.service").then(({ getFollowedChannels }) => {
          getFollowedChannels(result.viewerRecord.id).catch((err: unknown) =>
            logger.error("Auth", "Cache warmup failed after login", err)
          );
        });
      });
    }

  // 延遲執行後台任務（避免阻塞登入回應，防止 Zeabur 502 超時）
  // 在 Zeabur 免費層資源受限的環境下，立即啟動這些任務可能導致回應超時
  setTimeout(() => {
    // 非同步觸發追蹤名單同步（不阻塞登入流程）
    triggerFollowSyncForUser(result.viewerRecord.id, tokenData.access_token).catch((err: unknown) =>
      logger.error("Auth", "Follow sync failed after login", err)
    );

    // 非同步觸發聊天室服務重新初始化（不阻塞登入流程）
    if (process.env.NODE_ENV !== "test") {
      import("../../services/twitch-chat.service").then(({ twurpleChatService }) => {
        twurpleChatService
          .initialize()
          .catch((err: unknown) =>
            logger.error("Auth", "Chat service reinit failed after login", err)
          );
      });
    }
  }, 30000); // 延遲 30 秒，避開 Dashboard 初次載入高峰，讓登入回應先完成

  return { streamer, accessToken, refreshToken };
}

// (handleViewerTwitchCallback removed)

/**
 * 根據 Streamer ID 取得 Streamer 資訊
 */
export async function getStreamerById(streamerId: string): Promise<Streamer | null> {
  const streamerRecord = await prisma.streamer.findUnique({
    where: { id: streamerId },
    include: {
      channels: true,
    },
  });

  if (!streamerRecord) {
    return null;
  }

  const channel = streamerRecord.channels[0];

  return {
    id: streamerRecord.id,
    twitchUserId: streamerRecord.twitchUserId,
    displayName: streamerRecord.displayName,
    avatarUrl: streamerRecord.avatarUrl || "",
    channelUrl: channel?.channelUrl || `https://www.twitch.tv/${channel?.channelName || ""}`,
  };
}

/**
 * 根據 Twitch User ID 取得 Streamer 資訊
 */
export async function getStreamerByTwitchId(twitchUserId: string): Promise<Streamer | null> {
  const streamerRecord = await prisma.streamer.findUnique({
    where: { twitchUserId },
    include: {
      channels: true,
    },
  });

  if (!streamerRecord) {
    return null;
  }

  const channel = streamerRecord.channels[0];

  return {
    id: streamerRecord.id,
    twitchUserId: streamerRecord.twitchUserId,
    displayName: streamerRecord.displayName,
    avatarUrl: streamerRecord.avatarUrl || "",
    channelUrl: channel?.channelUrl || `https://www.twitch.tv/${channel?.channelName || ""}`,
  };
}
