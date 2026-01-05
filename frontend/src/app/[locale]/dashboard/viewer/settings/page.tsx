"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { useAuthSession } from "@/features/auth/AuthContext";
import { isViewer } from "@/lib/api/auth";
import { viewerApi } from "@/lib/api/viewer";
import { httpClient } from "@/lib/api/httpClient";

// 隱私設定類別定義 (Simplified for i18n)
const privacyCategories = [
  {
    id: "watchTime",
    settings: [
      { key: "collectDailyWatchTime" },
      { key: "collectWatchTimeDistribution" },
      { key: "collectMonthlyAggregates" },
    ],
  },
  {
    id: "messages",
    settings: [
      { key: "collectChatMessages" },
      { key: "collectInteractions" },
      { key: "collectInteractionFrequency" },
    ],
  },
  {
    id: "badges",
    settings: [
      { key: "collectBadgeProgress" },
      { key: "collectFootprintData" },
    ],
  },
  {
    id: "analytics",
    settings: [{ key: "collectRankings" }, { key: "collectRadarAnalysis" }],
  },
];

interface DataSummary {
  totalMessages: number;
  totalAggregations: number;
  channelCount: number;
  dateRange: {
    oldest: string | null;
    newest: string | null;
  };
}

interface PrivacySettings {
  [key: string]: boolean;
}

export default function ViewerSettingsPage() {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const { user, loading, logout } = useAuthSession();
  const [revoking, setRevoking] = useState(false); // Kept for legacy compatibility if needed

  // States merged from PrivacySettingsPage
  const [settings, setSettings] = useState<PrivacySettings>({});
  const [dataSummary, setDataSummary] = useState<DataSummary | null>(null);
  const [privacyLoading, setPrivacyLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletionStatus, setDeletionStatus] = useState<{
    hasPendingDeletion: boolean;
    remainingDays?: number;
    scheduledAt?: string;
  } | null>(null);
  const [exportStatus, setExportStatus] = useState<{
    isExporting: boolean;
    jobId?: string;
    downloadReady?: boolean;
  }>({ isExporting: false });
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/");
    }
  }, [loading, user, router]);

  // 載入設定
  useEffect(() => {
    if (user && !loading) {
      loadPrivacyData();
    }
  }, [user, loading]);

  const loadPrivacyData = async () => {
    setPrivacyLoading(true);
    try {
      // Parallel fetch of settings, summary, and deletion status
      const [consentData, summary, deletionData] = await Promise.all([
        httpClient<any>("/api/viewer/privacy/consent").catch(() => null),
        viewerApi.getDataSummary().catch(() => null),
        httpClient<any>("/api/viewer/privacy/deletion-status").catch(
          () => null
        ),
      ]);

      if (consentData) {
        setSettings(consentData.settings || {});
      }
      if (summary) {
        setDataSummary(summary);
      }
      if (deletionData) {
        setDeletionStatus(deletionData);
      }
    } catch (error) {
      console.error("Failed to load privacy data:", error);
    } finally {
      setPrivacyLoading(false);
    }
  };

  // 切換設定
  const handleToggle = async (key: string) => {
    const newValue = !settings[key];
    const newSettings = { ...settings, [key]: newValue };
    setSettings(newSettings);

    setIsSaving(true);
    try {
      await httpClient("/api/viewer/privacy/consent", {
        method: "PATCH",
        body: JSON.stringify({ [key]: newValue }),
      });

      setMessage({ type: "success", text: "設定已儲存" });
    } catch (error) {
      // 回滾
      setSettings(settings);
      setMessage({ type: "error", text: "儲存設定失敗，請稍後再試" });
    } finally {
      setIsSaving(false);
      setTimeout(() => setMessage(null), 3000);
    }
  };

  // 請求資料匯出
  const handleExport = async () => {
    setExportStatus({ isExporting: true });
    try {
      const data = await httpClient<any>("/api/viewer/privacy/export", {
        method: "POST",
      });

      setExportStatus({
        isExporting: false,
        jobId: data.jobId,
        downloadReady: data.status === "completed",
      });
      setMessage({ type: "success", text: "資料匯出完成！" });
    } catch (error) {
      setExportStatus({ isExporting: false });
      setMessage({ type: "error", text: "匯出失敗，請稍後再試" });
    }
    setTimeout(() => setMessage(null), 3000);
  };

  // 下載匯出檔案
  const handleDownload = () => {
    if (exportStatus.jobId) {
      window.open(
        `/api/viewer/privacy/export/${exportStatus.jobId}/download`,
        "_blank"
      );
    }
  };

  // 請求刪除帳號 (Replaces Revoke/Clear logic with story 2.5 logic)
  const handleDeleteAccount = async () => {
    try {
      const data = await httpClient<any>("/api/viewer/privacy/delete-account", {
        method: "POST",
      });

      setDeletionStatus({
        hasPendingDeletion: true,
        remainingDays: 7,
        scheduledAt: data.scheduledAt,
      });
      setShowDeleteModal(false);
      setMessage({
        type: "success",
        text: "刪除請求已建立，您有 7 天可以撤銷",
      });
    } catch (error) {
      setMessage({ type: "error", text: "刪除請求失敗，請稍後再試" });
    }
    setTimeout(() => setMessage(null), 5000);
  };

  // 撤銷刪除請求
  const handleCancelDeletion = async () => {
    try {
      await httpClient("/api/viewer/privacy/cancel-deletion", {
        method: "POST",
      });

      setDeletionStatus({ hasPendingDeletion: false });
      setMessage({ type: "success", text: "刪除請求已撤銷" });
    } catch (error) {
      setMessage({ type: "error", text: "撤銷失敗，請稍後再試" });
    }
    setTimeout(() => setMessage(null), 3000);
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleDateString("zh-TW", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse theme-text-secondary">
          {t("common.loading")}
        </div>
      </main>
    );
  }

  if (!user) {
    return null;
  }

  const viewerUser = isViewer(user) ? user : null;

  return (
    <main className="theme-main-bg theme-text-primary">
      {/* Header */}
      <header className="border-b border-purple-300 dark:border-white/10 backdrop-blur-md bg-white/70 dark:bg-black/20 sticky top-0 z-40">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <button
            type="button"
            onClick={() => router.push("/dashboard/viewer")}
            className="text-purple-600 dark:text-purple-300 hover:text-purple-800 dark:hover:text-white transition-colors flex items-center gap-2"
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
            {t("settings.backToDashboard")}
          </button>
          <h1 className="text-lg font-semibold theme-text-gradient">
            {t("settings.title")}
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

        {/* 刪除待處理提示 */}
        {deletionStatus?.hasPendingDeletion && (
          <div className="p-4 bg-yellow-900/50 border border-yellow-500 rounded-lg">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-yellow-200">
                  ⚠️ 帳號刪除請求進行中
                </h3>
                <p className="text-yellow-200/80 text-sm mt-1">
                  您的帳號將在 {deletionStatus.remainingDays} 天後被刪除。
                </p>
              </div>
              <button
                onClick={handleCancelDeletion}
                className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 rounded-lg text-white transition-colors"
              >
                撤銷刪除
              </button>
            </div>
          </div>
        )}

        {/* Profile Section */}
        <section className="theme-card p-4 sm:p-6">
          <h2 className="text-lg sm:text-xl font-semibold mb-4 theme-text-gradient">
            {t("settings.profile")}
          </h2>
          <div className="flex items-center gap-4 sm:gap-6">
            {viewerUser?.avatarUrl && (
              <Image
                src={viewerUser.avatarUrl}
                alt={viewerUser.displayName}
                width={80}
                height={80}
                className="w-16 h-16 sm:w-20 sm:h-20 rounded-full border-2 sm:border-4 border-purple-500/50 object-cover ring-2 sm:ring-4 ring-purple-500/20 flex-shrink-0"
                unoptimized
              />
            )}
            <div className="min-w-0">
              <p className="text-lg sm:text-xl font-medium theme-text-primary truncate">
                {viewerUser?.displayName}
              </p>
              <p className="theme-text-secondary text-sm sm:text-base truncate">
                Twitch ID: {viewerUser?.twitchUserId}
              </p>
              {viewerUser?.consentedAt && (
                <p className="text-xs sm:text-sm theme-text-muted mt-1">
                  同意隱私條款於：
                  {new Date(viewerUser.consentedAt).toLocaleDateString("zh-TW")}
                </p>
              )}
            </div>
          </div>
        </section>

        {/* Privacy Settings Section (New 2.5 Features) */}
        <section className="theme-card p-6">
          <h2 className="text-xl font-semibold mb-4 theme-text-gradient">
            {t("settings.privacy.title")}
          </h2>
          <div className="space-y-6">
            {privacyCategories.map((category) => (
              <div
                key={category.id}
                className="bg-purple-50/50 dark:bg-white/5 rounded-lg p-6 space-y-4 border border-purple-100 dark:border-white/5"
              >
                <div>
                  <h3 className="text-lg font-semibold theme-text-primary">
                    {t(`settings.privacy.${category.id}`)}
                  </h3>
                  <p className="theme-text-muted text-sm">
                    {category.id === "id"
                      ? ""
                      : t(`settings.privacy.${category.id}Desc`)}
                  </p>
                </div>

                <div className="space-y-3">
                  {category.settings.map((setting) => (
                    <div
                      key={setting.key}
                      className="flex flex-col sm:flex-row sm:items-center justify-between p-3 bg-white dark:bg-black/20 rounded-lg border border-purple-100 dark:border-white/5 shadow-sm gap-3"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-medium theme-text-primary">
                          {t(`settings.privacy.${setting.key}`)}
                        </div>
                        <div className="theme-text-secondary text-sm">
                          {t(`settings.privacy.${setting.key}Desc`)}
                        </div>
                        {!settings[setting.key] && (
                          <div className="text-yellow-600 dark:text-yellow-400/80 text-xs mt-1">
                            ⚠️ {t(`settings.privacy.${setting.key}Impact`)}
                          </div>
                        )}
                      </div>

                      <button
                        onClick={() => handleToggle(setting.key)}
                        disabled={isSaving}
                        className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 self-end sm:self-center ${
                          settings[setting.key]
                            ? "bg-purple-600"
                            : "bg-gray-400 dark:bg-gray-600"
                        } ${isSaving ? "opacity-50" : ""}`}
                      >
                        <span
                          className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${
                            settings[setting.key] ? "left-7" : "left-1"
                          }`}
                        />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Data Summary Section */}
        <section className="theme-card p-6">
          <h2 className="text-xl font-semibold mb-4 theme-text-gradient">
            {t("settings.dataSummary.title")}
          </h2>
          {privacyLoading ? (
            <p className="theme-text-muted">{t("common.loading")}</p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
              <div className="p-3 sm:p-4 bg-gradient-to-br from-blue-500/20 to-blue-600/10 rounded-xl border border-blue-500/20 text-center">
                <p className="text-xl sm:text-2xl font-bold text-blue-400">
                  {dataSummary?.totalMessages.toLocaleString() ?? "-"}
                </p>
                <p className="text-xs sm:text-sm text-blue-300/70">
                  {t("settings.dataSummary.totalMessages")}
                </p>
              </div>
              <div className="p-3 sm:p-4 bg-gradient-to-br from-purple-500/20 to-purple-600/10 rounded-xl border border-purple-500/20 text-center">
                <p className="text-xl sm:text-2xl font-bold text-purple-400">
                  {dataSummary?.channelCount ?? "-"}
                </p>
                <p className="text-xs sm:text-sm text-purple-300/70">
                  {t("settings.dataSummary.followedChannels")}
                </p>
              </div>
              <div className="p-3 sm:p-4 bg-gradient-to-br from-pink-500/20 to-pink-600/10 rounded-xl border border-pink-500/20 text-center">
                <p className="text-xs sm:text-sm font-medium text-pink-400">
                  {formatDate(dataSummary?.dateRange.oldest ?? null)}
                </p>
                <p className="text-xs sm:text-sm text-pink-300/70">
                  {t("settings.dataSummary.oldestRecord")}
                </p>
              </div>
              <div className="p-3 sm:p-4 bg-gradient-to-br from-emerald-500/20 to-emerald-600/10 rounded-xl border border-emerald-500/20 text-center">
                <p className="text-xs sm:text-sm font-medium text-emerald-400">
                  {formatDate(dataSummary?.dateRange.newest ?? null)}
                </p>
                <p className="text-xs sm:text-sm text-emerald-300/70">
                  {t("settings.dataSummary.newestRecord")}
                </p>
              </div>
            </div>
          )}
        </section>

        {/* Data Management Section (Merged with Danger Zone) */}
        <section className="bg-purple-100/30 dark:bg-gray-700/30 backdrop-blur-sm rounded-2xl border border-purple-200 dark:border-white/10 p-6">
          <h2 className="text-xl font-semibold mb-4 theme-text-primary">
            {t("settings.dataManagement.title")}
          </h2>

          <div className="space-y-6">
            {/* Export Data */}
            <div className="flex flex-col md:flex-row items-center justify-between p-4 bg-white/50 dark:bg-white/5 rounded-xl border border-purple-100 dark:border-white/5 gap-4">
              <div>
                <p className="font-medium theme-text-primary">
                  {t("settings.dataManagement.export")}
                </p>
                <p className="text-sm theme-text-muted">
                  {t("settings.dataManagement.exportDesc")}
                </p>
              </div>
              <button
                onClick={
                  exportStatus.downloadReady ? handleDownload : handleExport
                }
                disabled={exportStatus.isExporting}
                className={`flex-shrink-0 px-6 py-2 rounded-lg font-medium transition-colors ${
                  exportStatus.isExporting
                    ? "bg-gray-400 dark:bg-gray-600 cursor-not-allowed"
                    : exportStatus.downloadReady
                    ? "bg-green-600 hover:bg-green-700 text-white"
                    : "bg-blue-600 hover:bg-blue-700 text-white"
                }`}
              >
                {exportStatus.isExporting
                  ? t("settings.dataManagement.exporting")
                  : exportStatus.downloadReady
                  ? `📥 ${t("settings.dataManagement.download")}`
                  : `📤 ${t("settings.dataManagement.exportButton")}`}
              </button>
            </div>

            {/* Logout */}
            <div className="flex flex-col md:flex-row items-center justify-between p-4 bg-white/50 dark:bg-white/5 rounded-xl border border-purple-100 dark:border-white/5 gap-4">
              <div>
                <p className="font-medium theme-text-primary">
                  {t("common.logout")}
                </p>
                <p className="text-sm theme-text-muted">
                  {t("settings.dataManagement.logoutDesc")}
                </p>
              </div>
              <button
                type="button"
                onClick={logout}
                className="flex-shrink-0 px-6 py-2 border border-purple-300 dark:border-gray-500 text-purple-700 dark:text-gray-300 rounded-lg hover:bg-purple-50 dark:hover:bg-white/5 transition-colors"
              >
                {t("common.logout")}
              </button>
            </div>

            {/* Delete Account (Red Zone) */}
            <div className="flex flex-col md:flex-row items-center justify-between p-4 bg-red-50 dark:bg-red-500/10 rounded-xl border border-red-200 dark:border-red-500/20 gap-4">
              <div>
                <p className="font-medium text-red-600 dark:text-red-400">
                  {t("settings.dataManagement.delete")}
                </p>
                <p className="text-sm text-red-500/70 dark:text-red-300/70">
                  {t("settings.dataManagement.deleteDesc")}
                </p>
              </div>
              <button
                onClick={() => setShowDeleteModal(true)}
                disabled={deletionStatus?.hasPendingDeletion}
                className={`flex-shrink-0 px-6 py-2 rounded-lg font-medium transition-colors ${
                  deletionStatus?.hasPendingDeletion
                    ? "bg-gray-400 dark:bg-gray-600 cursor-not-allowed"
                    : "bg-red-600 hover:bg-red-700 text-white"
                }`}
              >
                🗑️ {t("settings.dataManagement.deleteButton")}
              </button>
            </div>
          </div>
        </section>

        {/* 隱私政策連結 */}
        <div className="text-center text-gray-400 text-sm">
          <a
            href="/privacy-policy"
            className="text-purple-400 hover:text-purple-300 underline"
          >
            {t("settings.privacyPolicy")}
          </a>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-lg p-6 max-w-md w-full space-y-4 border border-white/10">
            <h3 className="text-xl font-bold text-red-400">⚠️ 確認刪除帳號</h3>
            <div className="space-y-2 text-gray-300">
              <p>您確定要刪除您的帳號嗎？</p>
              <ul className="list-disc list-inside text-sm space-y-1">
                <li>您的所有個人資料將被刪除</li>
                <li>7 天內可以撤銷此操作</li>
                <li>7 天後資料將永久匿名化且無法恢復</li>
              </ul>
            </div>
            <div className="flex gap-3 pt-4">
              <button
                onClick={() => setShowDeleteModal(false)}
                className="flex-1 px-4 py-2 bg-gray-600 hover:bg-gray-700 rounded-lg transition-colors text-white"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={handleDeleteAccount}
                className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg transition-colors text-white"
              >
                {t("settings.deleteModal.confirmButton")}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
