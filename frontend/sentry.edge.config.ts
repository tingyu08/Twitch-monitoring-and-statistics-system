// Sentry Edge 配置（Edge Runtime）
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // 調整取樣率
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

  // 除錯模式
  debug: false,

  // 環境標籤
  environment: process.env.NODE_ENV,
});
