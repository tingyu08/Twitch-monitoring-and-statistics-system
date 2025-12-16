import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const cookieHeader = request.headers.get("cookie") || "";
  const authToken = request.cookies.get("auth_token")?.value || "not found";
  
  return NextResponse.json({
    message: "Debug endpoint",
    hasCookieHeader: !!cookieHeader,
    cookieHeaderLength: cookieHeader.length,
    authTokenPresent: authToken !== "not found",
    authTokenPreview: authToken.substring(0, 20) + "...",
  });
}
