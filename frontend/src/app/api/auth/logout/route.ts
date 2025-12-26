import { NextRequest, NextResponse } from "next/server";
import { apiLogger } from "@/lib/logger";

// 強制動態渲染（因為使用 request.cookies）
export const dynamic = "force-dynamic";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:4000";

export async function POST(request: NextRequest) {
  try {
    // 從請求中取得 Cookie
    const cookies = request.cookies.toString();

    // 轉發請求到後端，並帶上 Cookie
    const response = await fetch(`${BACKEND_URL}/api/auth/logout`, {
      method: "POST",
      headers: {
        Cookie: cookies, // 手動轉發 Cookie
        "Content-Type": "application/json",
      },
    });

    let data = { message: "Logged out successfully" };
    try {
      data = await response.json();
    } catch {
      // 如果無法解析 JSON，使用預設訊息
    }

    // 建立響應並清除所有認證 Cookie
    const nextResponse = NextResponse.json(data, { status: 200 });

    // 清除前端的 auth_token 和 refresh_token Cookie
    // 使用正確的選項確保 Cookie 被刪除
    nextResponse.cookies.set("auth_token", "", {
      expires: new Date(0),
      path: "/",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    });
    nextResponse.cookies.set("refresh_token", "", {
      expires: new Date(0),
      path: "/",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    });

    return nextResponse;
  } catch (error) {
    apiLogger.error("Error forwarding /auth/logout request:", error);

    // 即使出錯，也嘗試清除 Cookie
    const errorResponse = NextResponse.json(
      { message: "Logged out (with error)" },
      { status: 200 }
    );
    errorResponse.cookies.set("auth_token", "", {
      expires: new Date(0),
      path: "/",
    });
    errorResponse.cookies.set("refresh_token", "", {
      expires: new Date(0),
      path: "/",
    });
    return errorResponse;
  }
}
