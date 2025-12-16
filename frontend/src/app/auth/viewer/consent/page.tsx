"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthSession } from "@/features/auth/AuthContext";
import { viewerApi } from "@/lib/api/viewer";

export default function ViewerConsentPage() {
  const router = useRouter();
  const { user, loading, logout, isViewer } = useAuthSession();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConsent = async () => {
    try {
      setSubmitting(true);
      setError(null);
      await viewerApi.submitConsent(true);
      router.push("/dashboard/viewer");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "提交同意時發生錯誤，請稍後再試"
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleDecline = async () => {
    await logout();
  };

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p className="text-gray-600">載入中...</p>
      </main>
    );
  }

  if (!user || !isViewer) {
    router.push("/");
    return null;
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-4 bg-gray-50">
      <div className="max-w-2xl w-full bg-white rounded-lg shadow-lg p-8">
        <h1 className="text-2xl font-bold text-center mb-6 text-blue-700">
          資料使用說明與隱私同意
        </h1>

        <div className="mb-6 text-gray-700 space-y-4">
          <p>
            歡迎使用 Twitch 觀眾統計平台！在您開始使用之前，請詳閱以下資料使用說明：
          </p>

          <div className="bg-blue-50 border-l-4 border-blue-500 p-4">
            <h2 className="font-semibold mb-2">我們會收集的資料：</h2>
            <ul className="list-disc list-inside space-y-1 text-sm">
              <li>您的 Twitch 帳號基本資訊（顯示名稱、頭像）</li>
              <li>您在各頻道的觀看時數統計</li>
              <li>您的聊天室互動記錄（留言數、表情符號使用）</li>
              <li>您追蹤的實況主資訊</li>
            </ul>
          </div>

          <div className="bg-green-50 border-l-4 border-green-500 p-4">
            <h2 className="font-semibold mb-2">資料使用目的：</h2>
            <ul className="list-disc list-inside space-y-1 text-sm">
              <li>提供個人化的觀看統計與互動分析</li>
              <li>生成您的觀眾足跡與支持歷程報告</li>
              <li>改善平台功能與使用體驗</li>
            </ul>
          </div>

          <div className="bg-yellow-50 border-l-4 border-yellow-500 p-4">
            <h2 className="font-semibold mb-2">您的權利：</h2>
            <ul className="list-disc list-inside space-y-1 text-sm">
              <li>隨時可以在設定中撤銷授權並刪除資料</li>
              <li>可以匯出您的所有個人資料</li>
              <li>可以控制哪些統計資料要顯示或隱藏</li>
            </ul>
          </div>

          <p className="text-sm text-gray-500">
            點擊「同意並繼續」表示您已閱讀並同意我們的資料使用政策。
            如果您不同意，將會登出並返回首頁。
          </p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
            {error}
          </div>
        )}

        <div className="flex gap-4">
          <button
            type="button"
            onClick={handleDecline}
            disabled={submitting}
            className="flex-1 px-4 py-3 rounded border border-gray-300 text-gray-700 hover:bg-gray-100 transition-colors disabled:opacity-50"
          >
            不同意，登出
          </button>
          <button
            type="button"
            onClick={handleConsent}
            disabled={submitting}
            className="flex-1 px-4 py-3 rounded bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            {submitting ? "處理中..." : "同意並繼續"}
          </button>
        </div>
      </div>
    </main>
  );
}
