/**
 * 取得 API 完整 URL
 *
 * 在開發環境中，直接連接後端以避免 Next.js rewrites 的效能問題
 * 在生產環境中，使用相對路徑讓 Next.js rewrites 處理 CORS
 */
export function getApiUrl(endpoint: string): string {
  // 確保 endpoint 以 / 開頭
  const path = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;

  // P1 Fix: 開發環境直連後端（避免 rewrites 延遲），生產環境瀏覽器走相對路徑以保留同源 cookie
  const backendUrl =
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    (process.env.NODE_ENV === "production" ? "" : "http://127.0.0.1:4000");

  if (typeof window !== "undefined") {
    if (process.env.NODE_ENV === "production") {
      return path;
    }
    return backendUrl ? `${backendUrl}${path}` : path;
  }

  return backendUrl ? `${backendUrl}${path}` : path;
}
