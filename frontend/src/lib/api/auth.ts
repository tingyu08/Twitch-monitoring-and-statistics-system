import { httpClient } from "./httpClient";

export type UserRole = "streamer" | "viewer";

export interface StreamerInfo {
  streamerId: string;
  twitchUserId: string;
  displayName: string;
  avatarUrl: string;
  channelUrl: string;
  role: UserRole;
  viewerId?: string; // 實況主現在同時也是觀眾
}

export interface ViewerInfo {
  viewerId: string;
  twitchUserId: string;
  displayName: string;
  avatarUrl: string;
  role: UserRole;
  consentedAt?: string | null;
  consentVersion?: number | null;
}

export type UserInfo = StreamerInfo | ViewerInfo;

export function isStreamer(user: UserInfo): user is StreamerInfo {
  return user.role === "streamer";
}

export function isViewer(user: UserInfo): user is ViewerInfo {
  return (
    user.role === "viewer" ||
    (user.role === "streamer" && !!(user as StreamerInfo).viewerId)
  );
}

export async function getMe(): Promise<UserInfo> {
  // 使用 httpClient 以獲得超時保護
  return httpClient<{ user: UserInfo }>("/api/auth/me").then((res) => res.user);
}

export async function logout(): Promise<{ message: string }> {
  // 直接調用後端 API，確保 Cookie 被正確發送
  const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "";

  const response = await fetch(`${API_BASE_URL}/api/auth/logout`, {
    method: "POST",
    credentials: "include", // 這會發送跨域 Cookie
    headers: {
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  return response.json();
}
