import { NextRequest, NextResponse } from "next/server";

const NO_STORE_CACHE_CONTROL = "private, no-store, max-age=0";

export async function GET(request: NextRequest) {
  const canonicalCallbackUrl = new URL("/auth/twitch/callback", request.url);
  canonicalCallbackUrl.search = request.nextUrl.search;
  const response = NextResponse.redirect(canonicalCallbackUrl);
  response.headers.set("Cache-Control", NO_STORE_CACHE_CONTROL);
  return response;
}
