import { Request, Response } from "express";
import crypto from "crypto";
import axios from "axios";
import { handleStreamerTwitchCallback } from "./auth.service";
import { TwitchOAuthClient } from "./twitch-oauth.client";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  verifyAccessToken,
} from "./jwt.utils";
import { env } from "../../config/env";
import { authLogger } from "../../utils/logger";
import { prisma } from "../../db/prisma";
import type { AuthRequest } from "./auth.middleware";

const STREAMER_STATE_COOKIE = "twitch_auth_state";

function normalizeUri(value: string): string {
  try {
    return new URL(value).toString();
  } catch {
    return value.trim();
  }
}

function isAllowedRedirectUri(redirectUri?: string): boolean {
  if (!redirectUri) return true;

  const configured = (process.env.TWITCH_ALLOWED_REDIRECT_URIS || "")
    .split(",")
    .map((uri) => uri.trim())
    .filter((uri) => uri.length > 0);

  const allowed = new Set(
    [env.twitchRedirectUri, env.twitchViewerRedirectUri, ...configured].map((uri) => normalizeUri(uri))
  );

  return allowed.has(normalizeUri(redirectUri));
}

export const AUTH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: env.nodeEnv === "production",
  // 使用 "lax" 而非 "none"，避免 third-party cookie 阻擋問題
  // OAuth callback 是 top-level navigation，"lax" 完全支援
  sameSite: "lax" as const,
  path: "/",
};

function setAuthCookies(res: Response, accessToken: string, refreshToken: string) {
  res.cookie("auth_token", accessToken, {
    ...AUTH_COOKIE_OPTIONS,
    maxAge: 60 * 60 * 1000, // 1h
  });

  res.cookie("refresh_token", refreshToken, {
    ...AUTH_COOKIE_OPTIONS,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7d
  });
}

export function clearAuthCookies(res: Response) {
  // 跨域環境下需要手動設置 Set-Cookie 標頭來確保 Cookie 被清除
  // 使用 res.cookie 並確保所有選項與設置時完全一致
  const isProduction = env.nodeEnv === "production";

  // 選項必須與設置時相同
  const expireOptions = {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax" as const,
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
  public login = async (_req: Request, res: Response) => {
    try {
      // 1. 產生隨機 State
      const state = crypto.randomBytes(16).toString("hex");

      // 2. 將 State 存入 HTTP-only Cookie (設定 5 分鐘過期)
      res.cookie(STREAMER_STATE_COOKIE, state, {
        ...AUTH_COOKIE_OPTIONS,
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
          // Epic 4: 快速操作中心
          "channel:manage:broadcast", // 編輯標題/分類/標籤
          "bits:read", // 讀取 Bits 贊助
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

  // Callback：驗證 State 並處理登入（含超時保護）
  public twitchCallback = async (req: Request, res: Response) => {
    const startTime = Date.now();

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
        return res.status(403).json({ message: "Invalid state parameter (CSRF detected)" });
      }

      res.clearCookie(STREAMER_STATE_COOKIE);

      if (!code) {
        return res.status(400).json({ message: "Authorization code missing" });
      }

      authLogger.info("Auth", "Starting OAuth callback processing...");

      // 臨時移除超時限制來診斷問題
      const { accessToken, refreshToken } = await handleStreamerTwitchCallback(code);

      setAuthCookies(res, accessToken, refreshToken);

      const totalTime = Date.now() - startTime;
      authLogger.info("Auth", `OAuth callback completed in ${totalTime}ms`);

      res.redirect(`${env.frontendUrl}/dashboard/viewer`);
    } catch (error) {
      const totalTime = Date.now() - startTime;
      // P0 Security Fix: 避免日誌洩漏敏感資訊（如 tokens、密碼）
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      const errorName = error instanceof Error ? error.name : "UnknownError";
      const errorStack = error instanceof Error ? error.stack : undefined;
      authLogger.error("Twitch Callback Error", {
        errorName,
        errorMessage,
        errorStack,
        duration: totalTime,
      });

      res.redirect(`${env.frontendUrl}/auth/error?reason=internal_error`);
    }
  };

  // Exchange code for tokens (BFF callback)
  public exchange = async (req: Request, res: Response) => {
    const code = req.body?.code as string | undefined;
    const redirectUri = req.body?.redirectUri as string | undefined;

    try {
      if (!code) {
        return res.status(400).json({ message: "Authorization code missing" });
      }

      if (!isAllowedRedirectUri(redirectUri)) {
        return res.status(400).json({ message: "Invalid redirectUri" });
      }

      // 使用前端傳來的 redirectUri（因為 Twitch 要求必須與授權時相同）
      // 如果沒傳則使用後端預設值（向後相容）
      const { accessToken, refreshToken } = await handleStreamerTwitchCallback(code, redirectUri);
      return res.json({ accessToken, refreshToken });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      const statusCode = axios.isAxiosError(error) ? error.response?.status : undefined;
      const twitchResponse = axios.isAxiosError(error) ? error.response?.data : undefined;

      authLogger.error("Twitch Exchange Error", {
        errorMessage,
        statusCode,
        requestRedirectUri: redirectUri || env.twitchRedirectUri,
        codeLength: code?.length,
        twitchResponse,
      });

      return res.status(500).json({ message: "Token exchange failed" });
    }
  };

  public me = async (req: AuthRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    // 立即回傳使用者資料，不阻塞回應
    const response = res.json({ user: req.user });

    // 非同步執行聊天室監聽（不阻塞回應）
    // 當前端查詢個人資料時，順便確保該使用者的聊天室已被監聽
    // 這是一個保險機制，確保即時互動能被記錄
    // 注意：必須使用英文 login (從 channelUrl 提取)，而非中文 displayName
    if (req.user.channelUrl) {
      // 延遲執行，避免阻塞回應
      setImmediate(() => {
        const channelLogin = req.user.channelUrl.split("/").pop();
        if (channelLogin) {
          import("../../services/twitch-chat.service")
            .then(({ twurpleChatService }) => {
              twurpleChatService.joinChannel(channelLogin).catch(() => {});
            })
            .catch(() => {});
        }
      });
    }

    return response;
  };

  public logout = async (req: Request, res: Response) => {
    try {
      // 從 cookie 中讀取 token 並解碼，增加 tokenVersion 使舊 Token 失效
      const token = req.cookies?.auth_token;
      if (token) {
        const decoded = verifyAccessToken(token);
        if (decoded?.viewerId) {
          await prisma.viewer.update({
            where: { id: decoded.viewerId },
            data: { tokenVersion: { increment: 1 } },
          });
        }
      }
    } catch {
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

    // P0 Security Fix: Validate tokenVersion to prevent use of invalidated tokens
    // After logout, tokenVersion is incremented, making old tokens invalid
    if (payload.viewerId) {
      const viewer = await prisma.viewer.findUnique({
        where: { id: payload.viewerId },
        select: { tokenVersion: true },
      });

      if (!viewer) {
        return res.status(401).json({ error: "User not found" });
      }

      // If tokenVersion in JWT doesn't match DB, token has been invalidated (user logged out)
      if (payload.tokenVersion !== viewer.tokenVersion) {
        clearAuthCookies(res);
        return res.status(401).json({ error: "Token has been invalidated" });
      }
    }

    const { tokenType: _tokenType, ...rest } = payload;
    const newAccess = signAccessToken(rest);
    const newRefresh = signRefreshToken(rest);
    setAuthCookies(res, newAccess, newRefresh);
    return res.json({ message: "refreshed" });
  };
}
