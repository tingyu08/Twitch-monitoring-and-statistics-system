import { exchangeCodeForToken, fetchTwitchUser } from "./twitch-oauth.client";
import {
  signAccessToken,
  signRefreshToken,
  type JWTPayload,
} from "./jwt.utils";
import { prisma } from "../../db/prisma";
import { encryptToken } from "../../utils/crypto.utils";
import { env } from "../../config/env";
import { logger } from "../../utils/logger";
import { triggerFollowSyncForUser } from "../../jobs/sync-user-follows.job";

// Streamer 介面（與 Prisma model 對應）
export interface Streamer {
  id: string;
  twitchUserId: string;
  displayName: string;
  avatarUrl: string;
  channelUrl: string; // 從 Channel 關聯取得
}

/**
 * 處理 Twitch OAuth callback
 * - 交換 code 為 access token
 * - 取得使用者資訊
 * - 建立/更新 Streamer 和 Channel 記錄
 * - 儲存 access token
 * - 回傳 JWT token
 */
export async function handleStreamerTwitchCallback(code: string): Promise<{
  streamer: Streamer;
  accessToken: string;
  refreshToken: string;
}> {
  // 1. 交換 code 為 access token
  const tokenData = await exchangeCodeForToken(code, {
    redirectUri: env.twitchRedirectUri,
  });

  // 2. 取得 Twitch 使用者資訊
  const user = await fetchTwitchUser(tokenData.access_token);
  const channelLogin = user.login ?? user.display_name ?? `twitch-${user.id}`;
  const channelUrl = `https://www.twitch.tv/${channelLogin}`;

  // 3. 使用 transaction 確保資料一致性
  const result = await prisma.$transaction(async (tx) => {
    const streamerRecord = await tx.streamer.upsert({
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
    });

    await tx.channel.upsert({
      where: { twitchChannelId: user.id },
      update: {
        channelName: channelLogin,
        channelUrl: channelUrl,
      },
      create: {
        streamerId: streamerRecord.id,
        twitchChannelId: user.id,
        channelName: channelLogin,
        channelUrl: channelUrl,
      },
    });

    logger.info(
      "Auth",
      `Processing unified login for: ${user.display_name} (${user.id})`
    );

    // 同時 Check/Create Viewer record (實況主也是觀眾)
    const viewerRecord = await tx.viewer.upsert({
      where: { twitchUserId: user.id },
      update: {
        displayName: user.display_name,
        avatarUrl: user.profile_image_url,
        // 確保 Unified Login 時更新 Consent 時間
        consentedAt: new Date(),
      },
      create: {
        twitchUserId: user.id,
        displayName: user.display_name,
        avatarUrl: user.profile_image_url,
        // Streamer 預設視為已同意? 或者保持 null 等待手動同意?
        // 為了方便，我們可以假設 Streamer 登入即同意 Viewer 條款 (因為是同一人操作)
        consentedAt: new Date(),
        consentVersion: 1,
      },
    });

    logger.info("Auth", `Viewer record upserted: ${viewerRecord.id}`);

    const encryptedAccess = encryptToken(tokenData.access_token);
    const encryptedRefresh = tokenData.refresh_token
      ? encryptToken(tokenData.refresh_token)
      : null;

    const expiresAt = tokenData.expires_in
      ? new Date(Date.now() + tokenData.expires_in * 1000)
      : null;

    const existingToken = await tx.twitchToken.findFirst({
      where: {
        ownerType: "streamer",
        streamerId: streamerRecord.id,
      },
    });

    const data = {
      ownerType: "streamer" as const,
      streamerId: streamerRecord.id,
      // 同時關聯 Viewer ID
      viewerId: viewerRecord.id,
      accessToken: encryptedAccess,
      refreshToken: encryptedRefresh,
      expiresAt,
      // 統一登入：合併實況主 + 觀眾所需的所有權限
      scopes: JSON.stringify([
        // 實況主權限
        "user:read:email",
        "channel:read:subscriptions",
        "analytics:read:games",
        "analytics:read:extensions",
        // 觀眾權限
        "chat:read",
        "chat:edit",
        "user:read:follows", // Story 3.6: 追蹤同步
        "user:read:subscriptions",
        "user:read:blocked_users",
        "user:manage:blocked_users",
        "whispers:read",
      ]),
    };

    if (existingToken) {
      await tx.twitchToken.update({ where: { id: existingToken.id }, data });
    } else {
      await tx.twitchToken.create({ data });
    }

    // 回傳包含 viewerId 的複合資料
    return { streamerRecord, viewerRecord };
  });

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
  };

  const accessToken = signAccessToken(jwtPayload);
  const refreshToken = signRefreshToken(jwtPayload);

  // 非同步觸發追蹤名單同步（不阻塞登入流程）
  triggerFollowSyncForUser(
    result.viewerRecord.id,
    tokenData.access_token
  ).catch((err: unknown) =>
    logger.error("Auth", "Follow sync failed after login", err)
  );

  return { streamer, accessToken, refreshToken };
}

// (handleViewerTwitchCallback removed)

/**
 * 根據 Streamer ID 取得 Streamer 資訊
 */
export async function getStreamerById(
  streamerId: string
): Promise<Streamer | null> {
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
    channelUrl:
      channel?.channelUrl ||
      `https://www.twitch.tv/${channel?.channelName || ""}`,
  };
}

/**
 * 根據 Twitch User ID 取得 Streamer 資訊
 */
export async function getStreamerByTwitchId(
  twitchUserId: string
): Promise<Streamer | null> {
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
    channelUrl:
      channel?.channelUrl ||
      `https://www.twitch.tv/${channel?.channelName || ""}`,
  };
}
