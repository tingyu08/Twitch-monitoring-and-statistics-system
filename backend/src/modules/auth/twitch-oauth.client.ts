import axios from "axios";
import { env } from "../../config/env";

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
    const response = await axios.post(this.tokenUrl, null, {
      params: {
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: options?.redirectUri ?? this.redirectUri,
      },
    });
    return response.data;
  }

  public async getUserInfo(accessToken: string): Promise<TwitchUser> {
    const response = await axios.get(this.userInfoUrl, {
      headers: {
        "Client-Id": this.clientId,
        Authorization: `Bearer ${accessToken}`,
      },
    });
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
      const response = await axios.post(this.tokenUrl, null, {
        params: {
          client_id: this.clientId,
          client_secret: this.clientSecret,
          grant_type: "refresh_token",
          refresh_token: refreshToken,
        },
      });
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
    let total = 0;
    const byTier = { tier1: 0, tier2: 0, tier3: 0 };
    let cursor: string | undefined;

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
      } while (cursor);
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
