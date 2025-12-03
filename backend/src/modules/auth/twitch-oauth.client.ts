import axios from "axios";
import { env } from "../../config/env";

const TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const TWITCH_USER_URL = "https://api.twitch.tv/helix/users";

export interface TwitchTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string[];
  token_type: string;
}

export interface TwitchUser {
  id: string;
  login: string;
  display_name: string;
  profile_image_url: string;
}

export async function exchangeCodeForToken(
  code: string
): Promise<TwitchTokenResponse> {
  // #region agent log
  const fs = require("fs");
  const path = require("path");
  const logPath = path.resolve(__dirname, "..", "..", "..", ".cursor", "debug.log");
  const logDir = path.dirname(logPath);
  try {
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    const logEntry = JSON.stringify({
      location: "twitch-oauth.client.ts:25",
      message: "Exchanging code for token",
      data: {
        clientIdSet: !!env.twitchClientId,
        clientIdLength: env.twitchClientId.length,
        clientSecretSet: !!env.twitchClientSecret,
        codeLength: code?.length || 0,
      },
      timestamp: Date.now(),
      sessionId: "debug-session",
      runId: "oauth-flow",
      hypothesisId: "H4",
    }) + "\n";
    fs.appendFileSync(logPath, logEntry);
  } catch (_) {}
  // #endregion

  const params = new URLSearchParams({
    client_id: env.twitchClientId,
    client_secret: env.twitchClientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: env.twitchRedirectUri,
  });

  try {
    const { data } = await axios.post<TwitchTokenResponse>(
      TWITCH_TOKEN_URL,
      params
    );
    return data;
  } catch (error: any) {
    // #region agent log
    const fs = require("fs");
    const path = require("path");
    const logPath = path.resolve(__dirname, "..", "..", "..", ".cursor", "debug.log");
    const logDir = path.dirname(logPath);
    try {
      if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
      const logEntry = JSON.stringify({
        location: "twitch-oauth.client.ts:45",
        message: "Token exchange failed",
        data: {
          errorStatus: error?.response?.status,
          errorMessage: error?.response?.data?.message || error?.message,
          errorData: error?.response?.data,
        },
        timestamp: Date.now(),
        sessionId: "debug-session",
        runId: "oauth-flow",
        hypothesisId: "H4",
      }) + "\n";
      fs.appendFileSync(logPath, logEntry);
    } catch (_) {}
    // #endregion
    throw error;
  }
}

export async function fetchTwitchUser(
  accessToken: string
): Promise<TwitchUser> {
  const { data } = await axios.get<{ data: TwitchUser[] }>(TWITCH_USER_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Client-Id": env.twitchClientId,
    },
  });

  if (!data.data?.length) {
    throw new Error("No Twitch user returned from API");
  }

  return data.data[0];
}


