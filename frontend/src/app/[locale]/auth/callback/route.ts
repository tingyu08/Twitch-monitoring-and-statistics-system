import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const canonicalCallbackUrl = new URL("/auth/twitch/callback", request.url);
  canonicalCallbackUrl.search = request.nextUrl.search;
  return NextResponse.redirect(canonicalCallbackUrl);
}
