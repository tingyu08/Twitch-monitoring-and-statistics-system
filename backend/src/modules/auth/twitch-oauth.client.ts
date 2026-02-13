import axios from "axios";
import { env } from "../../config/env";

const OAUTH_REQUEST_TIMEOUT_MS = Number(process.env.TWITCH_OAUTH_TIMEOUT_MS || 20000);
const OAUTH_MAX_ATTEMPTS = Math.max(Number(process.env.TWITCH_OAUTH_MAX_ATTEMPTS || 3), 1);
const OAUTH_RETRY_BASE_DELAY_MS = Number(process.env.TWITCH_OAUTH_RETRY_BASE_DELAY_MS || 400);

function isRetryableOAuthError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) {
    return false;
  }

  const status = error.response?.status;
  if (status === 429 || (status !== undefined && status >= 500)) {
    return true;
  }

  const code = error.code || "";
  if (["ECONNABORTED", "ETIMEDOUT", "ECONNRESET", "EAI_AGAIN", "ENOTFOUND"].includes(code)) {
    return true;
  }

  const message = (error.message || "").toLowerCase();
  return message.includes("timeout") || message.includes("socket hang up");
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function withOAuthRetry<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= OAUTH_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (!isRetryableOAuthError(error) || attempt >= OAUTH_MAX_ATTEMPTS) {
        throw error;
      }

      const delayMs = Math.min(OAUTH_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1), 3000);
      await wait(delayMs);
    }
  }

  throw lastError;
}

export interface TwitchUser {
  id: string;
  display_name: string;
  login?: string;
  email?: string;
  profile_image_url?: string;
}

export class TwitchOAuthClient {
  private readonly clientId = env.twitchClientId;
  private readonly clientSecret = env.twitchClientSecret;
  private readonly redirectUri = env.twitchRedirectUri;
  private readonly tokenUrl = "https://id.twitch.tv/oauth2/token";
  private readonly userInfoUrl = "https://api.twitch.tv/helix/users";

  /**
   * 生成 Twitch 授權 URL
   * @param state 防止 CSRF 的隨機字串
   */
  public getOAuthUrl(state: string, options?: { redirectUri?: string; scopes?: string[] }): string {
    const scopes = options?.scopes ?? [
      "user:read:email",
      "channel:read:subscriptions",
      "analytics:read:games",
      "analytics:read:extensions",
    ];

    const url = new URL("https://id.twitch.tv/oauth2/authorize");
    url.searchParams.append("client_id", this.clientId);
    url.searchParams.append("redirect_uri", options?.redirectUri ?? this.redirectUri);
    url.searchParams.append("response_type", "code");
    url.searchParams.append("scope", scopes.join(" "));
    url.searchParams.append("state", state);

    return url.toString();
  }

  public async getAccessToken(
    code: string,
    options?: { redirectUri?: string }
  ): Promise<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
  }> {
    const response = await withOAuthRetry(() =>
      axios.post(this.tokenUrl, null, {
        params: {
          client_id: this.clientId,
          client_secret: this.clientSecret,
          code,
          grant_type: "authorization_code",
          redirect_uri: options?.redirectUri ?? this.redirectUri,
        },
        timeout: OAUTH_REQUEST_TIMEOUT_MS,
      })
    );
    return response.data;
  }

  public async getUserInfo(accessToken: string): Promise<TwitchUser> {
    const response = await withOAuthRetry(() =>
      axios.get(this.userInfoUrl, {
        headers: {
          "Client-Id": this.clientId,
          Authorization: `Bearer ${accessToken}`,
        },
        timeout: OAUTH_REQUEST_TIMEOUT_MS,
      })
    );
    return response.data.data?.[0] as TwitchUser;
  }

  /**
   * 讀取實況主訂閱資料並計算總數與分層統計
   */
  /**
   * 使用 Refresh Token 刷新 Access Token
   * @param refreshToken 有效的 refresh token
   * @returns 新的 access token 和 refresh token
   */
  public async refreshAccessToken(refreshToken: string): Promise<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
  }> {
    try {
      const response = await withOAuthRetry(() =>
        axios.post(this.tokenUrl, null, {
          params: {
            client_id: this.clientId,
            client_secret: this.clientSecret,
            grant_type: "refresh_token",
            refresh_token: refreshToken,
          },
          timeout: OAUTH_REQUEST_TIMEOUT_MS,
        })
      );
      return response.data;
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        if (status === 400 || status === 401) {
          throw new Error("Refresh token is invalid or expired. User needs to re-authenticate.");
        }
      }
      throw new Error("Failed to refresh access token");
    }
  }

  public async getBroadcasterSubscriptions(
    broadcasterId: string,
    accessToken: string
  ): Promise<{
    total: number;
    byTier: { tier1: number; tier2: number; tier3: number };
  }> {
    const subscriptionsUrl = "https://api.twitch.tv/helix/subscriptions";
    const MAX_PAGES = 100;
    let total = 0;
    const byTier = { tier1: 0, tier2: 0, tier3: 0 };
    let cursor: string | undefined;
    let page = 0;

    try {
      do {
        const params: Record<string, string | number | undefined> = {
          broadcaster_id: broadcasterId,
          first: 100,
          after: cursor,
        };

        const response = await axios.get(subscriptionsUrl, {
          headers: {
            "Client-Id": this.clientId,
            Authorization: `Bearer ${accessToken}`,
          },
          params,
        });

        const subscriptions: Array<{ tier: string }> = response.data.data ?? [];
        total += subscriptions.length;

        subscriptions.forEach((sub) => {
          switch (sub.tier) {
            case "1000":
              byTier.tier1++;
              break;
            case "2000":
              byTier.tier2++;
              break;
            case "3000":
              byTier.tier3++;
              break;
          }
        });

        cursor = response.data.pagination?.cursor;
        page += 1;
      } while (cursor && page < MAX_PAGES);

      if (cursor) {
        throw new Error(`Subscription pagination exceeded ${MAX_PAGES} pages`);
      }
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        if (status === 401) {
          throw new Error("Unauthorized: Token may be expired or invalid");
        }
        if (status === 403) {
          throw new Error("Forbidden: Broadcaster ID does not match token user or missing scope");
        }
        if (status === 429) {
          throw new Error("Rate limit exceeded: Please try again later");
        }
      }
      throw new Error("Failed to get broadcaster subscriptions from Twitch");
    }

    return { total, byTier };
  }
}

// 單例供方法形式使用
const clientInstance = new TwitchOAuthClient();

export async function exchangeCodeForToken(
  code: string,
  options?: { redirectUri?: string }
): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
}> {
  return clientInstance.getAccessToken(code, options);
}

export async function fetchTwitchUser(accessToken: string): Promise<TwitchUser> {
  return clientInstance.getUserInfo(accessToken);
}
