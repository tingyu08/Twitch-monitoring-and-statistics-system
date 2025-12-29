import { apiLogger } from "../logger";

const API_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "";

// 請求超時時間（毫秒）- Render 免費方案冷啟動可能需要 30 秒以上
const REQUEST_TIMEOUT_MS = 15000;

/**
 * 通用 HTTP 客戶端
 * 自動處理 Content-Type 和 Credentials (Cookies)
 * 包含超時機制避免請求無限等待
 */
export async function httpClient<T = any>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const path = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  const url = `${API_URL}${path}`;

  // 創建 AbortController 實現超時
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
    apiLogger.warn(`Request to ${url} timed out after ${REQUEST_TIMEOUT_MS}ms`);
  }, REQUEST_TIMEOUT_MS);

  const config: RequestInit = {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
    // 【關鍵設定】告訴瀏覽器將該網域的 Cookies (包含 httpOnly) 自動附帶在請求中
    credentials: "include",
    signal: controller.signal,
  };

  try {
    const response = await fetch(url, config);
    clearTimeout(timeoutId);

    // 嘗試解析回應內容
    let data;
    const contentType = response.headers.get("content-type");
    if (contentType && contentType.includes("application/json")) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    if (!response.ok) {
      // 處理 401 未授權錯誤
      if (response.status === 401) {
        apiLogger.warn("Unauthorized access request to:", url);
      }

      const errorMessage =
        typeof data === "object" && data.message
          ? data.message
          : `Request failed with status ${response.status}`;

      throw new Error(errorMessage);
    }

    return data as T;
  } catch (error) {
    clearTimeout(timeoutId);

    // 處理超時錯誤
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(
        "Request timed out. Server may be starting up, please try again."
      );
    }

    apiLogger.error("API Request Error:", error);
    throw error;
  }
}
