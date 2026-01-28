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
  const backendUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:4000";

  return `${backendUrl}${path}`;
}
