"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import Image from "next/image";
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

export default function ViewerChannelStatsPage() {
  const params = useParams<{ channelId: string }>();
  const channelId = params?.channelId;
  const router = useRouter();
  const { user, loading: authLoading } = useAuthSession();
  const [stats, setStats] = useState<ViewerChannelStats | null>(null);
  const [messageStats, setMessageStats] =
    useState<ViewerMessageStatsResponse | null>(null);
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

        const [channelData, messageData] = await Promise.all([
          viewerApi.getChannelStats(channelId, days),
          viewerApi.getMessageStats(
            viewerId,
            channelId,
            startDate.toISOString(),
            endDate.toISOString()
          ),
        ]);

        if (!channelData) {
          setError("查無資料");
          return;
        }
        setStats(channelData);
        setMessageStats(messageData);
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
      <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-purple-400"></div>
      </main>
    );
  }

  if (error || !stats) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-white">
        <p className="text-red-400 mb-6 text-xl">{error || "無法載入資料"}</p>
        <button
          type="button"
          onClick={() => router.push("/dashboard/viewer")}
          className="px-6 py-2 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-xl hover:from-purple-500 hover:to-pink-500 transition-colors"
        >
          返回儀表板
        </button>
      </main>
    );
  }

  const { channel, dailyStats, summary } = stats;

  const chartData = dailyStats.map((stat) => ({
    date: stat.date.slice(5),
    觀看時數: stat.watchHours,
    留言數: stat.messageCount,
    表情符號: stat.emoteCount,
  }));

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-white">
      {/* Header Bar */}
      <header className="border-b border-white/10 backdrop-blur-sm bg-black/20">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-2 text-sm text-purple-300/70">
          <button
            onClick={() => router.push("/dashboard/viewer")}
            className="hover:text-purple-400 transition-colors"
          >
            觀眾儀表板
          </button>
          <span>/</span>
          <span className="text-white">{channel.displayName}</span>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Channel Header */}
        <section className="mb-10 bg-white/10 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
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
                <h1 className="text-3xl font-bold text-white mb-1 flex items-center gap-3">
                  {channel.displayName}
                  <span className="text-lg font-normal text-purple-300/50 font-mono">
                    @{channel.name}
                  </span>
                </h1>
                <p className="text-purple-300/70 text-sm">
                  查看你在該頻道的觀看記錄與互動分析
                </p>
              </div>
            </div>

            <button
              onClick={() =>
                router.push(`/dashboard/viewer/footprint/${channelId}`)
              }
              className="px-5 py-2.5 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white rounded-xl shadow-lg shadow-purple-900/40 font-bold transition-all transform hover:-translate-y-1 hover:shadow-purple-900/60 flex items-center gap-2 border border-white/10"
            >
              <span className="text-xl">🏆</span>
              查看成就足跡
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
          <span className="text-sm text-purple-300/50">
            {timeRange === "custom" && customRange ? (
              <>自訂範圍：{getDisplayDays()} 天</>
            ) : (
              <>顯示過去 {getDisplayDays()} 天的資料</>
            )}
          </span>
        </div>

        {/* 觀看統計摘要 */}
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400 mb-4">
            觀看統計摘要
          </h2>

          <div className="grid gap-4 grid-cols-2 md:grid-cols-4 lg:grid-cols-7">
            {/* 總觀看時數 */}
            <div className="relative overflow-hidden bg-gradient-to-br from-blue-500/20 to-blue-600/10 backdrop-blur-sm rounded-xl border border-blue-500/20 p-4 text-center group hover:border-blue-500/40 transition-all">
              <div className="relative z-10">
                <p className="text-2xl font-bold text-blue-400">
                  {summary.totalWatchHours}
                </p>
                <p className="text-xs text-blue-300/70">總觀看時數</p>
              </div>
              <Clock className="absolute -right-4 -bottom-4 w-24 h-24 text-blue-500/5 group-hover:text-blue-500/10 transition-colors rotate-12" />
            </div>

            {/* 觀看次數 */}
            <div className="relative overflow-hidden bg-gradient-to-br from-cyan-500/20 to-cyan-600/10 backdrop-blur-sm rounded-xl border border-cyan-500/20 p-4 text-center group hover:border-cyan-500/40 transition-all">
              <div className="relative z-10">
                <p className="text-2xl font-bold text-cyan-400">
                  {summary.sessionCount}
                </p>
                <p className="text-xs text-cyan-300/70">觀看次數</p>
              </div>
              <Eye className="absolute -right-4 -bottom-4 w-24 h-24 text-cyan-500/5 group-hover:text-cyan-500/10 transition-colors rotate-12" />
            </div>

            {/* 總留言數 */}
            <div className="relative overflow-hidden bg-gradient-to-br from-green-500/20 to-green-600/10 backdrop-blur-sm rounded-xl border border-green-500/20 p-4 text-center group hover:border-green-500/40 transition-all">
              <div className="relative z-10">
                <p className="text-2xl font-bold text-green-400">
                  {summary.totalMessages}
                </p>
                <p className="text-xs text-green-300/70">總留言數</p>
              </div>
              <MessageSquare className="absolute -right-4 -bottom-4 w-24 h-24 text-green-500/5 group-hover:text-green-500/10 transition-colors rotate-12" />
            </div>

            {/* 表情符號 */}
            <div className="relative overflow-hidden bg-gradient-to-br from-yellow-500/20 to-yellow-600/10 backdrop-blur-sm rounded-xl border border-yellow-500/20 p-4 text-center group hover:border-yellow-500/40 transition-all">
              <div className="relative z-10">
                <p className="text-2xl font-bold text-yellow-400">
                  {summary.totalEmotes}
                </p>
                <p className="text-xs text-yellow-300/70">表情符號</p>
              </div>
              <Smile className="absolute -right-4 -bottom-4 w-24 h-24 text-yellow-500/5 group-hover:text-yellow-500/10 transition-colors rotate-12" />
            </div>

            {/* 日均分鐘 */}
            <div className="relative overflow-hidden bg-gradient-to-br from-purple-500/20 to-purple-600/10 backdrop-blur-sm rounded-xl border border-purple-500/20 p-4 text-center group hover:border-purple-500/40 transition-all">
              <div className="relative z-10">
                <p className="text-2xl font-bold text-purple-400">
                  {summary.averageWatchMinutesPerDay}
                </p>
                <p className="text-xs text-purple-300/70">日均分鐘</p>
              </div>
              <Activity className="absolute -right-4 -bottom-4 w-24 h-24 text-purple-500/5 group-hover:text-purple-500/10 transition-colors rotate-12" />
            </div>

            {/* 首次觀看 */}
            <div className="relative overflow-hidden bg-white/10 backdrop-blur-sm rounded-xl border border-white/10 p-4 text-center group hover:border-white/20 transition-all">
              <div className="relative z-10">
                <p className="text-lg font-semibold text-white">
                  {summary.firstWatchDate
                    ? summary.firstWatchDate.slice(0, 10)
                    : "-"}
                </p>
                <p className="text-xs text-purple-300/50">首次觀看</p>
              </div>
              <Calendar className="absolute -right-4 -bottom-4 w-24 h-24 text-white/5 group-hover:text-white/10 transition-colors rotate-12" />
            </div>

            {/* 最後觀看 */}
            <div className="relative overflow-hidden bg-white/10 backdrop-blur-sm rounded-xl border border-white/10 p-4 text-center group hover:border-white/20 transition-all">
              <div className="relative z-10">
                <p className="text-lg font-semibold text-white">
                  {summary.lastWatchDate
                    ? summary.lastWatchDate.slice(0, 10)
                    : "-"}
                </p>
                <p className="text-xs text-purple-300/50">最後觀看</p>
              </div>
              <History className="absolute -right-4 -bottom-4 w-24 h-24 text-white/5 group-hover:text-white/10 transition-colors rotate-12" />
            </div>
          </div>
        </div>

        {/* 聊天與互動統計 */}
        {messageStats && (
          <div className="mb-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <h2 className="text-lg font-semibold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400 mb-4">
              聊天互動分析
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
        <div className="bg-white/10 backdrop-blur-sm rounded-2xl border border-white/10 p-6 mb-8">
          <h2 className="text-lg font-semibold mb-6 text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400">
            觀看時數趨勢
            {timeRange === "all"
              ? "（全部資料）"
              : `（過去 ${getDisplayDays()} 天）`}
          </h2>
          <div className="h-80">
            <SafeResponsiveContainer>
              <LineChart data={chartData}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="rgba(255,255,255,0.1)"
                  vertical={false}
                />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 12, fill: "rgba(167, 139, 250, 0.7)" }}
                  axisLine={{ stroke: "rgba(255,255,255,0.2)" }}
                  tickLine={false}
                  dy={10}
                />
                <YAxis
                  tick={{ fontSize: 12, fill: "rgba(167, 139, 250, 0.7)" }}
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
                  dataKey="觀看時數"
                  stroke="#60A5FA"
                  strokeWidth={3}
                  dot={{ r: 4, fill: "#60A5FA", strokeWidth: 0 }}
                  activeDot={{ r: 6, fill: "#BFDBFE" }}
                />
              </LineChart>
            </SafeResponsiveContainer>
          </div>
        </div>

        {/* 未來功能預留區 */}
        <div className="mt-8 p-6 bg-white/5 backdrop-blur-sm rounded-2xl border-2 border-dashed border-white/20 text-center">
          <h3 className="text-purple-300/70 font-medium mb-3">
            更多深度分析功能，即將登場
          </h3>
          <div className="flex flex-wrap justify-center gap-4 text-sm text-purple-300/50">
            <span className="px-3 py-1 bg-white/10 rounded-full border border-white/10">
              詳細觀看記錄
            </span>
            <span className="px-3 py-1 bg-white/10 rounded-full border border-white/10">
              詞彙雲分析
            </span>
            <span className="px-3 py-1 bg-white/10 rounded-full border border-white/10">
              訂閱里程碑
            </span>
            <span className="px-3 py-1 bg-white/10 rounded-full border border-white/10">
              忠誠度徽章
            </span>
          </div>
        </div>
      </div>
    </main>
  );
}
