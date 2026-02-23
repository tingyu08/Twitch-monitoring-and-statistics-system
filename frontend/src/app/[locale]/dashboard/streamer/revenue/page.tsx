"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft, Download, RefreshCw, Loader2, ChevronDown } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { SubscriptionStats } from "@/features/streamer-dashboard/charts/SubscriptionStats";
import { BitsStats } from "@/features/streamer-dashboard/charts/BitsStats";
import { RevenueOverview } from "@/features/streamer-dashboard/charts/RevenueOverview";
import { getApiUrl } from "@/lib/api/getApiUrl";

export default function RevenuePage() {
  const t = useTranslations("streamer.revenue");
  const tCommon = useTranslations("common");
  const params = useParams();
  const locale = (params?.locale as string) || "zh-TW";

  const [activeTab, setActiveTab] = useState<"overview" | "subscriptions" | "bits">("overview");
  const [days, setDays] = useState(30);
  const [syncing, setSyncing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0); // 用於觸發資料重新獲取

  const handleSync = async () => {
    setSyncing(true);
    try {
      // 開發環境直接連接後端以避免 Next.js rewrites 延遲
      const res = await fetch(getApiUrl("/api/streamer/revenue/sync"), {
        method: "POST",
        credentials: "include",
      });

      if (!res.ok) {
        const contentType = res.headers.get("content-type") || "";
        let errorData: Record<string, unknown> = {};
        let errorText: string | undefined;

        if (contentType.includes("application/json")) {
          errorData = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        } else {
          errorText = await res.text().catch(() => undefined);
        }

        // 開發環境中輸出詳細錯誤資訊
        console.error("Sync failed:", {
          status: res.status,
          contentType,
          error: errorData.error,
          details: errorData.details,
          stack: errorData.stack,
          errorText,
        });
        const errorString = typeof errorData.error === "string" ? errorData.error : undefined;

        // 根據不同錯誤顯示不同訊息
        if (res.status === 504 || errorString?.includes("timeout")) {
          toast.error(t("syncTimeout") || "Sync timeout - please try again");
        } else if (res.status === 507) {
          // 訂閱數量超限錯誤
          toast.error(
            t("subscriptionLimitExceeded") ||
              "Channel has too many subscribers. Please contact support for enterprise solutions."
          );
        } else if (res.status === 401) {
          toast.error(t("syncAuthError") || "Please re-login to sync");
        } else if (res.status === 403) {
          toast.error(t("syncPermissionError") || "Requires Affiliate/Partner status");
        } else {
          // 顯示詳細錯誤（開發環境）
          const detail = (errorData.details as string | undefined) || errorText;
          const detailMsg = detail ? `: ${detail}` : "";
          toast.error(`${t("syncError")}${detailMsg}`);
        }
        return;
      }

      toast.success(t("syncSuccess"));
      // 使用狀態更新觸發資料重新獲取，避免整頁重新載入
      setRefreshKey((prev) => prev + 1);
    } catch (error) {
      console.error("Sync error:", error);
      toast.error(t("syncError"));
    } finally {
      setSyncing(false);
    }
  };

  const handleExport = async (format: "csv" | "pdf" = "csv") => {
    setExporting(true);
    setShowExportMenu(false);
    try {
      // 開發環境直接連接後端以避免 Next.js rewrites 延遲
      const res = await fetch(
        getApiUrl(`/api/streamer/revenue/export?format=${format}&days=${days}`),
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("Export failed");

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `revenue-report-${days}days.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      toast.success(t("exportSuccess"));
    } catch (error) {
      console.error("Export error:", error);
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      toast.error(`${t("exportError")}: ${errorMessage}`);
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

            {/* 匯出按鈕下拉選單 */}
            <div className="relative">
              <button
                onClick={() => setShowExportMenu(!showExportMenu)}
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
                <ChevronDown className="w-4 h-4" />
              </button>
              {showExportMenu && (
                <div className="absolute right-0 mt-2 w-40 bg-gray-800 border border-gray-700 rounded-lg shadow-lg z-10">
                  <button
                    onClick={() => handleExport("csv")}
                    className="w-full px-4 py-2 text-left text-sm text-white hover:bg-gray-700 rounded-t-lg"
                  >
                    📊 CSV {t("exportFormat")}
                  </button>
                  <button
                    onClick={() => handleExport("pdf")}
                    className="w-full px-4 py-2 text-left text-sm text-white hover:bg-gray-700 rounded-b-lg"
                  >
                    📄 PDF {t("exportFormat")}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Tab 切換 */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setActiveTab("overview")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === "overview"
                ? "bg-green-600 text-white"
                : "bg-gray-800 text-gray-400 hover:text-white"
            }`}
          >
            {t("overview")}
          </button>
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
          {activeTab === "overview" && <RevenueOverview key={`overview-${refreshKey}`} />}
          {activeTab === "subscriptions" && (
            <SubscriptionStats key={`subs-${refreshKey}`} days={days} />
          )}
          {activeTab === "bits" && <BitsStats key={`bits-${refreshKey}`} days={days} />}
        </div>
      </div>
    </div>
  );
}
