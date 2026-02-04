import { NextRequest, NextResponse } from "next/server";

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
    return NextResponse.redirect(new URL(`/?error=${error}`, request.url));
  }

  // 2. 如果沒有 code，視為異常請求
  if (!code) {
    console.error("[Auth Callback] No authorization code received");
    return NextResponse.redirect(new URL("/?error=no_code", request.url));
  }

  const storedState = request.cookies.get("twitch_auth_state")?.value;
  if (!state || !storedState || state !== storedState) {
    console.error("[Auth Callback] CSRF State Mismatch");
    return NextResponse.redirect(new URL("/?error=state_mismatch", request.url));
  }

  try {
    const backendDataUrl =
      process.env.NEXT_PUBLIC_BACKEND_URL ||
      process.env.BACKEND_URL ||
      process.env.NEXT_PUBLIC_API_BASE_URL ||
      "http://127.0.0.1:4000";

    const exchangeResponse = await fetch(`${backendDataUrl}/auth/twitch/exchange`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ code }),
    });

    if (!exchangeResponse.ok) {
      console.error("[Auth Callback] Token exchange failed", exchangeResponse.status);
      return NextResponse.redirect(new URL("/?error=exchange_failed", request.url));
    }

    const { accessToken, refreshToken } = (await exchangeResponse.json()) as {
      accessToken: string;
      refreshToken: string;
    };

    const isProd = process.env.NODE_ENV === "production";
    const response = NextResponse.redirect(new URL("/dashboard/viewer", request.url));

    response.cookies.set("auth_token", accessToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? "none" : "lax",
      path: "/",
      maxAge: 60 * 60,
    });

    response.cookies.set("refresh_token", refreshToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? "none" : "lax",
      path: "/",
      maxAge: 7 * 24 * 60 * 60,
    });

    response.cookies.delete("twitch_auth_state");
    return response;
  } catch (err) {
    console.error("[Auth Callback] Error building redirect URL:", err);
    return NextResponse.redirect(new URL("/?error=server_error", request.url));
  }
}
