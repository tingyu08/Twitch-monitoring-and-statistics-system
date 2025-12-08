import { Request, Response } from 'express';
import crypto from 'crypto';
import { handleTwitchCallback, Streamer } from './auth.service';
import { TwitchOAuthClient } from './twitch-oauth.client';
import { signToken, JWTPayload } from './jwt.utils';
import { env } from '../../config/env';

// 擴展 Express Request 類型以支援 user 屬性
interface AuthenticatedRequest extends Request {
  user?: JWTPayload;
}

const twitchClient = new TwitchOAuthClient();

export class AuthController {
  
  // 登入：產生 State 並導向 Twitch
  public login = async (req: Request, res: Response) => {
    try {
      // 1. 產生隨機 State
      const state = crypto.randomBytes(16).toString('hex');
      
      // 2. 將 State 存入 HTTP-only Cookie (設定 5 分鐘過期)
      res.cookie('twitch_auth_state', state, {
        httpOnly: true,
        secure: env.nodeEnv === 'production',
        maxAge: 5 * 60 * 1000, 
        sameSite: 'lax'
      });

      // 3. 取得帶有 State 的授權 URL
      const authUrl = twitchClient.getOAuthUrl(state);
      
      // 4. 導向
      res.redirect(authUrl);
    } catch (error) {
      console.error('Login Redirect Error:', error);
      res.status(500).json({ message: 'Internal Server Error' });
    }
  };

  // Callback：驗證 State 並處理登入
  public twitchCallback = async (req: Request, res: Response) => {
    try {
      // 確保將 query 參數視為字串處理
      const code = req.query.code as string;
      const state = req.query.state as string;
      const error = req.query.error as string;
      const error_description = req.query.error_description as string;

      // 0. 處理 Twitch 回傳的錯誤 (例如使用者拒絕)
      if (error) {
        console.warn(`Twitch Auth Error: ${error} - ${error_description}`);
        return res.redirect(`${env.frontendUrl}/auth/error?reason=${error}`);
      }

      // 1. 驗證 State (CSRF 防護)
      const storedState = req.cookies['twitch_auth_state'];
      if (!state || !storedState || state !== storedState) {
        console.error('CSRF State Mismatch');
        return res.status(403).json({ message: 'Invalid state parameter (CSRF detected)' });
      }

      // 清除 State Cookie
      res.clearCookie('twitch_auth_state');

      if (!code) {
        return res.status(400).json({ message: 'Authorization code missing' });
      }

      // 2. 透過 Service 處理登入邏輯 (使用現有的 handleTwitchCallback)
      const { streamer, jwtToken } = await handleTwitchCallback(code);

      // 3. 設定 JWT Cookie (Token 已由 service 產生)
      res.cookie('auth_token', jwtToken, {
        httpOnly: true,
        secure: env.nodeEnv === 'production',
        maxAge: 24 * 60 * 60 * 1000, // 1 day
        sameSite: 'lax'
      });

      // 4. 導向回前端 Dashboard
      res.redirect(`${env.frontendUrl}/dashboard/streamer`);

    } catch (error) {
      console.error('Twitch Callback Error:', error);
      res.redirect(`${env.frontendUrl}/auth/error?reason=internal_error`);
    }
  };

  public me = async (req: AuthenticatedRequest, res: Response) => {
      // 假設 middleware 已經將 user 放入 req.user
      if (!req.user) {
          return res.status(401).json({ message: 'Unauthorized' });
      }
      return res.json({ user: req.user });
  };

  public logout = async (req: Request, res: Response) => {
      res.clearCookie('auth_token');
      return res.status(200).json({ message: 'Logged out successfully' });
  };
}