/** @type {import('next').NextConfig} */
const nextConfig = {
  // App Router 在 Next.js 14 中已是穩定功能，不需要 experimental.appDir
  async rewrites() {
    return {
      // beforeFiles: 在檢查文件系統之前執行（用於 OAuth callback）
      beforeFiles: [
        // 代理 OAuth callback 到後端（這樣 Cookie 會設定在 localhost:3000）
        {
          source: "/auth/twitch/:path*",
          destination: "http://localhost:4000/auth/twitch/:path*",
        },
        {
          source: "/auth/viewer/login",
          destination: "http://localhost:4000/auth/viewer/login",
        },
        {
          source: "/auth/viewer/callback",
          destination: "http://localhost:4000/auth/viewer/callback",
        },
      ],
      // afterFiles:
      afterFiles: [
         // 通用 API 代理：所有未被前端 API Routes 處理的 /api/* 請求都轉發到後端
         {
            source: "/api/:path*",
            destination: "http://localhost:4000/api/:path*",
         },
      ],
      // fallback: 當沒有匹配的頁面或 API route 時
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

export default nextConfig;
