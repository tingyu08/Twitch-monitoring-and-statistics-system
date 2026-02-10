import { NextRequest, NextResponse } from "next/server";

const NO_STORE_CACHE_CONTROL = "private, no-store, max-age=0";

function withNoStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", NO_STORE_CACHE_CONTROL);
  return response;
}

/**
 * Twitch OAuth Callback Handler
 * 處理 Twitch 回傳的 authorization code，轉發給後端交換 Token
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const error = searchParams.get("error");
  const state = searchParams.get("state"); // 必須傳遞 state 用於 CSRF 驗證
  const errorDescription = searchParams.get("error_description");

  // 1. 處理 Twitch 回傳的錯誤
  if (error) {
    console.error(`[Auth Callback] Twitch Error: ${error} - ${errorDescription}`);
    return withNoStore(NextResponse.redirect(new URL(`/?error=${error}`, request.url)));
  }

  // 2. 如果沒有 code，視為異常請求
  if (!code) {
    console.error("[Auth Callback] No authorization code received");
    return withNoStore(NextResponse.redirect(new URL("/?error=no_code", request.url)));
  }

  const storedState = request.cookies.get("twitch_auth_state")?.value;
  if (!state || !storedState || state !== storedState) {
    console.error("[Auth Callback] CSRF State Mismatch");
    return withNoStore(NextResponse.redirect(new URL("/?error=state_mismatch", request.url)));
  }

  try {
    const backendDataUrl =
      process.env.NEXT_PUBLIC_BACKEND_URL ||
      process.env.BACKEND_URL ||
      process.env.NEXT_PUBLIC_API_BASE_URL ||
      "http://127.0.0.1:4000";

    // 必須傳遞 redirect_uri，因為 Twitch 要求交換 token 時的 redirect_uri
    // 必須與授權請求時完全相同
    const origin = request.nextUrl.origin;
    const redirectUri = `${origin}/auth/twitch/callback`;

    const exchangeResponse = await fetch(`${backendDataUrl}/auth/twitch/exchange`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ code, redirectUri }),
    });

    if (!exchangeResponse.ok) {
      console.error("[Auth Callback] Token exchange failed", exchangeResponse.status);
      return withNoStore(NextResponse.redirect(new URL("/?error=exchange_failed", request.url)));
    }

    const { accessToken, refreshToken } = (await exchangeResponse.json()) as {
      accessToken: string;
      refreshToken: string;
    };

    const isProd = process.env.NODE_ENV === "production";
    const response = NextResponse.redirect(new URL("/dashboard/viewer", request.url));

    // 使用 "lax" 而非 "none" 以避免 third-party cookie 阻擋問題
    // 因為前端和 API routes 在同一個域名下，不需要 cross-site cookie
    response.cookies.set("auth_token", accessToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60,
    });

    response.cookies.set("refresh_token", refreshToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: "lax",
      path: "/",
      maxAge: 7 * 24 * 60 * 60,
    });

    response.cookies.delete("twitch_auth_state");
    return withNoStore(response);
  } catch (err) {
    console.error("[Auth Callback] Error building redirect URL:", err);
    return withNoStore(NextResponse.redirect(new URL("/?error=server_error", request.url)));
  }
}
