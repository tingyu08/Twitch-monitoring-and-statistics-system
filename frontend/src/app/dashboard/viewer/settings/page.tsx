"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useAuthSession } from "@/features/auth/AuthContext";
import { isViewer } from "@/lib/api/auth";
import { viewerApi } from "@/lib/api/viewer";

interface DataSummary {
  totalMessages: number;
  totalAggregations: number;
  channelCount: number;
  dateRange: {
    oldest: string | null;
    newest: string | null;
  };
}

export default function ViewerSettingsPage() {
  const router = useRouter();
  const { user, loading, logout } = useAuthSession();
  const [revoking, setRevoking] = useState(false);
  const [showRevokeConfirm, setShowRevokeConfirm] = useState(false);

  // 隱私控制狀態
  const [pauseCollection, setPauseCollection] = useState(false);
  const [dataSummary, setDataSummary] = useState<DataSummary | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [privacyLoading, setPrivacyLoading] = useState(true);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/");
    }
  }, [loading, user, router]);

  // 載入隱私設定
  useEffect(() => {
    if (user && !loading) {
      loadPrivacyData();
    }
  }, [user, loading]);

  const loadPrivacyData = async () => {
    setPrivacyLoading(true);
    try {
      const [settings, summary] = await Promise.all([
        viewerApi.getPrivacySettings(),
        viewerApi.getDataSummary(),
      ]);

      if (settings) {
        setPauseCollection(settings.pauseCollection);
      }
      if (summary) {
        setDataSummary(summary);
      }
    } catch (error) {
      console.error("Failed to load privacy data:", error);
    } finally {
      setPrivacyLoading(false);
    }
  };

  const handleToggleCollection = async () => {
    setIsUpdating(true);
    setMessage(null);
    try {
      const result = await viewerApi.updatePrivacySettings(!pauseCollection);
      if (result?.success) {
        setPauseCollection(!pauseCollection);
        setMessage({ type: "success", text: result.message });
      } else {
        setMessage({ type: "error", text: "更新失敗，請稍後再試" });
      }
    } catch (error) {
      setMessage({ type: "error", text: "更新失敗，請稍後再試" });
    } finally {
      setIsUpdating(false);
    }
  };

  const handleClearAllData = async () => {
    setIsDeleting(true);
    setMessage(null);
    try {
      const result = await viewerApi.clearAllMessages();
      if (result?.success) {
        setMessage({
          type: "success",
          text: `已刪除 ${result.deletedCount.messages} 則訊息和 ${result.deletedCount.aggregations} 筆統計記錄`,
        });
        setShowDeleteConfirm(false);
        await loadPrivacyData();
      } else {
        setMessage({ type: "error", text: "刪除失敗，請稍後再試" });
      }
    } catch (error) {
      setMessage({ type: "error", text: "刪除失敗，請稍後再試" });
    } finally {
      setIsDeleting(false);
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
        <div className="animate-pulse text-purple-300">載入中...</div>
      </main>
    );
  }

  if (!user) {
    return null;
  }

  const viewerUser = isViewer(user) ? user : null;

  const handleRevokeAuthorization = async () => {
    try {
      setRevoking(true);
      await logout();
    } catch (error) {
      console.error("Failed to revoke authorization:", error);
      setRevoking(false);
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleDateString("zh-TW", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      {/* Header */}
      <header className="border-b border-white/10 backdrop-blur-sm bg-black/20">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <button
            type="button"
            onClick={() => router.push("/dashboard/viewer")}
            className="text-purple-300 hover:text-white transition-colors flex items-center gap-2"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
            返回儀表板
          </button>
          <h1 className="text-lg font-semibold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400">
            帳號設定
          </h1>
          <div className="w-24" />
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        {/* Message Alert */}
        {message && (
          <div
            className={`p-4 rounded-xl backdrop-blur-sm border ${
              message.type === "success"
                ? "bg-green-500/20 text-green-300 border-green-500/30"
                : "bg-red-500/20 text-red-300 border-red-500/30"
            }`}
          >
            {message.text}
          </div>
        )}

        {/* Profile Section */}
        <section className="bg-white/10 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
          <h2 className="text-xl font-semibold mb-4 text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400">
            個人資料
          </h2>
          <div className="flex items-center gap-6">
            {viewerUser?.avatarUrl && (
              <Image
                src={viewerUser.avatarUrl}
                alt={viewerUser.displayName}
                width={80}
                height={80}
                className="w-20 h-20 rounded-full border-4 border-purple-500/50 object-cover ring-4 ring-purple-500/20"
                unoptimized
              />
            )}
            <div>
              <p className="text-xl font-medium text-white">
                {viewerUser?.displayName}
              </p>
              <p className="text-purple-300/70">
                Twitch ID: {viewerUser?.twitchUserId}
              </p>
              {viewerUser?.consentedAt && (
                <p className="text-sm text-gray-400 mt-1">
                  同意隱私條款於：
                  {new Date(viewerUser.consentedAt).toLocaleDateString("zh-TW")}
                </p>
              )}
            </div>
          </div>
        </section>

        {/* Privacy Settings Section */}
        <section className="bg-white/10 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
          <h2 className="text-xl font-semibold mb-4 text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400">
            隱私設定
          </h2>
          <div className="space-y-4">
            {/* 資料收集開關 */}
            <div className="flex items-center justify-between p-4 bg-white/5 rounded-xl border border-white/5">
              <div>
                <p className="font-medium text-white">資料收集</p>
                <p className="text-sm text-gray-400">
                  {pauseCollection
                    ? "已暫停收集您的聊天互動資料"
                    : "系統正在記錄您的聊天互動資料"}
                </p>
              </div>
              <button
                onClick={handleToggleCollection}
                disabled={isUpdating || privacyLoading}
                className={`relative w-14 h-8 rounded-full transition-all duration-300 ${
                  pauseCollection
                    ? "bg-gray-600"
                    : "bg-gradient-to-r from-green-500 to-emerald-500"
                } ${isUpdating || privacyLoading ? "opacity-50" : ""}`}
              >
                <span
                  className={`absolute top-1 left-1 w-6 h-6 rounded-full bg-white shadow-lg transition-transform duration-300 ${
                    pauseCollection ? "" : "translate-x-6"
                  }`}
                />
              </button>
            </div>

            <div className="flex items-center justify-between p-4 bg-white/5 rounded-xl border border-white/5">
              <div>
                <p className="font-medium text-white">觀看歷史記錄</p>
                <p className="text-sm text-gray-400">
                  允許記錄您的觀看時數和歷程
                </p>
              </div>
              <span className="px-3 py-1 bg-green-500/20 text-green-400 text-sm rounded-full border border-green-500/30">
                啟用中
              </span>
            </div>
          </div>
        </section>

        {/* Data Summary Section */}
        <section className="bg-white/10 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
          <h2 className="text-xl font-semibold mb-4 text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400">
            您的資料統計
          </h2>
          {privacyLoading ? (
            <p className="text-gray-400">載入中...</p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-4 bg-gradient-to-br from-blue-500/20 to-blue-600/10 rounded-xl border border-blue-500/20 text-center">
                <p className="text-2xl font-bold text-blue-400">
                  {dataSummary?.totalMessages.toLocaleString() ?? "-"}
                </p>
                <p className="text-sm text-blue-300/70">總訊息數</p>
              </div>
              <div className="p-4 bg-gradient-to-br from-purple-500/20 to-purple-600/10 rounded-xl border border-purple-500/20 text-center">
                <p className="text-2xl font-bold text-purple-400">
                  {dataSummary?.channelCount ?? "-"}
                </p>
                <p className="text-sm text-purple-300/70">追蹤頻道</p>
              </div>
              <div className="p-4 bg-gradient-to-br from-pink-500/20 to-pink-600/10 rounded-xl border border-pink-500/20 text-center">
                <p className="text-sm font-medium text-pink-400">
                  {formatDate(dataSummary?.dateRange.oldest ?? null)}
                </p>
                <p className="text-sm text-pink-300/70">最早記錄</p>
              </div>
              <div className="p-4 bg-gradient-to-br from-emerald-500/20 to-emerald-600/10 rounded-xl border border-emerald-500/20 text-center">
                <p className="text-sm font-medium text-emerald-400">
                  {formatDate(dataSummary?.dateRange.newest ?? null)}
                </p>
                <p className="text-sm text-emerald-300/70">最近記錄</p>
              </div>
            </div>
          )}
        </section>

        {/* Data Export Section */}
        <section className="bg-white/10 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
          <h2 className="text-xl font-semibold mb-4 text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400">
            資料管理
          </h2>
          <div className="flex items-center justify-between p-4 bg-white/5 rounded-xl border border-white/5">
            <div>
              <p className="font-medium text-white">匯出我的資料</p>
              <p className="text-sm text-gray-400">
                下載您的所有觀看和互動統計資料
              </p>
            </div>
            <button
              type="button"
              className="px-4 py-2 text-sm border border-purple-500/50 text-purple-400 rounded-lg hover:bg-purple-500/10 transition-colors"
              onClick={() => alert("此功能將於 Story 2.5 實作")}
            >
              匯出 (JSON)
            </button>
          </div>
        </section>

        {/* Danger Zone */}
        <section className="bg-red-500/10 backdrop-blur-sm rounded-2xl border border-red-500/20 p-6">
          <h2 className="text-xl font-semibold mb-4 text-red-400">危險區域</h2>
          <div className="space-y-4">
            {/* 清除訊息資料 */}
            <div className="p-4 bg-red-500/10 rounded-xl border border-red-500/20">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-red-400">清除所有訊息資料</p>
                  <p className="text-sm text-red-300/70">
                    刪除所有聊天記錄和統計資料。此操作無法復原。
                  </p>
                </div>
                {!showDeleteConfirm ? (
                  <button
                    type="button"
                    onClick={() => setShowDeleteConfirm(true)}
                    className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                  >
                    清除資料
                  </button>
                ) : (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleClearAllData}
                      disabled={isDeleting}
                      className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
                    >
                      {isDeleting ? "刪除中..." : "確認"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowDeleteConfirm(false)}
                      disabled={isDeleting}
                      className="px-4 py-2 text-sm border border-gray-500 text-gray-400 rounded-lg hover:bg-white/5 disabled:opacity-50 transition-colors"
                    >
                      取消
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* 撤銷授權 */}
            <div className="p-4 bg-red-500/10 rounded-xl border border-red-500/20">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-red-400">撤銷 Twitch 授權</p>
                  <p className="text-sm text-red-300/70">
                    這將刪除您的所有資料並登出。此操作無法還原。
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowRevokeConfirm(true)}
                  className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                >
                  撤銷授權
                </button>
              </div>
            </div>

            {/* 登出 */}
            <div className="p-4 bg-white/5 rounded-xl border border-white/5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-white">登出</p>
                  <p className="text-sm text-gray-400">
                    登出此帳號，您的資料將會保留
                  </p>
                </div>
                <button
                  type="button"
                  onClick={logout}
                  className="px-4 py-2 text-sm border border-gray-500 text-gray-400 rounded-lg hover:bg-white/5 transition-colors"
                >
                  登出
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* Revoke Confirmation Modal */}
      {showRevokeConfirm && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-slate-800 rounded-2xl shadow-2xl p-6 max-w-md mx-4 border border-white/10">
            <h3 className="text-xl font-semibold mb-4 text-red-400">
              確認撤銷授權？
            </h3>
            <p className="text-gray-300 mb-6">
              撤銷授權後，您的所有觀看記錄和互動統計將被永久刪除。
              如果您想繼續使用本平台，需要重新登入並同意隱私條款。
            </p>
            <div className="flex gap-4">
              <button
                type="button"
                onClick={() => setShowRevokeConfirm(false)}
                disabled={revoking}
                className="flex-1 px-4 py-2 border border-gray-500 text-gray-300 rounded-lg hover:bg-white/5 disabled:opacity-50 transition-colors"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleRevokeAuthorization}
                disabled={revoking}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {revoking ? "處理中..." : "確認撤銷"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
