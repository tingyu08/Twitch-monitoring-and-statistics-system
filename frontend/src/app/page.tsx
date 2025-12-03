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

  // 如果已登入，導向儀表板
  useEffect(() => {
    if (!loading && user) {
      router.push("/dashboard/streamer");
    }
  }, [loading, user, router]);

  const handleLogin = () => {
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
    <main className="min-h-screen flex flex-col items-center justify-center gap-4">
      <h1 className="text-3xl font-bold">
        Twitch 實況監控與統計平台（Streamer Dashboard）
      </h1>
      <p className="text-gray-600">
        使用你的 Twitch 帳號登入並綁定頻道，開始查看長期營運數據。
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

      <button
        type="button"
        onClick={handleLogin}
        className="px-4 py-2 rounded bg-purple-600 text-white hover:bg-purple-700"
      >
        {authError ? "重新嘗試登入" : "使用 Twitch 登入"}
      </button>
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


