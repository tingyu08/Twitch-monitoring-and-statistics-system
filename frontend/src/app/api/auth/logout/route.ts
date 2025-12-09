import { NextRequest, NextResponse } from "next/server";
import { apiLogger } from "@/lib/logger";

const BACKEND_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:4000";

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

    const data = await response.json();

    // 建立響應並清除 Cookie（如果後端要求）
    const nextResponse = NextResponse.json(data, { status: response.status });
    
    // 清除前端的 auth_token Cookie
    nextResponse.cookies.delete("auth_token");

    return nextResponse;
  } catch (error) {
    apiLogger.error("Error forwarding /auth/logout request:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

