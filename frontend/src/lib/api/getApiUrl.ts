/**
 * 取得 API 完整 URL
 *
 * 在開發環境中，直接連接後端以避免 Next.js rewrites 的效能問題
 * 在生產環境中，使用相對路徑讓 Next.js rewrites 處理 CORS
 */
export function getApiUrl(endpoint: string): string {
  // 確保 endpoint 以 / 開頭
  const path = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;

  // 移除 rewrites 後，必須使用完整 URL
  // P1 Fix: 優先支援 Vercel 設定的 NEXT_PUBLIC_BACKEND_URL，並使用 127.0.0.1 避免 IPv6 解析延遲
  const backendUrl =
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    "http://127.0.0.1:4000";

  return `${backendUrl}${path}`;
}
