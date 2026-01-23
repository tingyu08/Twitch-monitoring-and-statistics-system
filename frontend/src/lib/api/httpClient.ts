/**
 * 統一的 HTTP 請求客戶端
 * 處理認證標頭、錯誤處理和請求日誌
 */

// 生產環境：使用相對路徑（透過 Next.js rewrite 代理到後端，避免跨域 Cookie 問題）
// 開發環境：直接連接本地後端
const API_BASE_URL =
  process.env.NODE_ENV === "production"
    ? (process.env.NEXT_PUBLIC_API_URL || "") // 生產環境預設使用相對路徑
    : (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000");

// 開發環境日誌記錄器
const apiLogger = {
  info: (...args: any[]) => {
    if (process.env.NODE_ENV === "development") {
      console.log("[API]", ...args);
    }
  },
  warn: (...args: any[]) => {
    if (process.env.NODE_ENV === "development") {
      console.warn("[API]", ...args);
    }
  },
  error: (...args: any[]) => {
    if (process.env.NODE_ENV === "development") {
      console.error("[API]", ...args);
    }
  },
};

interface RequestOptions extends RequestInit {
  timeout?: number;
  skipAuth?: boolean; // 是否跳過自動添加 Authorization 標頭
}

/**
 * 發送 API 請求
 */
export async function httpClient<T = any>(
  endpoint: string,
  options: RequestOptions = {}
): Promise<T> {
  const { timeout = 60000, skipAuth = false, ...fetchOptions } = options;

  // 確保 endpoint 以 / 開頭（如果不是完整的 URL）
  const url = endpoint.startsWith("http")
    ? endpoint
    : `${API_BASE_URL}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;

  // 設置請求標頭
  const headers = new Headers(options.headers);

  // 除非明確指定不需要 JSON content-type，否則預設添加
  if (!headers.has("Content-Type") && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  // 自動添加認證標頭
  if (!skipAuth) {
    // 主要使用 HttpOnly Cookies，所以不需要手動添加 Authorization header
    // Authorization 標頭將由瀏覽器自動處理 (cookie)
  }

  // 設置 fetch 選項
  const config: RequestInit = {
    ...fetchOptions,
    headers,
    // 預設包含憑證 (cookies)
    credentials: options.credentials || "include",
  };

  // 設置超時控制
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  config.signal = controller.signal;

  try {
    apiLogger.info(`${config.method || "GET"} ${url}`);

    const response = await fetch(url, config);
    clearTimeout(timeoutId);

    // 嘗試解析響應
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
      throw new Error("Request timed out. Server may be starting up, please try again.");
    }

    apiLogger.error("API Request Error:", error);
    throw error;
  }
}
