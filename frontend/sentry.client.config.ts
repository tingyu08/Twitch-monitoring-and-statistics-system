// Sentry 客戶端配置（瀏覽器端）
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // 調整取樣率 - 生產環境建議設為 0.1 (10%)
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

  // 除錯模式（開發時開啟）
  debug: false,

  // Replay 取樣率（捕捉錯誤時的 Session Replay）
  replaysOnErrorSampleRate: 1.0,
  replaysSessionSampleRate: 0.1,

  // 整合設定
  integrations: [
    Sentry.replayIntegration({
      // 隱藏敏感資料
      maskAllText: false,
      blockAllMedia: false,
    }),
  ],

  // 過濾不需要追蹤的錯誤
  ignoreErrors: [
    // 忽略取消請求的錯誤
    "AbortError",
    "The operation was aborted",
    // 忽略網路錯誤（用戶網路問題）
    "Failed to fetch",
    "NetworkError",
    // 忽略 ResizeObserver 錯誤（瀏覽器相容性問題）
    "ResizeObserver loop",
  ],

  // 環境標籤
  environment: process.env.NODE_ENV,
});
