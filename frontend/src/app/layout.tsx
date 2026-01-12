import type { ReactNode } from "react";
import { Suspense } from "react";
import { AuthProvider } from "@/features/auth/AuthContext";
import { ThemeProvider } from "@/features/theme";
import "./globals.css";

// Google Analytics
import { GoogleAnalytics } from "@next/third-parties/google";

// 動態導入 ConsentBanner 以避免 SSR 問題
import dynamic from "next/dynamic";
const ConsentBannerWrapper = dynamic(
  () =>
    import("@/features/privacy/components/ConsentBanner").then(
      (mod) => mod.ConsentBannerWrapper
    ),
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
    <html lang="zh-Hant" suppressHydrationWarning>
      <head>
        {/* 防止 FOUC (Flash of Unstyled Content) */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var theme = localStorage.getItem('twitch-analytics-theme');
                  if (theme === 'dark' || (!theme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
                    document.documentElement.classList.add('dark');
                  } else {
                    document.documentElement.classList.remove('dark');
                  }
                } catch (e) {}
              })();
            `,
          }}
        />
        <meta name="theme-color" content="#0e0e10" />
      </head>
      <body className="theme-transition">
        <ThemeProvider>
          <AuthProvider>
            {children}
            <Toaster />
            <Suspense fallback={null}>
              <ConsentBannerWrapper />
            </Suspense>
          </AuthProvider>
        </ThemeProvider>
        {process.env.NEXT_PUBLIC_GA_ID && (
          <GoogleAnalytics gaId={process.env.NEXT_PUBLIC_GA_ID} />
        )}
      </body>
    </html>
  );
}
