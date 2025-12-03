import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:4000";

export async function GET(request: NextRequest) {
  try {
    // 從請求中取得 Cookie
    const cookies = request.cookies.toString();
    
    // 轉發請求到後端，並帶上 Cookie
    const response = await fetch(`${BACKEND_URL}/api/auth/me`, {
      method: "GET",
      headers: {
        Cookie: cookies, // 手動轉發 Cookie
        "Content-Type": "application/json",
      },
    });

    const data = await response.json();

    // 返回後端的響應
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("[API Proxy] Error forwarding request:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

