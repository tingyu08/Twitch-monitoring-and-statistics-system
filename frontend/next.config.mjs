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
  // Production: Remove console.log but keep console.error and console.warn for monitoring
  compiler: {
    removeConsole:
      process.env.NODE_ENV === "production"
        ? { exclude: ["error", "warn"] }
        : false,
  },
  experimental: {
    serverActions: {
      allowedOrigins: ["localhost:3000", "app.localhost:3000"],
    },
  },
  // E2E Test Configuration - rewrites to mock server on port 4001
  // rewrites removed to force direct backend connection
  // async rewrites() { ... }
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
      {
        protocol: "https",
        hostname: "vod-secure.twitch.tv",
        pathname: "/**",
      },
    ],
  },
  webpack: (config) => {
    config.infrastructureLogging = {
      level: "error",
    };
    return config;
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

  // 禁用遙測 (deprecated options removed/updated)
  // disableLogger: true, -> not directly mappable easily here, removed to silence warning
  // automaticVercelMonitors: true, -> deprecated, removing
};

// 只有在配置了 Sentry DSN 時才啟用
const configWithSentry = process.env.NEXT_PUBLIC_SENTRY_DSN
  ? withSentryConfig(nextConfig, sentryWebpackPluginOptions)
  : nextConfig;

// 應用 next-intl 插件
export default withPWA(withNextIntl(configWithSentry));
