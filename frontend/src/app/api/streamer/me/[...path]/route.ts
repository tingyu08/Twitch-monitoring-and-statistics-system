import { NextRequest, NextResponse } from "next/server";
import { apiLogger } from "@/lib/logger";

const BACKEND_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:4000";

/**
 * Helper to get cookies as a proper header string
 */
function getCookieHeader(request: NextRequest): string {
  const cookieHeader = request.headers.get("cookie");
  return cookieHeader || "";
}

/**
 * Proxy handler for /api/streamer/me/* routes
 * Forwards requests to backend with cookies
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path } = await params;
    const pathString = path.join("/");
    const searchParams = request.nextUrl.searchParams.toString();
    const queryString = searchParams ? `?${searchParams}` : "";
    
    const backendUrl = `${BACKEND_URL}/api/streamer/me/${pathString}${queryString}`;
    
    // 從請求 header 中取得 Cookie（這是正確的方式）
    const cookieHeader = getCookieHeader(request);
    
    apiLogger.debug(`Proxying request to: ${backendUrl}`);
    apiLogger.debug(`Cookie header: ${cookieHeader ? 'present' : 'missing'}`);
    
    // 轉發請求到後端，並帶上 Cookie
    const response = await fetch(backendUrl, {
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
    apiLogger.error("Error proxying streamer request:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path } = await params;
    const pathString = path.join("/");
    const backendUrl = `${BACKEND_URL}/api/streamer/me/${pathString}`;
    
    const cookieHeader = getCookieHeader(request);
    const body = await request.json().catch(() => null);
    
    apiLogger.debug(`Proxying POST request to: ${backendUrl}`);
    
    const response = await fetch(backendUrl, {
      method: "POST",
      headers: {
        Cookie: cookieHeader,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    apiLogger.error("Error proxying streamer POST request:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
