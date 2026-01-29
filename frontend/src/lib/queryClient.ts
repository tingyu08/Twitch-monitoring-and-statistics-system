/**
 * React Query Client 配置
 * P1 優化：統一管理 API 請求快取和狀態
 */

import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 資料保持新鮮的時間（30 秒內不重新請求）
      staleTime: 30 * 1000,

      // 快取資料保留時間（5 分鐘）
      gcTime: 5 * 60 * 1000,

      // 重試配置
      retry: 1,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),

      // 重新聚焦時不自動重新請求（避免頻繁切換分頁時的重複請求）
      refetchOnWindowFocus: false,

      // 重新連線時重新請求
      refetchOnReconnect: true,

      // 掛載時不自動重新請求（已有快取時）
      refetchOnMount: false,
    },
    mutations: {
      retry: 1,
    },
  },
});
