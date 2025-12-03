import { exchangeCodeForToken, fetchTwitchUser } from "./twitch-oauth.client";
import { signToken, type JWTPayload } from "./jwt.utils";

export interface Streamer {
  id: string;
  twitchUserId: string;
  displayName: string;
  avatarUrl: string;
  channelUrl: string; // Twitch 頻道連結
}

// 暫時使用 in-memory 儲存，未來可換成 Prisma / DB 實作
const streamersByTwitchId = new Map<string, Streamer>();

export async function handleTwitchCallback(code: string): Promise<{
  streamer: Streamer;
  jwtToken: string;
}> {
  const token = await exchangeCodeForToken(code);
  const user = await fetchTwitchUser(token.access_token);

  const channelUrl = `https://www.twitch.tv/${user.login}`;
  
  let streamer = streamersByTwitchId.get(user.id);
  if (!streamer) {
    streamer = {
      id: `streamer_${user.id}`,
      twitchUserId: user.id,
      displayName: user.display_name,
      avatarUrl: user.profile_image_url,
      channelUrl,
    };
  } else {
    streamer = {
      ...streamer,
      displayName: user.display_name,
      avatarUrl: user.profile_image_url,
      channelUrl,
    };
  }

  streamersByTwitchId.set(user.id, streamer);

  // 建立 JWT token
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


