/**
 * API Client 模組入口
 * 提供對所有 API 的統一訪問接口
 */
import { httpClient } from "./httpClient";

// 封裝為命名空間風格的 API client
export const api = {
  get: async <T = any>(endpoint: string): Promise<{ data: T }> => {
    const data = await httpClient<T>(endpoint);
    return { data };
  },

  post: async <T = any>(endpoint: string, body?: any): Promise<{ data: T }> => {
    const data = await httpClient<T>(endpoint, {
      method: "POST",
      body: body ? JSON.stringify(body) : undefined,
    });
    return { data };
  },

  put: async <T = any>(endpoint: string, body?: any): Promise<{ data: T }> => {
    const data = await httpClient<T>(endpoint, {
      method: "PUT",
      body: body ? JSON.stringify(body) : undefined,
    });
    return { data };
  },

  delete: async <T = any>(endpoint: string): Promise<{ data: T }> => {
    const data = await httpClient<T>(endpoint, {
      method: "DELETE",
    });
    return { data };
  },
};

// 重新導出 httpClient
export { httpClient } from "./httpClient";
