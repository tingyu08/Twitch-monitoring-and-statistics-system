import { exchangeCodeForToken, fetchTwitchUser } from "./twitch-oauth.client";
import { signToken, type JWTPayload } from "./jwt.utils";
import { prisma } from "../../db/prisma";

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
export async function handleTwitchCallback(code: string): Promise<{
  streamer: Streamer;
  jwtToken: string;
}> {
  // 1. 交換 code 為 access token
  const tokenData = await exchangeCodeForToken(code);
  
  // 2. 取得 Twitch 使用者資訊
  const user = await fetchTwitchUser(tokenData.access_token);
  const channelUrl = `https://www.twitch.tv/${user.login}`;

  // 3. 使用 transaction 確保資料一致性
  const result = await prisma.$transaction(async (tx) => {
    // 3a. 建立或更新 Streamer
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

    // 3b. 建立或更新 Channel（1:1 對應 Streamer）
    await tx.channel.upsert({
      where: { twitchChannelId: user.id },
      update: {
        channelName: user.login,
        channelUrl: channelUrl,
      },
      create: {
        streamerId: streamerRecord.id,
        twitchChannelId: user.id,
        channelName: user.login,
        channelUrl: channelUrl,
      },
    });

    // 3c. 儲存或更新 Twitch Token
    const existingToken = await tx.twitchToken.findFirst({
      where: {
        ownerType: 'streamer',
        streamerId: streamerRecord.id,
      },
    });

    if (existingToken) {
      await tx.twitchToken.update({
        where: { id: existingToken.id },
        data: {
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token || null,
          expiresAt: tokenData.expires_in 
            ? new Date(Date.now() + tokenData.expires_in * 1000)
            : null,
          scopes: JSON.stringify(['user:read:email']),
        },
      });
    } else {
      await tx.twitchToken.create({
        data: {
          ownerType: 'streamer',
          streamerId: streamerRecord.id,
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token || null,
          expiresAt: tokenData.expires_in 
            ? new Date(Date.now() + tokenData.expires_in * 1000)
            : null,
          scopes: JSON.stringify(['user:read:email']),
        },
      });
    }

    return streamerRecord;
  });

  // 4. 建立回傳的 Streamer 物件
  const streamer: Streamer = {
    id: result.id,
    twitchUserId: result.twitchUserId,
    displayName: result.displayName,
    avatarUrl: result.avatarUrl || '',
    channelUrl: channelUrl,
  };

  // 5. 建立 JWT token
  const jwtPayload: JWTPayload = {
    streamerId: streamer.id,
    twitchUserId: streamer.twitchUserId,
    displayName: streamer.displayName,
    avatarUrl: streamer.avatarUrl,
    channelUrl: streamer.channelUrl,
  };

  const jwtToken = signToken(jwtPayload);

  return { streamer, jwtToken };
}

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
    avatarUrl: streamerRecord.avatarUrl || '',
    channelUrl: channel?.channelUrl || `https://www.twitch.tv/${channel?.channelName || ''}`,
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
    avatarUrl: streamerRecord.avatarUrl || '',
    channelUrl: channel?.channelUrl || `https://www.twitch.tv/${channel?.channelName || ''}`,
  };
}
