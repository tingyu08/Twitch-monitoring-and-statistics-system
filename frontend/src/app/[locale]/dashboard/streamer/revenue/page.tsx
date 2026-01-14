"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft, Download, RefreshCw, Loader2 } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { SubscriptionStats } from "@/features/streamer-dashboard/charts/SubscriptionStats";
import { BitsStats } from "@/features/streamer-dashboard/charts/BitsStats";

export default function RevenuePage() {
  const t = useTranslations("streamer.revenue");
  const tCommon = useTranslations("common");
  const params = useParams();
  const locale = (params?.locale as string) || "zh-TW";

  const [activeTab, setActiveTab] = useState<"subscriptions" | "bits">(
    "subscriptions"
  );
  const [days, setDays] = useState(30);
  const [syncing, setSyncing] = useState(false);
  const [exporting, setExporting] = useState(false);

  const apiBaseUrl =
    process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000";

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch(`${apiBaseUrl}/api/streamer/revenue/sync`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Sync failed");
      toast.success(t("syncSuccess"));
      // 重新載入頁面來更新數據
      window.location.reload();
    } catch {
      toast.error(t("syncError"));
    } finally {
      setSyncing(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await fetch(
        `${apiBaseUrl}/api/streamer/revenue/export?format=csv&days=${days}`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("Export failed");

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `revenue-report-${days}days.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      toast.success(t("exportSuccess"));
    } catch {
      toast.error(t("exportError"));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-4">
            <Link
              href={`/${locale}/dashboard/streamer`}
              className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 transition-colors"
            >
              <ArrowLeft className="w-5 h-5 text-gray-400" />
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-white">{t("title")}</h1>
              <p className="text-gray-400 text-sm">{t("subtitle")}</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* 時間範圍選擇 */}
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm"
            >
              <option value={7}>{t("days7")}</option>
              <option value={30}>{t("days30")}</option>
              <option value={90}>{t("days90")}</option>
            </select>

            {/* 同步按鈕 */}
            <button
              onClick={handleSync}
              disabled={syncing}
              className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-500 
                         text-white rounded-lg text-sm font-medium transition-colors
                         disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {syncing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              {t("sync")}
            </button>

            {/* 匯出按鈕 */}
            <button
              onClick={handleExport}
              disabled={exporting}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-500 
                         text-white rounded-lg text-sm font-medium transition-colors
                         disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {exporting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Download className="w-4 h-4" />
              )}
              {t("export")}
            </button>
          </div>
        </div>

        {/* Tab 切換 */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setActiveTab("subscriptions")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === "subscriptions"
                ? "bg-purple-600 text-white"
                : "bg-gray-800 text-gray-400 hover:text-white"
            }`}
          >
            {t("subscriptions")}
          </button>
          <button
            onClick={() => setActiveTab("bits")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === "bits"
                ? "bg-orange-600 text-white"
                : "bg-gray-800 text-gray-400 hover:text-white"
            }`}
          >
            {t("bits")}
          </button>
        </div>

        {/* 內容區域 */}
        <div className="bg-gray-800/30 rounded-2xl p-6 border border-gray-700/50">
          {activeTab === "subscriptions" ? (
            <SubscriptionStats days={days} />
          ) : (
            <BitsStats days={days} />
          )}
        </div>
      </div>
    </div>
  );
}
