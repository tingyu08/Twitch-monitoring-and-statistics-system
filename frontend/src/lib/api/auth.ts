import { httpClient } from "./httpClient";

export interface StreamerInfo {
  streamerId: string;
  twitchUserId: string;
  displayName: string;
  avatarUrl: string;
  channelUrl: string;
}

export async function getMe(): Promise<StreamerInfo> {
  // 使用 Next.js API route 作為代理，避免跨域 Cookie 問題
  // 這樣前端和後端就在同一個域名下，Cookie 會自動傳遞
  return httpClient<StreamerInfo>("/api/auth/me");
}

export async function logout(): Promise<{ message: string }> {
  return httpClient<{ message: string }>("/api/auth/logout", {
    method: "POST",
  });
}

