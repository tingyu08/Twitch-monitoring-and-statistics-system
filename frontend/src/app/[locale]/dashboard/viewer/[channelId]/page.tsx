"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import Image from "next/image";
import { useTranslations, useLocale } from "next-intl";
import {
  Clock,
  Eye,
  MessageSquare,
  Smile,
  Activity,
  Calendar,
  History,
} from "lucide-react";
import { useAuthSession } from "@/features/auth/AuthContext";
import {
  viewerApi,
  type ViewerChannelStats,
  type ViewerMessageStatsResponse,
} from "@/lib/api/viewer";
import { isViewer } from "@/lib/api/auth";
import type { GameStats } from "@/lib/api/streamer";
import { MessageStatsSummary } from "@/features/viewer-dashboard/components/MessageStatsSummary";
import { MessageTrendChart } from "@/features/viewer-dashboard/components/MessageTrendChart";
import { InteractionBreakdownChart } from "@/features/viewer-dashboard/components/InteractionBreakdownChart";
import {
  TimeRangeSelector,
  getRangeDays,
  getCustomRangeDays,
  type TimeRange,
  type CustomDateRange,
} from "@/features/viewer-dashboard/components/TimeRangeSelector";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { SafeResponsiveContainer } from "@/components/charts/SafeResponsiveContainer";
import { GameStatsChart } from "@/features/streamer-dashboard/charts/GameStatsChart";

import { ChannelVideosSection } from "@/features/viewer-dashboard/components/ChannelVideosSection";
import { ViewerTrendsChart } from "@/features/viewer-dashboard/components/ViewerTrendsChart";
import type { ViewerTrendPoint } from "@/lib/api/viewer";

export default function ViewerChannelStatsPage() {
  const t = useTranslations();
  const locale = useLocale();
  const params = useParams<{ channelId: string }>();
  const channelId = params?.channelId;
  const router = useRouter();
  const { user, loading: authLoading } = useAuthSession();
  const [stats, setStats] = useState<ViewerChannelStats | null>(null);
  const [messageStats, setMessageStats] =
    useState<ViewerMessageStatsResponse | null>(null);
  const [gameStats, setGameStats] = useState<GameStats[] | null>(null);
  const [viewerTrends, setViewerTrends] = useState<ViewerTrendPoint[] | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>("30");
  const [customRange, setCustomRange] = useState<CustomDateRange | null>(null);

  const loadStats = useCallback(
    async (days: number) => {
      if (!channelId || !user || !isViewer(user) || !user.viewerId) {
        setError("缺少資料或無權限");
        return;
      }
      const viewerId = user.viewerId;

      try {
        setLoading(true);
        setError(null);

        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(endDate.getDate() - days);

        const rangeKey = days === 7 ? "7d" : days === 90 ? "90d" : "30d";

        const [channelData, messageData, gameData, trendsData] =
          await Promise.all([
            viewerApi.getChannelStats(channelId, days),
            viewerApi.getMessageStats(
              viewerId,
              channelId,
              startDate.toISOString(),
              endDate.toISOString()
            ),
            viewerApi.getChannelGameStats(channelId, rangeKey),
            viewerApi.getChannelViewerTrends(channelId, rangeKey),
          ]);

        if (!channelData) {
          setError("查無資料");
          return;
        }
        setStats(channelData);
        setMessageStats(messageData);
        setGameStats(gameData);
        setViewerTrends(trendsData);
      } catch (err) {
        setError(err instanceof Error ? err.message : "載入統計時發生錯誤");
      } finally {
        setLoading(false);
      }
    },
    [channelId, user]
  );

  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      router.push("/");
      return;
    }

    if (user && channelId) {
      loadStats(getRangeDays(timeRange));
    } else if (user && !channelId) {
      setError("缺少頻道代碼");
      setLoading(false);
    }
  }, [authLoading, user, channelId, router, loadStats, timeRange]);

  const handleRangeChange = (newRange: TimeRange) => {
    setTimeRange(newRange);
    if (newRange !== "custom") {
      setCustomRange(null);
    }
  };

  const handleCustomRangeChange = (range: CustomDateRange) => {
    setCustomRange(range);
    const days = getCustomRangeDays(range);
    loadStats(days);
  };

  const getDisplayDays = () => {
    if (timeRange === "custom" && customRange) {
      return getCustomRangeDays(customRange);
    }
    return getRangeDays(timeRange);
  };

  if (authLoading || loading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-purple-600 dark:border-purple-400"></div>
      </main>
    );
  }

  if (error || !stats) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center theme-text-primary">
        <p className="text-red-500 dark:text-red-400 mb-6 text-xl">
          {error || t("channel.noData")}
        </p>
        <button
          type="button"
          onClick={() => router.push("/dashboard/viewer")}
          className="px-6 py-2 theme-btn-primary rounded-xl transition-colors"
        >
          {t("channel.backToDashboard")}
        </button>
      </main>
    );
  }

  const { channel, dailyStats, summary } = stats;

  const chartData = dailyStats.map((stat) => ({
    date: stat.date.slice(5),
    watchHours: stat.watchHours,
    messageCount: stat.messageCount,
    emoteCount: stat.emoteCount,
  }));

  return (
    <main className="theme-main-bg theme-text-primary">
      {/* Header Bar */}
      <header className="border-b border-purple-300 dark:border-white/10 backdrop-blur-md bg-white/70 dark:bg-black/20 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-2 text-sm theme-text-secondary">
          <button
            onClick={() => router.push("/dashboard/viewer")}
            className="hover:text-purple-600 dark:hover:text-purple-400 transition-colors"
          >
            {t("nav.viewerDashboard")}
          </button>
          <span>/</span>
          <span className="theme-text-primary">{channel.displayName}</span>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Channel Header */}
        <section className="mb-10 theme-header-card p-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="flex items-center gap-6">
              <div className="relative">
                <Image
                  src={channel.avatarUrl}
                  alt={channel.displayName}
                  width={80}
                  height={80}
                  className="w-20 h-20 rounded-full border-4 border-purple-500/50 ring-4 ring-purple-500/20 object-cover shadow-xl"
                  unoptimized
                  priority
                />
                {channel.isLive && (
                  <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-red-600 text-white text-[10px] font-bold rounded-full uppercase tracking-wider border border-slate-800">
                    LIVE
                  </span>
                )}
              </div>
              <div>
                <h1 className="text-3xl theme-text-gradient mb-1 flex items-center gap-3">
                  {channel.displayName}
                  <span className="text-lg font-normal theme-text-muted font-mono">
                    @{channel.name}
                  </span>
                </h1>
                <a
                  href={`https://twitch.tv/${channel.name}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="theme-text-secondary text-sm flex items-center gap-1 hover:underline hover:text-purple-600 dark:hover:text-purple-300 transition-colors w-fit"
                >
                  {t("channel.goToWatch")}
                  <svg
                    className="w-3 h-3"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                    />
                  </svg>
                </a>
              </div>
            </div>

            <button
              onClick={() =>
                router.push(`/dashboard/viewer/footprint/${channelId}`)
              }
              className="px-5 py-2.5 theme-btn-primary rounded-xl shadow-lg shadow-purple-900/20 font-bold transition-all transform hover:-translate-y-1 hover:shadow-purple-900/40 flex items-center gap-2 border border-white/10"
            >
              <span className="text-xl">🏆</span>
              {t("channel.viewFootprint")}
            </button>
          </div>
        </section>

        {/* 時間範圍選擇器 */}
        <div className="mb-6 flex items-center justify-between flex-wrap gap-4">
          <TimeRangeSelector
            currentRange={timeRange}
            onRangeChange={handleRangeChange}
            onCustomRangeChange={handleCustomRangeChange}
            disabled={loading}
          />
          <span className="text-sm theme-text-muted">
            {timeRange === "custom" && customRange ? (
              <>{t("timeRange.customRange", { days: getDisplayDays() })}</>
            ) : (
              <>{t("timeRange.showingDays", { days: getDisplayDays() })}</>
            )}
          </span>
        </div>

        {/* 觀看統計摘要 */}
        <div className="mb-8">
          <h2 className="text-lg font-semibold theme-text-gradient mb-4">
            {t("stats.summary")}
          </h2>

          <div className="grid gap-4 grid-cols-2 md:grid-cols-4 lg:grid-cols-7">
            {/* 總觀看時數 */}
            <div className="relative overflow-hidden bg-blue-50 dark:bg-blue-500/10 backdrop-blur-sm rounded-xl border border-blue-200 dark:border-blue-500/20 p-3 sm:p-4 text-center group hover:border-blue-400 dark:hover:border-blue-500/40 transition-all">
              <div className="relative z-10">
                <p className="text-xl sm:text-2xl font-bold text-blue-700 dark:text-blue-400">
                  {summary.totalWatchHours}
                </p>
                <p className="text-xs text-blue-600/70 dark:text-blue-300/70">
                  {t("stats.totalWatchHours")}
                </p>
              </div>
              <Clock className="absolute -right-4 -bottom-4 w-20 h-20 sm:w-24 sm:h-24 text-blue-500/5 group-hover:text-blue-500/10 transition-colors rotate-12 hidden sm:block" />
            </div>

            {/* 觀看次數 */}
            <div className="relative overflow-hidden bg-cyan-50 dark:bg-cyan-500/10 backdrop-blur-sm rounded-xl border border-cyan-200 dark:border-cyan-500/20 p-3 sm:p-4 text-center group hover:border-cyan-400 dark:hover:border-cyan-500/40 transition-all">
              <div className="relative z-10">
                <p className="text-xl sm:text-2xl font-bold text-cyan-700 dark:text-cyan-400">
                  {summary.sessionCount}
                </p>
                <p className="text-xs text-cyan-600/70 dark:text-cyan-300/70">
                  {t("stats.watchCount")}
                </p>
              </div>
              <Eye className="absolute -right-4 -bottom-4 w-20 h-20 sm:w-24 sm:h-24 text-cyan-500/5 group-hover:text-cyan-500/10 transition-colors rotate-12 hidden sm:block" />
            </div>

            {/* 總留言數 */}
            <div className="relative overflow-hidden bg-green-50 dark:bg-green-500/10 backdrop-blur-sm rounded-xl border border-green-200 dark:border-green-500/20 p-3 sm:p-4 text-center group hover:border-green-400 dark:hover:border-green-500/40 transition-all">
              <div className="relative z-10">
                <p className="text-xl sm:text-2xl font-bold text-green-700 dark:text-green-400">
                  {summary.totalMessages}
                </p>
                <p className="text-xs text-green-600/70 dark:text-green-300/70">
                  {t("stats.totalMessages")}
                </p>
              </div>
              <MessageSquare className="absolute -right-4 -bottom-4 w-20 h-20 sm:w-24 sm:h-24 text-green-500/5 group-hover:text-green-500/10 transition-colors rotate-12 hidden sm:block" />
            </div>

            {/* 表情符號 */}
            <div className="relative overflow-hidden bg-yellow-50 dark:bg-yellow-500/10 backdrop-blur-sm rounded-xl border border-yellow-200 dark:border-yellow-500/20 p-3 sm:p-4 text-center group hover:border-yellow-400 dark:hover:border-yellow-500/40 transition-all">
              <div className="relative z-10">
                <p className="text-xl sm:text-2xl font-bold text-yellow-700 dark:text-yellow-400">
                  {summary.totalEmotes}
                </p>
                <p className="text-xs text-yellow-600/70 dark:text-yellow-300/70">
                  {t("stats.emotes")}
                </p>
              </div>
              <Smile className="absolute -right-4 -bottom-4 w-20 h-20 sm:w-24 sm:h-24 text-yellow-500/5 group-hover:text-yellow-500/10 transition-colors rotate-12 hidden sm:block" />
            </div>

            {/* 日均分鐘 */}
            <div className="relative overflow-hidden bg-purple-50 dark:bg-purple-500/10 backdrop-blur-sm rounded-xl border border-purple-200 dark:border-purple-500/20 p-3 sm:p-4 text-center group hover:border-purple-400 dark:hover:border-purple-500/40 transition-all">
              <div className="relative z-10">
                <p className="text-xl sm:text-2xl font-bold text-purple-700 dark:text-purple-400">
                  {summary.averageWatchMinutesPerDay}
                </p>
                <p className="text-xs text-purple-600/70 dark:text-purple-300/70">
                  {t("stats.dailyAvgMinutes")}
                </p>
              </div>
              <Activity className="absolute -right-4 -bottom-4 w-20 h-20 sm:w-24 sm:h-24 text-purple-500/5 group-hover:text-purple-500/10 transition-colors rotate-12 hidden sm:block" />
            </div>

            {/* 首次觀看 */}
            <div className="relative overflow-hidden theme-card p-3 sm:p-4 text-center group hover:border-purple-400 transition-all">
              <div className="relative z-10">
                <p className="text-base sm:text-lg font-semibold theme-text-primary">
                  {summary.firstWatchDate
                    ? summary.firstWatchDate.slice(0, 10)
                    : "-"}
                </p>
                <p className="text-xs theme-text-muted">
                  {t("stats.firstWatch")}
                </p>
              </div>
              <Calendar className="absolute -right-4 -bottom-4 w-20 h-20 sm:w-24 sm:h-24 text-purple-500/5 group-hover:text-purple-500/10 transition-colors rotate-12 hidden sm:block" />
            </div>

            {/* 最後觀看 */}
            <div className="relative overflow-hidden theme-card p-3 sm:p-4 text-center group hover:border-purple-400 transition-all">
              <div className="relative z-10">
                <p className="text-base sm:text-lg font-semibold theme-text-primary">
                  {summary.lastWatchDate
                    ? summary.lastWatchDate.slice(0, 10)
                    : "-"}
                </p>
                <p className="text-xs theme-text-muted">
                  {t("stats.lastWatch")}
                </p>
              </div>
              <History className="absolute -right-4 -bottom-4 w-20 h-20 sm:w-24 sm:h-24 text-purple-500/5 group-hover:text-purple-500/10 transition-colors rotate-12 hidden sm:block" />
            </div>
          </div>
        </div>

        {/* 聊天與互動統計 */}
        {messageStats && (
          <div className="mb-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <h2 className="text-lg font-semibold theme-text-gradient mb-4">
              {t("stats.chatAnalysis")}
            </h2>

            <MessageStatsSummary summary={messageStats.summary} />

            <div className="grid gap-6 md:grid-cols-3 mt-6">
              <div className="md:col-span-2">
                <MessageTrendChart data={messageStats.dailyBreakdown} />
              </div>
              <div>
                <InteractionBreakdownChart
                  data={messageStats.interactionBreakdown}
                />
              </div>
            </div>
          </div>
        )}

        {/* 觀看時數趨勢圖 */}
        <div className="theme-card p-6 mb-8">
          <h2 className="text-lg font-semibold mb-6 theme-text-gradient">
            {t("stats.watchTrend")}
            {timeRange === "all"
              ? `（${t("stats.allData")}）`
              : `（${t("stats.pastDays", { days: getDisplayDays() })}）`}
          </h2>
          <div className="h-80">
            <SafeResponsiveContainer>
              <LineChart data={chartData}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="currentColor"
                  className="text-purple-200 dark:text-white/10"
                  vertical={false}
                />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 12, fill: "currentColor" }}
                  stroke="currentColor"
                  className="text-purple-600 dark:text-purple-300/70"
                  axisLine={{
                    stroke: "currentColor",
                    className: "text-purple-200 dark:text-white/20",
                  }}
                  tickLine={false}
                  dy={10}
                />
                <YAxis
                  tick={{ fontSize: 12, fill: "currentColor" }}
                  stroke="currentColor"
                  className="text-purple-600 dark:text-purple-300/70"
                  axisLine={false}
                  tickLine={false}
                  dx={-10}
                  unit="h"
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "rgba(30, 27, 75, 0.95)",
                    borderColor: "rgba(139, 92, 246, 0.3)",
                    borderRadius: "0.75rem",
                    color: "#F3F4F6",
                  }}
                  itemStyle={{ color: "#F3F4F6" }}
                />
                <Legend iconType="circle" />
                <Line
                  type="monotone"
                  dataKey="watchHours"
                  name={t("stats.watchHours")}
                  stroke="#60A5FA"
                  strokeWidth={3}
                  dot={{ r: 4, fill: "#60A5FA", strokeWidth: 0 }}
                  activeDot={{ r: 6, fill: "#BFDBFE" }}
                />
              </LineChart>
            </SafeResponsiveContainer>
          </div>
        </div>

        {/* 遊戲與分類統計 */}
        {gameStats && gameStats.length > 0 && (
          <div className="mb-8">
            <h2 className="text-lg font-semibold theme-text-gradient mb-4">
              {t("streamer.charts.gameSelection")}
            </h2>
            <GameStatsChart data={gameStats} loading={loading} />
          </div>
        )}

        {/* 觀眾人數趨勢 */}
        {viewerTrends && (
          <div className="mb-8">
            <ViewerTrendsChart data={viewerTrends} loading={loading} />
          </div>
        )}

        {/* 影片與剪輯列表 */}
        {channelId && <ChannelVideosSection channelId={channelId} />}

        {/* 未來功能預留區 */}
        <div className="mt-8 p-6 theme-card border-2 border-dashed border-purple-200 dark:border-white/20 text-center">
          <h3 className="theme-text-secondary font-medium mb-3">
            {t("channel.comingSoon")}
          </h3>
          <div className="flex flex-wrap justify-center gap-4 text-sm theme-text-muted">
            <span className="px-3 py-1 bg-purple-50 dark:bg-white/10 rounded-full border border-purple-200 dark:border-white/10">
              {t("channel.detailedHistory")}
            </span>
            <span className="px-3 py-1 bg-purple-50 dark:bg-white/10 rounded-full border border-purple-200 dark:border-white/10">
              {t("channel.wordCloud")}
            </span>
            <span className="px-3 py-1 bg-purple-50 dark:bg-white/10 rounded-full border border-purple-200 dark:border-white/10">
              {t("channel.milestone")}
            </span>
            <span className="px-3 py-1 bg-purple-50 dark:bg-white/10 rounded-full border border-purple-200 dark:border-white/10">
              {t("channel.loyalty")}
            </span>
          </div>
        </div>
      </div>
    </main>
  );
}
