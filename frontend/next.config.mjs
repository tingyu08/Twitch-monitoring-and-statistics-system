import { withSentryConfig } from "@sentry/nextjs";
import createNextIntlPlugin from "next-intl/plugin";

import withPWAInit from "@ducanh2912/next-pwa";

const withPWA = withPWAInit({
  dest: "public",
  cacheOnFrontEndNav: true,
  aggressiveFrontEndNavCaching: true,
  reloadOnOnline: true,
  swcMinify: true,
  disable: process.env.NODE_ENV === "development",
  workboxOptions: {
    disableDevLogs: true,
  },
});

const withNextIntl = createNextIntlPlugin("./src/i18n.ts");

/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    serverActions: {
      allowedOrigins: ["localhost:3000", "app.localhost:3000"],
    },
  },
  // E2E Test Configuration - rewrites to mock server on port 4001
  async rewrites() {
    const apiUrl = process.env.E2E_API_URL || "http://localhost:4000";
    return {
      beforeFiles: [
        {
          source: "/auth/twitch/:path*",
          destination: `${apiUrl}/auth/twitch/:path*`,
        },
        {
          source: "/auth/viewer/login",
          destination: `${apiUrl}/auth/viewer/login`,
        },
        {
          source: "/auth/viewer/callback",
          destination: `${apiUrl}/auth/viewer/callback`,
        },
      ],
      afterFiles: [
        {
          source: "/api/:path*",
          destination: `${apiUrl}/api/:path*`,
        },
      ],
      fallback: [],
    };
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "static-cdn.jtvnw.net",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "ui-avatars.com",
        pathname: "/**",
      },
    ],
  },
};

// Sentry 配置選項
const sentryWebpackPluginOptions = {
  // 靜默模式（不顯示詳細日誌）
  silent: true,

  // 組織和專案名稱（從環境變數讀取）
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,

  // 自動上傳 Source Maps
  widenClientFileUpload: true,

  // 隱藏 Source Maps（不公開給用戶）
  hideSourceMaps: true,

  // 禁用遙測
  disableLogger: true,

  // 自動檢測和追蹤
  automaticVercelMonitors: true,
};

// 只有在配置了 Sentry DSN 時才啟用
const configWithSentry = process.env.NEXT_PUBLIC_SENTRY_DSN
  ? withSentryConfig(nextConfig, sentryWebpackPluginOptions)
  : nextConfig;

// 應用 next-intl 插件
export default withPWA(withNextIntl(configWithSentry));
