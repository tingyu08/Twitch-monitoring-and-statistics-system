import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

const OAUTH_SCOPES = [
  "user:read:email",
  "channel:read:subscriptions",
  "analytics:read:games",
  "analytics:read:extensions",
  "channel:manage:broadcast",
  "bits:read",
  "chat:read",
  "chat:edit",
  "user:read:follows",
  "user:read:subscriptions",
  "user:read:blocked_users",
  "user:manage:blocked_users",
  "whispers:read",
];

const NO_STORE_CACHE_CONTROL = "private, no-store, max-age=0";

function getCookieOptions() {
  const isProd = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: isProd,
    // OAuth callback 是 top-level navigation，使用 "lax" 即可
    // "none" 會被某些瀏覽器的 third-party cookie 阻擋政策影響
    sameSite: "lax" as const,
    path: "/",
    maxAge: 5 * 60,
  };
}

export async function GET(request: NextRequest) {
  const clientId = process.env.TWITCH_CLIENT_ID || process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID;

  if (!clientId) {
    const missingClientIdResponse = NextResponse.redirect(
      new URL("/?error=missing_client_id", request.url)
    );
    missingClientIdResponse.headers.set("Cache-Control", NO_STORE_CACHE_CONTROL);
    return missingClientIdResponse;
  }

  const state = crypto.randomBytes(16).toString("hex");
  const origin = request.nextUrl.origin;
  const redirectUri = `${origin}/auth/twitch/callback`;

  const authUrl = new URL("https://id.twitch.tv/oauth2/authorize");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", OAUTH_SCOPES.join(" "));
  authUrl.searchParams.set("state", state);

  const response = NextResponse.redirect(authUrl.toString());
  response.cookies.set("twitch_auth_state", state, getCookieOptions());
  response.headers.set("Cache-Control", NO_STORE_CACHE_CONTROL);
  return response;
}
