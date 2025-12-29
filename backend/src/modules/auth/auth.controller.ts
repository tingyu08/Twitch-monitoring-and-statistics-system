import { Request, Response } from "express";
import crypto from "crypto";
import { handleStreamerTwitchCallback } from "./auth.service";
import { TwitchOAuthClient } from "./twitch-oauth.client";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  verifyAccessToken,
  type JWTPayload,
} from "./jwt.utils";
import { env } from "../../config/env";
import { authLogger } from "../../utils/logger";
import { prisma } from "../../db/prisma";

// 擴展 Express Request 類型以支援 user 屬性
interface AuthenticatedRequest extends Request {
  user?: JWTPayload;
}

const STREAMER_STATE_COOKIE = "twitch_auth_state";

const DEFAULT_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: env.nodeEnv === "production", // HTTPS required for sameSite=none
  sameSite: (env.nodeEnv === "production" ? "none" : "lax") as "none" | "lax",
  path: "/",
};

function setAuthCookies(
  res: Response,
  accessToken: string,
  refreshToken: string
) {
  res.cookie("auth_token", accessToken, {
    ...DEFAULT_COOKIE_OPTIONS,
    maxAge: 60 * 60 * 1000, // 1h
  });

  res.cookie("refresh_token", refreshToken, {
    ...DEFAULT_COOKIE_OPTIONS,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7d
  });
}

function clearAuthCookies(res: Response) {
  // 跨域環境下需要手動設置 Set-Cookie 標頭來確保 Cookie 被清除
  // 使用 res.cookie 並確保所有選項與設置時完全一致
  const isProduction = env.nodeEnv === "production";

  // 選項必須與設置時相同
  const expireOptions = {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? ("none" as const) : ("lax" as const),
    path: "/",
    maxAge: -1, // 負數表示立即刪除
  };

  // 設置空值並過期
  res.cookie("auth_token", "deleted", expireOptions);
  res.cookie("refresh_token", "deleted", expireOptions);
}

export class AuthController {
  private twitchClient: TwitchOAuthClient;

  constructor(client?: TwitchOAuthClient) {
    this.twitchClient = client || new TwitchOAuthClient();
  }

  // 登入：產生 State 並導向 Twitch
  public login = async (req: Request, res: Response) => {
    try {
      // 1. 產生隨機 State
      const state = crypto.randomBytes(16).toString("hex");

      // 2. 將 State 存入 HTTP-only Cookie (設定 5 分鐘過期)
      res.cookie(STREAMER_STATE_COOKIE, state, {
        ...DEFAULT_COOKIE_OPTIONS,
        maxAge: 5 * 60 * 1000,
      });

      // 3. 取得帶有 State 的授權 URL (統一登入：請求所有權限)
      const authUrl = this.twitchClient.getOAuthUrl(state, {
        redirectUri: env.twitchRedirectUri,
        // 統一登入：合併實況主 + 觀眾所需的所有權限
        scopes: [
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
        ],
      });

      // 4. 導向
      res.redirect(authUrl);
    } catch (error) {
      authLogger.error("Login Redirect Error:", error);
      res.status(500).json({ message: "Internal Server Error" });
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
        authLogger.warn(`Twitch Auth Error: ${error} - ${error_description}`);
        return res.redirect(`${env.frontendUrl}/auth/error?reason=${error}`);
      }

      // 1. 驗證 State (CSRF 防護)
      const storedState = req.cookies[STREAMER_STATE_COOKIE];
      if (!state || !storedState || state !== storedState) {
        authLogger.error("CSRF State Mismatch");
        return res
          .status(403)
          .json({ message: "Invalid state parameter (CSRF detected)" });
      }

      res.clearCookie(STREAMER_STATE_COOKIE);

      if (!code) {
        return res.status(400).json({ message: "Authorization code missing" });
      }

      const { accessToken, refreshToken } = await handleStreamerTwitchCallback(
        code
      );

      setAuthCookies(res, accessToken, refreshToken);

      res.redirect(`${env.frontendUrl}/dashboard/viewer`);
    } catch (error) {
      console.error("[AuthCallbackError] Detailed error:", error);
      authLogger.error("Twitch Callback Error:", error);
      res.redirect(`${env.frontendUrl}/auth/error?reason=internal_error`);
    }
  };

  public me = async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    return res.json({ user: req.user });
  };

  public logout = async (req: Request, res: Response) => {
    try {
      // 從 cookie 中讀取 token 並解碼
      const token = req.cookies?.auth_token;
      console.log("[Logout] Token present:", !!token);
      if (token) {
        // auth_token 是 access token，所以先用 verifyAccessToken
        const decoded = verifyAccessToken(token);
        console.log("[Logout] Token decoded:", !!decoded, decoded?.viewerId);
        if (decoded?.viewerId) {
          // 增加 tokenVersion 使舊 Token 失效
          const result = await prisma.viewer.update({
            where: { id: decoded.viewerId },
            data: { tokenVersion: { increment: 1 } },
          });
          console.log(
            `[Logout] Incremented tokenVersion for viewer ${decoded.viewerId}, new version: ${result.tokenVersion}`
          );
        }
      }
    } catch (error) {
      console.error("[Logout] Error incrementing tokenVersion:", error);
      // 即使失敗也繼續清除 Cookie
    }

    clearAuthCookies(res);
    return res.status(200).json({ message: "Logged out successfully" });
  };

  public refresh = async (req: Request, res: Response) => {
    const refreshToken = req.cookies?.refresh_token;
    if (!refreshToken) {
      return res.status(401).json({ error: "Missing refresh token" });
    }

    const payload = verifyRefreshToken(refreshToken);
    if (!payload) {
      return res.status(401).json({ error: "Invalid refresh token" });
    }

    const { tokenType: _tokenType, ...rest } = payload;
    const newAccess = signAccessToken(rest);
    const newRefresh = signRefreshToken(rest);
    setAuthCookies(res, newAccess, newRefresh);
    return res.json({ message: "refreshed" });
  };
}
