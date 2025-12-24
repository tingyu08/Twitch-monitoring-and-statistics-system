import { NextRequest, NextResponse } from "next/server";
import { apiLogger } from "@/lib/logger";

// 強制動態渲染（因為使用 request.headers）
export const dynamic = "force-dynamic";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:4000";

export async function GET(request: NextRequest) {
  try {
    // 從請求 header 中取得 Cookie（正確的方式）
    const cookieHeader = request.headers.get("cookie") || "";

    apiLogger.debug("Forwarding /auth/me request");
    apiLogger.debug(`Cookie header: ${cookieHeader ? "present" : "missing"}`);

    // 轉發請求到後端，並帶上 Cookie
    const response = await fetch(`${BACKEND_URL}/api/auth/me`, {
      method: "GET",
      headers: {
        Cookie: cookieHeader,
        "Content-Type": "application/json",
      },
    });

    const data = await response.json();

    // 返回後端的響應
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    apiLogger.error("Error forwarding /auth/me request:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
