// Sentry 伺服器配置（SSR 端）
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // 調整取樣率 - 生產環境建議設為 0.1 (10%)
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

  // 除錯模式
  debug: false,

  // 環境標籤
  environment: process.env.NODE_ENV,
});
