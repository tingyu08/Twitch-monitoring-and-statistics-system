import type { ReactNode } from "react";
import { Suspense } from "react";
import { AuthProvider } from "@/features/auth/AuthContext";
import "./globals.css";

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
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body>
        <AuthProvider>
          {children}
          <Suspense fallback={null}>
            <ConsentBannerWrapper />
          </Suspense>
        </AuthProvider>
      </body>
    </html>
  );
}
