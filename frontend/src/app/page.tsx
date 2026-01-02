"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useEffect, Suspense } from "react";
import { useAuthSession } from "@/features/auth/AuthContext";
import { ThemeToggle } from "@/features/theme";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:4000";

function LandingPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user, loading } = useAuthSession();
  const authError = searchParams.get("authError");

  // 如果已登入，導向儀表板切換頁
  useEffect(() => {
    if (!loading && user) {
      router.push("/dashboard/viewer");
    }
  }, [loading, user, router]);

  const handleLogin = () => {
    // 清除登出標誌，允許重新登入
    if (typeof window !== "undefined") {
      localStorage.removeItem("logout_pending");
    }
    // 統一登入：一次授權即可同時存取實況主與觀眾功能
    window.location.href = `${API_BASE_URL}/auth/twitch/login`;
  };

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p className="text-purple-700 dark:text-purple-300">載入中...</p>
      </main>
    );
  }

  if (user) {
    return null; // 正在導向
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-6 px-4">
      {/* 主題切換按鈕 - 右上角 */}
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>

      <h1 className="text-3xl font-bold text-center text-purple-900 dark:text-white drop-shadow-sm">
        Twitch 實況監控與統計平台
      </h1>
      <p className="text-purple-700 dark:text-purple-300 text-center max-w-lg">
        無論您是實況主或觀眾，都能透過本平台查看詳細的統計數據與互動記錄。
      </p>

      {authError && (
        <div className="bg-red-100 dark:bg-red-900/30 border border-red-400 dark:border-red-700 text-red-700 dark:text-red-300 px-4 py-3 rounded mb-4 max-w-md">
          <p className="font-bold mb-2">登入失敗</p>
          <p className="text-sm">
            {authError === "authorization_failed"
              ? "您取消了 Twitch 授權，或授權過程中發生錯誤。"
              : authError === "callback_exception"
              ? "處理登入時發生錯誤，請稍後再試。"
              : "登入過程中發生未知錯誤。"}
          </p>
        </div>
      )}

      <div className="w-full max-w-md theme-card p-6 shadow-sm space-y-4">
        <p className="text-sm text-gray-600 dark:text-gray-400 text-center">
          單一登入入口，進入儀表板後可切換「實況主 / 觀眾」頁面
        </p>
        <button
          type="button"
          onClick={handleLogin}
          className="w-full px-4 py-3 rounded theme-btn-primary"
        >
          前往登入
        </button>
      </div>
    </main>
  );
}

export default function LandingPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen flex items-center justify-center">
          <p className="text-purple-700 dark:text-purple-300">載入中...</p>
        </main>
      }
    >
      <LandingPageContent />
    </Suspense>
  );
}
