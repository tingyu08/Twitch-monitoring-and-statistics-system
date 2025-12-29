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
  const response = await httpClient<UserInfo | { user: UserInfo }>(
    "/api/auth/me"
  );

  // 支援兩種格式：{ user: UserInfo } 或直接 UserInfo
  if (response && "user" in response && response.user) {
    return response.user;
  }

  // 直接返回的 UserInfo 格式
  if (response && "role" in response) {
    return response as UserInfo;
  }

  throw new Error("Invalid response from server");
}

export async function logout(): Promise<{ message: string }> {
  // 調用 Next.js 代理路由，確保 Cookie 被正確清除
  // 不再直接調用後端，因為跨域 Cookie 清除在某些瀏覽器環境下不穩定
  const response = await fetch("/api/auth/logout", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  return response.json();
}
