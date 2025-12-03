import type { Request, Response } from "express";
import { env } from "../../config/env";
import { handleTwitchCallback } from "./auth.service";

export function getTwitchLoginUrl(): string {
  // ... (保留原本的 getTwitchLoginUrl 內容不變) ...
  // #region agent log
  const fs = require("fs");
  const path = require("path");
  const logPath = path.resolve(__dirname, "..", "..", "..", ".cursor", "debug.log");
  const logDir = path.dirname(logPath);
  try {
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    const logEntry = JSON.stringify({
      location: "auth.controller.ts:6",
      message: "Generating Twitch login URL",
      data: {
        clientIdSet: !!env.twitchClientId,
        clientIdLength: env.twitchClientId.length,
        redirectUri: env.twitchRedirectUri,
      },
      timestamp: Date.now(),
      sessionId: "debug-session",
      runId: "oauth-flow",
      hypothesisId: "H3",
    }) + "\n";
    fs.appendFileSync(logPath, logEntry);
  } catch (_) {}
  // #endregion

  const params = new URLSearchParams({
    client_id: env.twitchClientId,
    redirect_uri: env.twitchRedirectUri,
    response_type: "code",
    scope: "user:read:email",
  });

  return `https://id.twitch.tv/oauth2/authorize?${params.toString()}`;
}

export async function twitchLoginHandler(
  _req: Request,
  res: Response
): Promise<void> {
  const url = getTwitchLoginUrl();
  res.redirect(url);
}

export async function twitchCallbackHandler(
  req: Request,
  res: Response
): Promise<void> {
  const { code, error } = req.query as { code?: string; error?: string };

  if (error || !code) {
    // 導回前端並帶上錯誤參數
    const redirectUrl = new URL(env.frontendUrl); // 回首頁
    redirectUrl.searchParams.set("error", error || "authorization_failed");
    res.redirect(redirectUrl.toString());
    return;
  }

  try {
    const { jwtToken } = await handleTwitchCallback(code);

    // [FIX] 安全性修正：後端直接設定 Cookie，不透過 URL 傳遞 Token
    
    // 計算過期時間 (7天)
    const expires = new Date();
    expires.setDate(expires.getDate() + 7);

    res.cookie("auth_token", jwtToken, {
      httpOnly: true, // 防止 XSS
      secure: env.nodeEnv === "production", // 生產環境強制 HTTPS
      sameSite: "lax", // 允許 OAuth 重導向後寫入
      path: "/", // 全站有效
      expires: expires,
      // domain: ".yourdomain.com" // 生產環境如果跨子網域需要設定這個
    });

    // #region agent log
    const fs = require("fs");
    const path = require("path");
    const logPath = path.resolve(__dirname, "..", "..", "..", ".cursor", "debug.log");
    const logDir = path.dirname(logPath);
    try {
      if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
      const logEntry = JSON.stringify({
        location: "auth.controller.ts:45",
        message: "Setting auth_token cookie directly from backend",
        data: {
          tokenLength: jwtToken.length,
          secure: env.nodeEnv === "production",
          frontendUrl: env.frontendUrl,
        },
        timestamp: Date.now(),
        sessionId: "debug-session",
        runId: "oauth-flow",
        hypothesisId: "H5-Security-Fix",
      }) + "\n";
      fs.appendFileSync(logPath, logEntry);
    } catch (_) {}
    // #endregion

    // 直接導向到前端 Dashboard
    // 由於 Cookie 已經設定在 localhost，前端發送 API 請求時會自動帶上
    res.redirect(`${env.frontendUrl}/dashboard/streamer`);

  } catch (e) {
    console.error("Twitch Callback Error:", e);
    const redirectUrl = new URL(env.frontendUrl);
    redirectUrl.searchParams.set("error", "callback_exception");
    res.redirect(redirectUrl.toString());
  }
}