/** @type {import('next').NextConfig} */
const nextConfig = {
  // E2E Test Configuration - rewrites to mock server on port 4001
  async rewrites() {
    const apiUrl = process.env.E2E_API_URL || 'http://localhost:4000';
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

export default nextConfig;
