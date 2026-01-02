"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { getMe, isStreamer, type StreamerInfo } from "@/lib/api/auth";
import { useAuthSession } from "@/features/auth/AuthContext";
import { StreamSummaryCards } from "@/features/streamer-dashboard/components/StreamSummaryCards";
import { DisplayPreferences } from "@/features/streamer-dashboard/components/DisplayPreferences";
import {
  TimeSeriesChart,
  HeatmapChart,
  SubscriptionTrendChart,
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

export default function StreamerDashboard() {
  const [user, setUser] = useState<StreamerInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const router = useRouter();
  const { logout } = useAuthSession();

  const [chartRange, setChartRange] = useState<ChartRange>("30d");
  const [granularity, setGranularity] = useState<ChartGranularity>("day");
  const [subsChartRange, setSubsChartRange] = useState<ChartRange>("30d");

  const canFetch = !!user;

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
    const fetchData = async () => {
      try {
        const data = await getMe();
        if (isStreamer(data)) {
          setUser(data);
        } else {
          setError("目前登入的角色不是實況主");
          setTimeout(() => router.push("/"), 1500);
          return;
        }
      } catch (err: unknown) {
        authLogger.error("Dashboard fetch error:", err);
        const errorMessage =
          err instanceof Error ? err.message : "無法獲取資料";
        setError(errorMessage);

        const errMsg = errorMessage.toLowerCase();
        if (
          errMsg.includes("unauthorized") ||
          errMsg.includes("auth") ||
          errMsg.includes("token") ||
          errMsg.includes("status 401")
        ) {
          setTimeout(() => router.push("/"), 2000);
        }
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [router]);

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
                  unoptimized
                />
              )}
              <div>
                <h1
                  className="text-xl sm:text-2xl md:text-3xl theme-text-gradient"
                  data-testid="dashboard-title"
                >
                  實況主儀表板
                </h1>
                <p
                  className="text-sm sm:text-base theme-text-secondary mt-0.5 sm:mt-1"
                  data-testid="user-greeting"
                >
                  歡迎回來，{user?.displayName || "實況主"}
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
                登出
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
            <StreamSummaryCards />
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
                  開台時間分析
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
                    <option value="7d">最近 7 天</option>
                    <option value="30d">最近 30 天</option>
                    <option value="90d">最近 90 天</option>
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
                    <option value="day">依日</option>
                    <option value="week">依週</option>
                  </select>
                </div>
              </div>

              {timeSeries.isLoading ? (
                <ChartLoading message="載入圖表資料中..." />
              ) : timeSeries.error ? (
                <ChartError
                  error={timeSeries.error}
                  onRetry={timeSeries.refresh}
                />
              ) : timeSeries.data.length === 0 ? (
                <ChartEmpty
                  emoji="📊"
                  title="暫無開台資料"
                  description={`在選定的 ${
                    chartRange === "7d"
                      ? "7天"
                      : chartRange === "30d"
                      ? "30天"
                      : "90天"
                  } 時間範圍內沒有開台記錄`}
                  hint="試試切換其他時間範圍"
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
                開台時段分布
              </h2>
              {heatmap.isLoading ? (
                <ChartLoading message="載入熱力圖資料中..." />
              ) : heatmap.error ? (
                <ChartError error={heatmap.error} onRetry={heatmap.refresh} />
              ) : heatmap.data.length === 0 ? (
                <ChartEmpty
                  emoji="🔥"
                  title="暫無時段資料"
                  description={`在選定的 ${
                    chartRange === "7d"
                      ? "7天"
                      : chartRange === "30d"
                      ? "30天"
                      : "90天"
                  } 時間範圍內沒有開台記錄`}
                  hint="試試切換其他時間範圍"
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
                  訂閱數趨勢
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
                  <option value="7d">最近 7 天</option>
                  <option value="30d">最近 30 天</option>
                  <option value="90d">最近 90 天</option>
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
                <ChartLoading message="載入訂閱趨勢資料中..." />
              ) : subscriptionTrend.error ? (
                <ChartError
                  error={subscriptionTrend.error}
                  onRetry={subscriptionTrend.refresh}
                />
              ) : subscriptionTrend.data.length === 0 ? (
                <ChartEmpty
                  emoji="📈"
                  title="尚無訂閱資料"
                  description="系統尚未開始收集訂閱數據，請稍後再試"
                  hint="訂閱數據需要每日同步，請確保已授權相關權限"
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

        {visibleSectionCount === 0 && (
          <div className="mb-8 p-6 rounded-2xl border border-dashed border-white/20 bg-white/5 text-center text-purple-300/70">
            所有圖表都被隱藏，請在「顯示偏好」中開啟想要的區塊。
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* 基本資料卡片 */}
          <div className="theme-card p-6">
            <h2 className="text-xl font-semibold mb-4 theme-text-gradient">
              帳戶資訊
            </h2>
            <div className="space-y-3">
              <div className="flex justify-between border-b border-purple-100 dark:border-white/10 pb-2">
                <span className="theme-text-secondary">顯示名稱</span>
                <span className="theme-text-primary">{user?.displayName}</span>
              </div>
              <div className="flex justify-between border-b border-purple-100 dark:border-white/10 pb-2">
                <span className="theme-text-secondary">Twitch ID</span>
                <span className="text-xs font-mono theme-text-muted">
                  {user?.twitchUserId}
                </span>
              </div>
              <div className="flex justify-between border-b border-purple-100 dark:border-white/10 pb-2">
                <span className="theme-text-secondary">系統 ID</span>
                <span className="text-xs font-mono theme-text-muted">
                  {user?.streamerId}
                </span>
              </div>
              <div className="flex justify-between border-b border-purple-100 dark:border-white/10 pb-2">
                <span className="theme-text-secondary">頻道連結</span>
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

          {/* 功能區塊 */}
          <div className="theme-card p-6">
            <h2 className="text-xl font-semibold mb-4 theme-text-gradient">
              快速功能
            </h2>
            <div className="space-y-3">
              <button className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white py-2 px-4 rounded-xl transition duration-200 font-medium">
                管理實況設定
              </button>
              <button className="w-full bg-white/50 dark:bg-white/10 hover:bg-white/80 dark:hover:bg-white/20 theme-text-primary py-2 px-4 rounded-xl transition duration-200 border border-purple-200 dark:border-white/10">
                查看收益分析
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
