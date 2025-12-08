import axios from 'axios';
import { env } from '../../config/env';

export class TwitchOAuthClient {
  private readonly clientId = env.twitchClientId;
  private readonly clientSecret = env.twitchClientSecret;
  private readonly redirectUri = env.twitchRedirectUri;
  private readonly tokenUrl = 'https://id.twitch.tv/oauth2/token';
  private readonly validateUrl = 'https://id.twitch.tv/oauth2/validate';
  private readonly userInfoUrl = 'https://api.twitch.tv/helix/users';

  /**
   * 產生 Twitch 授權 URL
   * @param state 防止 CSRF 的隨機字串
   */
  public getOAuthUrl(state: string): string {
    const scopes = [
      'user:read:email',
      'channel:read:subscriptions',
      'analytics:read:games',
      'analytics:read:extensions'
    ].join(' ');

    const url = new URL('https://id.twitch.tv/oauth2/authorize');
    url.searchParams.append('client_id', this.clientId);
    url.searchParams.append('redirect_uri', this.redirectUri);
    url.searchParams.append('response_type', 'code');
    url.searchParams.append('scope', scopes);
    url.searchParams.append('state', state); // 加入 state 參數

    return url.toString();
  }

  // ... existing code (getAccessToken, getUserInfo, etc.) ...
  
  public async getAccessToken(code: string): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
    try {
      const response = await axios.post(this.tokenUrl, null, {
        params: {
          client_id: this.clientId,
          client_secret: this.clientSecret,
          code,
          grant_type: 'authorization_code',
          redirect_uri: this.redirectUri,
        },
      });
      return response.data;
    } catch (error) {
      console.error('Twitch Token Error:', error);
      throw new Error('Failed to retrieve access token from Twitch');
    }
  }

  public async getUserInfo(accessToken: string): Promise<any> {
    try {
      const response = await axios.get(this.userInfoUrl, {
        headers: {
          'Client-Id': this.clientId,
          'Authorization': `Bearer ${accessToken}`,
        },
      });
      return response.data.data[0];
    } catch (error) {
       console.error('Twitch User Info Error:', error);
       throw new Error('Failed to get user info from Twitch');
    }
  }
}

// 建立單例實例供函數匯出使用
const clientInstance = new TwitchOAuthClient();

/**
 * 使用 authorization code 交換 access token
 * @param code - Twitch OAuth authorization code
 */
export async function exchangeCodeForToken(code: string): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
  return clientInstance.getAccessToken(code);
}

/**
 * 取得 Twitch 使用者資訊
 * @param accessToken - Twitch access token
 */
export async function fetchTwitchUser(accessToken: string): Promise<any> {
  return clientInstance.getUserInfo(accessToken);
}