"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { getStreamerSummary, type StreamerSummary } from "@/lib/api/streamer";
import { StatCard } from "./StatCard";
import { DateRangePicker } from "./DateRangePicker";
import { apiLogger } from "@/lib/logger";

type DateRange = "7d" | "30d" | "90d";

export function StreamSummaryCards() {
  const t = useTranslations("streamer");
  const [range, setRange] = useState<DateRange>("30d");
  const [summary, setSummary] = useState<StreamerSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchSummary = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await getStreamerSummary(range);
        setSummary(data);
      } catch (err) {
        apiLogger.error("Failed to fetch summary:", err);
        // Using a generic error message or translation
        setError(err instanceof Error ? err.message : "Failed to load stats");
      } finally {
        setLoading(false);
      }
    };

    fetchSummary();
  }, [range]);

  const getDays = (r: DateRange) =>
    r === "7d" ? "7" : r === "30d" ? "30" : "90";

  if (error) {
    return (
      <div
        className="bg-red-900/20 border border-red-700 rounded-lg p-6"
        role="alert"
        aria-live="assertive"
      >
        <p className="text-red-400">⚠️ {error}</p>
      </div>
    );
  }

  return (
    <section className="space-y-6" aria-label={t("overviewTitle")}>
      {/* 時間範圍選擇器 */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h2 id="stats-heading" className="text-2xl theme-text-gradient">
          {t("overviewTitle")}
        </h2>
        <DateRangePicker selectedRange={range} onRangeChange={setRange} />
      </div>

      {/* Summary Cards */}
      {loading ? (
        <div
          className="grid grid-cols-1 md:grid-cols-3 gap-6"
          role="status"
          aria-busy="true"
          aria-label={t("loadingCharts")}
        >
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="theme-card p-6 animate-pulse"
              aria-hidden="true"
            >
              <div className="h-4 bg-gray-700 rounded w-24 mb-4"></div>
              <div className="h-10 bg-gray-700 rounded w-32 mb-2"></div>
              <div className="h-3 bg-gray-700 rounded w-16"></div>
            </div>
          ))}
          <span className="sr-only">{t("loadingCharts")}</span>
        </div>
      ) : summary ? (
        // 檢查是否所有值都是 0（無資料狀態）
        summary.totalStreamSessions === 0 &&
        summary.totalStreamHours === 0 &&
        summary.avgStreamDurationMinutes === 0 ? (
          <div className="theme-card p-12 text-center">
            <p className="theme-text-secondary text-lg">{t("noStreamData")}</p>
            <p className="theme-text-muted text-sm mt-2">
              {t("startStreamHint")}
            </p>
            {summary.isEstimated && (
              <p className="text-yellow-500 text-xs mt-4 px-3 py-1 bg-yellow-900/20 border border-yellow-700 rounded inline-block">
                ⚠️ {t("summary.dataSyncing")}
              </p>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <StatCard
              title={t("summary.totalHours")}
              value={summary.totalStreamHours}
              unit={t("summary.unitHours")}
              subtitle={t("summary.pastDays", { days: getDays(range) })}
              isEstimated={summary.isEstimated}
            />
            <StatCard
              title={t("summary.totalSessions")}
              value={summary.totalStreamSessions}
              unit={t("summary.unitSessions")}
              subtitle={t("summary.pastDays", { days: getDays(range) })}
              isEstimated={summary.isEstimated}
            />
            <StatCard
              title={t("summary.avgDuration")}
              value={summary.avgStreamDurationMinutes}
              unit={t("summary.unitMinutes")}
              subtitle={t("summary.avgDesc")}
              isEstimated={summary.isEstimated}
            />
          </div>
        )
      ) : (
        <div className="theme-card p-12 text-center">
          <p className="theme-text-secondary text-lg">{t("noStreamData")}</p>
          <p className="theme-text-muted text-sm mt-2">
            {t("startStreamHint")}
          </p>
        </div>
      )}
    </section>
  );
}
