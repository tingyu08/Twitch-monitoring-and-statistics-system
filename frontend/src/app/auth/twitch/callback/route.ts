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

  try {
    // 建構後端 Callback URL
    // P1 Fix: 確保使用正確的環境變數，與 getApiUrl 邏輯一致，避免 origin 不匹配
    const backendDataUrl =
      process.env.NEXT_PUBLIC_BACKEND_URL ||
      process.env.BACKEND_URL ||
      process.env.NEXT_PUBLIC_API_BASE_URL ||
      "http://127.0.0.1:4000";

    const backendCallbackUrl = new URL(`${backendDataUrl}/auth/twitch/callback`);
    backendCallbackUrl.searchParams.set("code", code);
    if (state) {
      backendCallbackUrl.searchParams.set("state", state);
    }
    // 轉發所有可能的錯誤參數
    if (error) backendCallbackUrl.searchParams.set("error", error);
    if (errorDescription)
      backendCallbackUrl.searchParams.set("error_description", errorDescription);

    // 3. 直接重導向到後端，讓瀏覽器帶著 Cookies (State) 訪問後端
    // 後端驗證成功後會寫入 Auth Cookies 並重導回前端 Dashboard
    return NextResponse.redirect(backendCallbackUrl.toString());
  } catch (err) {
    console.error("[Auth Callback] Error building redirect URL:", err);
    return NextResponse.redirect(new URL("/?error=server_error", request.url));
  }
}
