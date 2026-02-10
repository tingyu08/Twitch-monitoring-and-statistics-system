import { NextRequest, NextResponse } from "next/server";

// 強制動態渲染
export const dynamic = "force-dynamic";

const BACKEND_URL =
  process.env.BACKEND_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "http://localhost:4000";

const NO_STORE_CACHE_CONTROL = "private, no-store, max-age=0";

export async function POST(request: NextRequest) {
  // 嘗試調用後端登出 API（設置 5 秒超時）
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    // 獲取 Cookie
    const authToken = request.cookies.get("auth_token")?.value;
    const refreshToken = request.cookies.get("refresh_token")?.value;

    // 構建 Cookie 字串
    const cookieParts: string[] = [];
    if (authToken) cookieParts.push(`auth_token=${authToken}`);
    if (refreshToken) cookieParts.push(`refresh_token=${refreshToken}`);
    const cookieString = cookieParts.join("; ");

    // 調用後端登出 API
    await fetch(`${BACKEND_URL}/api/auth/logout`, {
      method: "POST",
      headers: {
        Cookie: cookieString,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });
  } catch {
    // 忽略錯誤（超時或網路問題）
  } finally {
    clearTimeout(timeoutId);
  }

  // 無論後端調用成功與否，都清除前端的 Cookie
  const response = NextResponse.json(
    { message: "Logged out successfully" },
    {
      status: 200,
      headers: {
        "Cache-Control": NO_STORE_CACHE_CONTROL,
      },
    }
  );

  // 清除 auth_token（使用 "lax" 以匹配設定時的 sameSite）
  response.cookies.set("auth_token", "", {
    expires: new Date(0),
    path: "/",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
  });

  // 清除 refresh_token（使用 "lax" 以匹配設定時的 sameSite）
  response.cookies.set("refresh_token", "", {
    expires: new Date(0),
    path: "/",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
  });

  return response;
}
