/**
 * Avatar Proxy Utility
 * 處理 Twitch CDN 頭像 URL，通過後端代理避免 CORB 問題
 */

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

/**
 * 將 Twitch CDN 頭像 URL 轉換為代理 URL
 *
 * @param originalUrl 原始頭像 URL
 * @returns 代理後的 URL 或原始 URL (如果是 ui-avatars)
 */
export function getProxiedAvatarUrl(originalUrl: string): string {
  if (!originalUrl) {
    return getFallbackAvatar("User");
  }

  // 如果已經是 ui-avatars，直接返回
  if (originalUrl.includes("ui-avatars.com")) {
    return originalUrl;
  }

  // 如果是 Twitch CDN，使用代理
  if (
    originalUrl.includes("static-cdn.jtvnw.net") ||
    originalUrl.includes("assets.twitch.tv")
  ) {
    const encodedUrl = encodeURIComponent(originalUrl);
    return `${API_BASE_URL}/api/proxy/avatar?url=${encodedUrl}`;
  }

  // 其他 URL 直接返回
  return originalUrl;
}

/**
 * 生成 fallback 頭像 URL (使用 ui-avatars.com)
 *
 * @param name 用戶名稱
 * @param size 圖片大小 (預設 128)
 * @returns ui-avatars.com URL
 */
export function getFallbackAvatar(name: string, size = 128): string {
  const encodedName = encodeURIComponent(name);
  return `https://ui-avatars.com/api/?name=${encodedName}&background=random&size=${size}`;
}

/**
 * 處理頭像載入錯誤時的 fallback
 *
 * @param event 錯誤事件
 * @param fallbackName 用戶名稱 (用於生成 fallback 頭像)
 */
export function handleAvatarError(
  event: React.SyntheticEvent<HTMLImageElement, Event>,
  fallbackName: string
): void {
  const target = event.currentTarget;
  target.src = getFallbackAvatar(fallbackName);
  target.onerror = null; // 防止無限循環
}
