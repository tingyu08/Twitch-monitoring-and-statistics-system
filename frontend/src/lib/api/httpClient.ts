const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

/**
 * 通用 HTTP 客戶端
 * 自動處理 Content-Type 和 Credentials (Cookies)
 */
export async function httpClient<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const url = `${API_URL}${path}`;

  const config: RequestInit = {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    // 【關鍵設定】告訴瀏覽器將該網域的 Cookies (包含 httpOnly) 自動附帶在請求中
    credentials: 'include', 
  };

  try {
    const response = await fetch(url, config);

    // 嘗試解析回應內容
    let data;
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    if (!response.ok) {
      // 處理 401 未授權錯誤
      if (response.status === 401) {
        console.warn('Unauthorized access request to:', url);
      }
      
      const errorMessage = (typeof data === 'object' && data.message) 
        ? data.message 
        : `Request failed with status ${response.status}`;
        
      throw new Error(errorMessage);
    }

    return data as T;
  } catch (error) {
    console.error('API Request Error:', error);
    throw error;
  }
}
