"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useEffect, Suspense } from "react";
import { useAuthSession } from "@/features/auth/AuthContext";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:4000";

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
    // 預設以實況主流程登入；進入儀表板後可切換到觀眾並重新登入授權
    window.location.href = `${API_BASE_URL}/auth/twitch/login`;
  };

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p className="text-gray-600">載入中...</p>
      </main>
    );
  }

  if (user) {
    return null; // 正在導向
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-6 px-4">
      <h1 className="text-3xl font-bold text-center">
        Twitch 實況監控與統計平台
      </h1>
      <p className="text-gray-600 text-center max-w-lg">
        無論您是實況主或觀眾，都能透過本平台查看詳細的統計數據與互動記錄。
      </p>

      {authError && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4 max-w-md">
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

      <div className="w-full max-w-md bg-white border border-gray-200 rounded-lg p-6 shadow-sm space-y-4">
        <p className="text-sm text-gray-600 text-center">
          單一登入入口，進入儀表板後可切換「實況主 / 觀眾」頁面
        </p>
        <button
          type="button"
          onClick={handleLogin}
          className="w-full px-4 py-3 rounded bg-gradient-to-r from-purple-600 to-blue-600 text-white font-semibold shadow-md hover:shadow-lg transition"
        >
          前往登入
        </button>
      </div>
    </main>
  );
}

export default function LandingPage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen flex items-center justify-center">
        <p className="text-gray-600">載入中...</p>
      </main>
    }>
      <LandingPageContent />
    </Suspense>
  );
}
