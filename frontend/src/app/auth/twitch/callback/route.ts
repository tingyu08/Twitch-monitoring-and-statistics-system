import { NextRequest, NextResponse } from "next/server";

/**
 * Twitch OAuth Callback Handler
 * 處理 Twitch 回傳的 authorization code，轉發給後端交換 Token
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const error = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");

  // 1. 處理 Twitch 回傳的錯誤 (例如：access_denied)
  if (error) {
    console.error(
      `[Auth Callback] Twitch Error: ${error} - ${errorDescription}`,
    );
    return NextResponse.redirect(new URL(`/?error=${error}`, request.url));
  }

  // 2. 如果沒有 code，視為異常請求
  if (!code) {
    console.error("[Auth Callback] No authorization code received");
    return NextResponse.redirect(new URL("/?error=no_code", request.url));
  }

  console.log("[Auth Callback] Received code, forwarding to backend...");

  try {
    const backendUrl =
      process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

    // 呼叫後端交換 Token
    const res = await fetch(`${backendUrl}/auth/twitch/callback?code=${code}`, {
      method: "GET",
      credentials: "include",
    });

    if (res.ok) {
      const data = await res.json();

      // 從後端取得 JWT Token 並設置為 Cookie
      const token = data.token;
      if (token) {
        const response = NextResponse.redirect(
          new URL("/dashboard/streamer", request.url),
        );

        // 設置 HttpOnly Cookie
        response.cookies.set("auth_token", token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          path: "/",
          maxAge: 60 * 60 * 24 * 7, // 7 天
        });

        return response;
      }

      // 如果沒有 token，仍然重導向到 dashboard
      return NextResponse.redirect(new URL("/dashboard/streamer", request.url));
    } else {
      const errorText = await res.text();
      console.error("[Auth Callback] Backend error:", res.status, errorText);
      return NextResponse.redirect(
        new URL("/?error=login_failed", request.url),
      );
    }
  } catch (err) {
    console.error("[Auth Callback] Server error:", err);
    return NextResponse.redirect(new URL("/?error=server_error", request.url));
  }
}
