import { NextRequest, NextResponse } from "next/server";
import { authLogger } from "@/lib/logger";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const error = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");

  // 1. 處理 Twitch 回傳的錯誤 (例如：access_denied)
  if (error) {
    authLogger.error(`Auth Error: ${error} - ${errorDescription}`);
    // 導向到登入頁面並顯示錯誤訊息
    return NextResponse.redirect(new URL(`/?error=${error}`, request.url));
  }

  // 2. 如果沒有 code，視為異常請求
  if (!code) {
    return NextResponse.redirect(new URL("/?error=no_code", request.url));
  }

  try {
    const backendUrl =
      process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

    // 呼叫後端交換 Token (這裡示範轉發，具體視您後端路由設計而定)
    // 但根據上面的 Controller 代碼，後端其實已經接管了 Callback。
    // 如果 Callback URL 設定的是指向後端，則這個前端檔案可能不會被執行到。

    // 如果 Callback URL 指向的是這裡 (前端)，我們需要將 code 傳給後端：
    const res = await fetch(
      `${backendUrl}/api/auth/twitch/callback?code=${code}`,
      {
        method: "GET", // 或 POST
      }
    );

    if (res.ok) {
      return NextResponse.redirect(new URL("/dashboard/streamer", request.url));
    } else {
      return NextResponse.redirect(
        new URL("/?error=login_failed", request.url)
      );
    }
  } catch (err) {
    return NextResponse.redirect(new URL("/?error=server_error", request.url));
  }
}
