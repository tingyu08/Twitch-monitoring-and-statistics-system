"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { isStreamer, type StreamerInfo } from "@/lib/api/auth";
import { useAuthSession } from "@/features/auth/AuthContext";
import { StreamSummaryCards } from "@/features/streamer-dashboard/components/StreamSummaryCards";
import { DisplayPreferences } from "@/features/streamer-dashboard/components/DisplayPreferences";
import {
  ChartLoading,
  ChartError,
  ChartEmpty,
  ChartDataLimitedBanner,
} from "@/features/streamer-dashboard/charts";
import {
  useTimeSeriesData,
  useHeatmapData,
  useSubscriptionTrendData,
  type ChartRange,
  type ChartGranularity,
} from "@/features/streamer-dashboard/hooks/useChartData";
import { useUiPreferences } from "@/features/streamer-dashboard/hooks/useUiPreferences";
import { authLogger } from "@/lib/logger";
import { DashboardHeader } from "@/components";
import { QuickActionsPanel } from "@/features/streamer-dashboard/components/QuickActionsPanel";
import { StreamSettingsEditor } from "@/features/streamer-dashboard/components/StreamSettingsEditor";
import { useSWRConfig } from "swr";
import type {
  HeatmapResponse,
  SubscriptionTrendResponse,
  TimeSeriesResponse,
  StreamerSummary,
} from "@/lib/api/streamer";

const TimeSeriesChart = dynamic(
  () => import("@/features/streamer-dashboard/charts/TimeSeriesChart").then((mod) => mod.TimeSeriesChart),
  { ssr: false }
);

const HeatmapChart = dynamic(
  () => import("@/features/streamer-dashboard/charts/HeatmapChart").then((mod) => mod.HeatmapChart),
  { ssr: false }
);

const SubscriptionTrendChart = dynamic(
  () =>
    import("@/features/streamer-dashboard/charts/SubscriptionTrendChart").then(
      (mod) => mod.SubscriptionTrendChart
    ),
  { ssr: false }
);

const GameStatsChart = dynamic(
  () => import("@/features/streamer-dashboard/charts/GameStatsChart").then((mod) => mod.GameStatsChart),
  { ssr: false }
);

export default function StreamerDashboard() {
  const t = useTranslations("streamer");
  const [user, setUser] = useState<StreamerInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const router = useRouter();
  const { logout, user: authUser, loading: authLoading } = useAuthSession();
  const { mutate } = useSWRConfig();

  const [chartRange, setChartRange] = useState<ChartRange>("30d");
  const [granularity, setGranularity] = useState<ChartGranularity>("day");
  const [subsChartRange, setSubsChartRange] = useState<ChartRange>("30d");

  // Epic 4 state
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const [bootstrapLoaded, setBootstrapLoaded] = useState(false);
  const [bootstrapSummary, setBootstrapSummary] = useState<StreamerSummary | null>(null);
  const canFetch = !!user && bootstrapLoaded;

  const timeSeries = useTimeSeriesData(chartRange, granularity, canFetch);
  const heatmap = useHeatmapData(chartRange, canFetch);
  const subscriptionTrend = useSubscriptionTrendData(subsChartRange, canFetch);

  const {
    preferences,
    togglePreference,
    showAll,
    resetToDefault,
    isLoaded,
    visibleCount,
  } = useUiPreferences();

  const visibleSectionCount = useMemo(() => {
    if (typeof visibleCount === "number") return visibleCount;
    const prefs = preferences ?? {};
    return [
      "showSummaryCards",
      "showTimeSeriesChart",
      "showHeatmapChart",
      "showSubscriptionChart",
    ].reduce(
      (acc, key) => (prefs[key as keyof typeof prefs] ? acc + 1 : acc),
      0
    );
  }, [preferences, visibleCount]);

  const uiPrefs = useMemo(
    () =>
      preferences ?? {
        showSummaryCards: true,
        showTimeSeriesChart: true,
        showHeatmapChart: true,
        showSubscriptionChart: true,
      },
    [preferences]
  );

  useEffect(() => {
    if (authLoading) {
      setLoading(true);
      return;
    }

    if (!authUser) {
      setError("無法獲取資料");
      setLoading(false);
      setTimeout(() => router.push("/"), 1500);
      return;
    }

    if (isStreamer(authUser)) {
      setUser(authUser as StreamerInfo);
      setError("");
      setLoading(false);
      return;
    }

    authLogger.warn("Dashboard role mismatch", { userId: "viewerId" in authUser ? authUser.viewerId : null });
    setError("目前登入的角色不是實況主");
    setLoading(false);
    setTimeout(() => router.push("/"), 1500);
  }, [authLoading, authUser, router]);

  useEffect(() => {
    if (!user) return;

    let cancelled = false;
    const bootstrapChartRange: ChartRange = "30d";
    const bootstrapGranularity: ChartGranularity = "day";
    const bootstrapSubsRange: ChartRange = "30d";

    const fetchBootstrap = async () => {
      setBootstrapLoaded(false);
      try {
        const response = await fetch(`/api/streamer/dashboard`, { credentials: "include" });

        if (!response.ok) {
          throw new Error(`Dashboard bootstrap failed: ${response.status}`);
        }

        const data: {
          summary: StreamerSummary;
          timeSeries: TimeSeriesResponse;
          heatmap: HeatmapResponse;
          subscriptionTrend: SubscriptionTrendResponse;
        } = await response.json();

        if (cancelled) return;

        setBootstrapSummary(data.summary ?? null);
        mutate(
          `/api/streamer/time-series/${bootstrapChartRange}/${bootstrapGranularity}`,
          data.timeSeries.data,
          false
        );
        mutate(`/api/streamer/heatmap/${bootstrapChartRange}`, data.heatmap, false);
        mutate(`/api/streamer/subscription-trend/${bootstrapSubsRange}`, data.subscriptionTrend, false);
        if (!cancelled) {
          setBootstrapLoaded(true);
        }
      } catch (err) {
        authLogger.warn("Dashboard bootstrap failed", err);
        if (!cancelled) {
          setBootstrapLoaded(true);
          mutate(`/api/streamer/time-series/${bootstrapChartRange}/${bootstrapGranularity}`);
          mutate(`/api/streamer/heatmap/${bootstrapChartRange}`);
          mutate(`/api/streamer/subscription-trend/${bootstrapSubsRange}`);
        }
      }
    };

    fetchBootstrap();

    return () => {
      cancelled = true;
    };
  }, [user, mutate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-purple-400"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4">
        <p className="text-red-400 mb-4 text-xl">無法載入資料</p>
        <p className="text-purple-300 dark:text-purple-400/70 mb-4">{error}</p>
        <p className="text-purple-300/50 text-sm">正在返回首頁...</p>
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-purple-400"></div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen"
      data-testid="dashboard-container"
      data-loaded="true"
    >
      {/* Header Bar */}
      <DashboardHeader variant="streamer" />

      <div className="max-w-7xl mx-auto px-4 py-4 sm:py-6 md:py-8">
        {/* User Header Section */}
        <section
          className="mb-6 sm:mb-8 md:mb-10 theme-header-card p-4 sm:p-6"
          data-testid="dashboard-header"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 sm:gap-6">
            <div className="flex items-center gap-3 sm:gap-5">
              {user?.avatarUrl && (
                <Image
                  src={user.avatarUrl}
                  alt="Profile"
                  width={80}
                  height={80}
                  className="w-14 h-14 sm:w-16 sm:h-16 md:w-20 md:h-20 rounded-full border-2 sm:border-4 border-purple-500/50 object-cover ring-2 sm:ring-4 ring-purple-500/20"
                  data-testid="user-avatar"
                />
              )}
              <div>
                <h1
                  className="text-xl sm:text-2xl md:text-3xl theme-text-gradient"
                  data-testid="dashboard-title"
                >
                  {t("title")}
                </h1>
                <p
                  className="text-sm sm:text-base theme-text-secondary mt-0.5 sm:mt-1"
                  data-testid="user-greeting"
                >
                  {t("welcome", { name: user?.displayName || "Streamer" })}
                </p>
              </div>
            </div>

            <div className="hidden md:flex items-center gap-3">
              <button
                type="button"
                onClick={logout}
                className="px-4 py-2 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-sm text-red-300 transition-colors border border-red-500/20"
                data-testid="logout-button"
              >
                {t("logout")}
              </button>
            </div>
          </div>
        </section>

        <div className="mb-6 flex justify-end">
          <DisplayPreferences
            preferences={uiPrefs}
            onToggle={togglePreference}
            compact
          />
        </div>

        {/* Story 1.2: 開台統計總覽 */}
        {uiPrefs.showSummaryCards && (
          <div className="mb-8" data-testid="summary-section">
            <StreamSummaryCards initialSummary={bootstrapSummary} initialRange={chartRange} />
          </div>
        )}

        {/* Story 1.3: 時間與頻率圖表 */}
        {uiPrefs.showTimeSeriesChart && (
          <div className="mb-8" data-testid="timeseries-section">
            <div className="theme-card p-4 sm:p-6">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
                <h2
                  className="text-lg sm:text-xl font-semibold theme-text-gradient"
                  data-testid="timeseries-title"
                >
                  {t("scheduleAnalysis")}
                </h2>
                <div className="flex flex-wrap gap-2">
                  <select
                    id="chart-range"
                    name="chart-range"
                    value={chartRange}
                    onChange={(e) =>
                      setChartRange(e.target.value as "7d" | "30d" | "90d")
                    }
                    className="px-3 py-1.5 bg-white/50 dark:bg-white/10 border border-purple-200 dark:border-white/10 rounded-lg text-sm theme-text-primary"
                    data-testid="chart-range-select"
                  >
                    <option value="7d">{t("recentDays", { days: 7 })}</option>
                    <option value="30d">{t("recentDays", { days: 30 })}</option>
                    <option value="90d">{t("recentDays", { days: 90 })}</option>
                  </select>
                  <select
                    id="chart-granularity"
                    name="chart-granularity"
                    value={granularity}
                    onChange={(e) =>
                      setGranularity(e.target.value as "day" | "week")
                    }
                    className="px-3 py-1.5 bg-white/50 dark:bg-white/10 border border-purple-200 dark:border-white/10 rounded-lg text-sm theme-text-primary"
                    data-testid="chart-granularity-select"
                  >
                    <option value="day">{t("byDay")}</option>
                    <option value="week">{t("byWeek")}</option>
                  </select>
                </div>
              </div>

              {timeSeries.isLoading ? (
                <ChartLoading message={t("loadingCharts")} />
              ) : timeSeries.error ? (
                <ChartError
                  error={timeSeries.error}
                  onRetry={timeSeries.refresh}
                />
              ) : timeSeries.data.length === 0 ? (
                <ChartEmpty
                  emoji="📊"
                  title={t("noStreamData")}
                  description={t("noStreamDataDesc", {
                    range: chartRange,
                  })}
                  hint={t("tryOtherRange")}
                />
              ) : (
                <div data-testid="timeseries-chart">
                  <TimeSeriesChart
                    data={timeSeries.data}
                    granularity={granularity}
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Story 1.3: 熱力圖 */}
        {uiPrefs.showHeatmapChart && (
          <div className="mb-8" data-testid="heatmap-section">
            <div className="theme-card p-4 sm:p-6">
              <h2
                className="text-lg sm:text-xl font-semibold theme-text-gradient mb-6"
                data-testid="heatmap-title"
              >
                {t("timeDistribution")}
              </h2>
              {heatmap.isLoading ? (
                <ChartLoading message={t("loadingCharts")} />
              ) : heatmap.error ? (
                <ChartError error={heatmap.error} onRetry={heatmap.refresh} />
              ) : heatmap.data.length === 0 ? (
                <ChartEmpty
                  emoji="🔥"
                  title={t("noTimeData")}
                  description={t("noStreamDataDesc", {
                    range: chartRange,
                  })}
                  hint={t("tryOtherRange")}
                />
              ) : (
                <div data-testid="heatmap-chart">
                  <HeatmapChart
                    data={heatmap.data}
                    maxValue={heatmap.maxValue}
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Story 1.4: 訂閱趨勢 */}
        {uiPrefs.showSubscriptionChart && (
          <div className="mb-8" data-testid="subscription-section">
            <div className="theme-card p-4 sm:p-6">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
                <h2 className="text-lg sm:text-xl font-semibold theme-text-gradient">
                  {t("subTrends")}
                </h2>
                <select
                  id="subs-chart-range"
                  name="subs-chart-range"
                  value={subsChartRange}
                  onChange={(e) =>
                    setSubsChartRange(e.target.value as ChartRange)
                  }
                  className="px-3 py-1.5 bg-white/50 dark:bg-white/10 border border-purple-200 dark:border-white/10 rounded-lg text-sm theme-text-primary"
                >
                  <option value="7d">{t("recentDays", { days: 7 })}</option>
                  <option value="30d">{t("recentDays", { days: 30 })}</option>
                  <option value="90d">{t("recentDays", { days: 90 })}</option>
                </select>
              </div>

              {subscriptionTrend.currentDataDays <
                subscriptionTrend.minDataDays &&
                subscriptionTrend.currentDataDays > 0 && (
                  <ChartDataLimitedBanner
                    currentDays={subscriptionTrend.currentDataDays}
                    minDays={subscriptionTrend.minDataDays}
                  />
                )}

              {subscriptionTrend.isLoading ? (
                <ChartLoading message={t("loadingCharts")} />
              ) : subscriptionTrend.error ? (
                <ChartError
                  error={subscriptionTrend.error}
                  onRetry={subscriptionTrend.refresh}
                />
              ) : subscriptionTrend.data.length === 0 ? (
                <ChartEmpty
                  emoji="📈"
                  title={t("noSubData")}
                  description={t("noSubDataDesc")}
                  hint={t("subDataHint")}
                />
              ) : (
                <SubscriptionTrendChart
                  data={subscriptionTrend.data}
                  isEstimated={subscriptionTrend.isEstimated}
                  currentDataDays={subscriptionTrend.currentDataDays}
                  range={subsChartRange}
                />
              )}
            </div>
          </div>
        )}

        {/* Story 6.5: Category Performance */}
        <div className="mb-8">
          <GameStatsChart range={chartRange} />
        </div>

        {visibleSectionCount === 0 && (
          <div className="mb-8 p-6 rounded-2xl border border-dashed border-white/20 bg-white/5 text-center text-purple-300/70">
            {t("allHidden")}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* 基本資料卡片 */}
          <div className="theme-card p-6 h-full">
            <h2 className="text-xl font-semibold mb-4 theme-text-gradient">
              {t("accountInfo")}
            </h2>
            <div className="space-y-3">
              <div className="flex justify-between border-b border-purple-100 dark:border-white/10 pb-2">
                <span className="theme-text-secondary">{t("displayName")}</span>
                <span className="theme-text-primary">{user?.displayName}</span>
              </div>
              <div className="flex justify-between border-b border-purple-100 dark:border-white/10 pb-2">
                <span className="theme-text-secondary">{t("twitchId")}</span>
                <span className="text-xs font-mono theme-text-muted">
                  {user?.twitchUserId}
                </span>
              </div>
              <div className="flex justify-between border-b border-purple-100 dark:border-white/10 pb-2">
                <span className="theme-text-secondary">{t("systemId")}</span>
                <span className="text-xs font-mono theme-text-muted">
                  {user?.streamerId}
                </span>
              </div>
              <div className="flex justify-between border-b border-purple-100 dark:border-white/10 pb-2">
                <span className="theme-text-secondary">{t("channelLink")}</span>
                <a
                  href={user?.channelUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-purple-600 dark:text-purple-400 hover:text-purple-500 dark:hover:text-purple-300 text-sm truncate max-w-[200px]"
                >
                  {user?.channelUrl}
                </a>
              </div>
            </div>
          </div>

          {/* Quick Actions Panel */}
          <div className="h-full">
            <QuickActionsPanel
              onManageSettings={() => setIsSettingsOpen(true)}
            />
          </div>
        </div>
      </div>

      {/* Stream Settings Editor */}
      <StreamSettingsEditor
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />
    </div>
  );
}
