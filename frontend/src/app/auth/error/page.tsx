"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";

function AuthErrorContent() {
  const searchParams = useSearchParams();
  const reason = searchParams.get("reason") || "unknown";

  const errorMessages: Record<string, { title: string; description: string }> = {
    internal_error: {
      title: "內部錯誤",
      description: "認證過程中發生了內部錯誤，請稍後再試。",
    },
    authorization_failed: {
      title: "授權失敗",
      description: "無法完成 Twitch 授權，請確認您已允許所需的權限。",
    },
    callback_exception: {
      title: "回調處理失敗",
      description: "處理 Twitch 回調時發生錯誤，請重新登入。",
    },
    token_exchange_failed: {
      title: "Token 交換失敗",
      description: "無法取得存取權杖，請重新嘗試登入。",
    },
    unknown: {
      title: "未知錯誤",
      description: "發生了未知的認證錯誤，請重新嘗試。",
    },
  };

  const error = errorMessages[reason] || errorMessages.unknown;

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-6 px-4">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-red-600 dark:text-red-400 mb-4">{error.title}</h1>
        <p className="text-gray-700 dark:text-gray-300 mb-8 max-w-md">{error.description}</p>
        <div className="flex gap-4 justify-center">
          <Link
            href="/"
            className="px-6 py-3 rounded-lg bg-purple-600 hover:bg-purple-700 text-white transition-colors"
          >
            返回首頁
          </Link>
          <button
            onClick={() =>
              (window.location.href = `${process.env.NEXT_PUBLIC_API_URL || (process.env.NODE_ENV === "production" ? "" : "http://localhost:4000")}/auth/twitch/login`)
            }
            className="px-6 py-3 rounded-lg border border-purple-600 text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-colors"
          >
            重新登入
          </button>
        </div>
      </div>
    </main>
  );
}

export default function AuthErrorPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen flex items-center justify-center">
          <p className="text-purple-700 dark:text-purple-300">載入中...</p>
        </main>
      }
    >
      <AuthErrorContent />
    </Suspense>
  );
}
