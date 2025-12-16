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
  // 使用 Next.js API route 作為代理，避免跨域 Cookie 問題
  // 這樣前端和後端就在同一個域名下，Cookie 會自動傳遞
  return httpClient<UserInfo>("/api/auth/me");
}

export async function logout(): Promise<{ message: string }> {
  return httpClient<{ message: string }>("/api/auth/logout", {
    method: "POST",
  });
}
