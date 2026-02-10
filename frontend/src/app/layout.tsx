import type { ReactNode } from "react";
import { Suspense } from "react";
import { Providers } from "@/components/Providers";
import "./globals.css";

// Google Analytics
import { GoogleAnalytics } from "@next/third-parties/google";

// Font Optimization with next/font
import { Inter, Noto_Sans_TC } from "next/font/google";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const notoSansTC = Noto_Sans_TC({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-noto-sans-tc",
  display: "swap",
  preload: false,
});

// 動態導入 ConsentBanner 以避免 SSR 問題
import dynamic from "next/dynamic";
const ConsentBannerWrapper = dynamic(
  () =>
    import("@/features/privacy/components/ConsentBanner").then((mod) => mod.ConsentBannerWrapper),
  { ssr: false }
);

export const metadata = {
  title: "Twitch 實況監控與統計平台",
  description: "Streamer Analytics Dashboard",
  manifest: "/manifest.json",
};

import { Toaster } from "@/components/ui/sonner";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="zh-Hant"
      suppressHydrationWarning
      className={`${inter.variable} ${notoSansTC.variable}`}
    >
      <head>
        {/* 防止 FOUC (Flash of Unstyled Content) */}

        <meta name="theme-color" content="#0e0e10" />
      </head>
      <body className={`theme-transition font-sans`}>
        <Providers>
          {children}
          <Toaster />
          <Suspense fallback={null}>
            <ConsentBannerWrapper />
          </Suspense>
        </Providers>
        {process.env.NEXT_PUBLIC_GA_ID && <GoogleAnalytics gaId={process.env.NEXT_PUBLIC_GA_ID} />}
      </body>
    </html>
  );
}
