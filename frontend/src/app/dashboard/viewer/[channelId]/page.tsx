"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import Image from "next/image";
import { useAuthSession } from "@/features/auth/AuthContext";
import {
  viewerApi,
  type ViewerChannelStats,
  type ViewerMessageStatsResponse,
} from "@/lib/api/viewer";
import { isViewer } from "@/lib/api/auth"; // Import isViewer
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
  ResponsiveContainer,
  Legend,
} from "recharts";

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
      // 使用 isViewer 確保類型安全並檢查 viewerId
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

  // 處理時間範圍變更
  const handleRangeChange = (newRange: TimeRange) => {
    setTimeRange(newRange);
    if (newRange !== "custom") {
      setCustomRange(null);
    }
    // loadStats 會在 useEffect 中因為 timeRange 變化而自動觸發
  };

  // 處理自訂日期範圍變更
  const handleCustomRangeChange = (range: CustomDateRange) => {
    setCustomRange(range);
    // 使用自訂範圍的天數重新載入
    const days = getCustomRangeDays(range);
    loadStats(days);
  };

  // 獲取顯示的天數文字
  const getDisplayDays = () => {
    if (timeRange === "custom" && customRange) {
      return getCustomRangeDays(customRange);
    }
    return getRangeDays(timeRange);
  };

  if (authLoading || loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-900 text-white">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-purple-500"></div>
      </main>
    );
  }

  if (error || !stats) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center bg-gray-900 text-white">
        <p className="text-red-400 mb-6 text-xl">{error || "無法載入資料"}</p>
        <button
          type="button"
          onClick={() => router.push("/dashboard/viewer")}
          className="px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
        >
          返回儀表板
        </button>
      </main>
    );
  }

  const { channel, dailyStats, summary } = stats;

  // 準備圖表資料
  const chartData = dailyStats.map((stat) => ({
    date: stat.date.slice(5), // MM-DD
    觀看時數: stat.watchHours,
    留言數: stat.messageCount,
    表情符號: stat.emoteCount,
  }));

  return (
    <main className="min-h-screen bg-gray-900 text-white">
      {/* Top Bar Navigation */}
      <div className="border-b border-gray-800 bg-gray-900/50">
        <div className="max-w-7xl mx-auto px-4 py-2 flex items-center gap-2 text-sm text-gray-500">
          <button
            onClick={() => router.push("/dashboard/viewer")}
            className="hover:text-purple-400 transition-colors"
          >
            觀眾儀表板
          </button>
          <span>/</span>
          <span className="text-gray-300">{channel.displayName}</span>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Channel Header */}
        <header className="mb-10 flex items-center gap-6">
          <div className="relative">
            <Image
              src={channel.avatarUrl}
              alt={channel.displayName}
              width={80}
              height={80}
              className="w-20 h-20 rounded-full border-4 border-gray-800 ring-2 ring-purple-500 object-cover shadow-xl"
              unoptimized
            />
            {channel.isLive && (
              <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-red-600 text-white text-[10px] font-bold rounded-full uppercase tracking-wider border border-gray-900">
                LIVE
              </span>
            )}
          </div>
          <div>
            <h1 className="text-3xl font-bold text-white mb-1 flex items-center gap-3">
              {channel.displayName}
              <span className="text-lg font-normal text-gray-500 font-mono">
                @{channel.name}
              </span>
            </h1>
            <p className="text-gray-400 text-sm">
              查看你在該頻道的觀看記錄與互動分析
            </p>
          </div>
        </header>

        {/* 時間範圍選擇器 */}
        <div className="mb-6 flex items-center justify-between flex-wrap gap-4">
          <TimeRangeSelector
            currentRange={timeRange}
            onRangeChange={handleRangeChange}
            onCustomRangeChange={handleCustomRangeChange}
            disabled={loading}
          />
          <span className="text-sm text-gray-500">
            {timeRange === "custom" && customRange ? (
              <>自訂範圍：{getDisplayDays()} 天</>
            ) : (
              <>顯示過去 {getDisplayDays()} 天的資料</>
            )}
          </span>
        </div>

        {/* 觀看統計摘要 (Story 2.2) */}
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-gray-200 mb-4 flex items-center gap-2">
            <span className="w-1.5 h-6 bg-blue-500 rounded-full"></span>
            觀看統計摘要
          </h2>

          <div className="grid gap-4 grid-cols-2 md:grid-cols-4 lg:grid-cols-7">
            {/* 1. 總觀看時數 */}
            <div className="bg-gray-800 rounded-lg shadow-lg border border-gray-700 p-4 relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                <svg
                  className="w-12 h-12 text-blue-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">
                總觀看時數
              </p>
              <p className="text-2xl font-bold text-blue-400">
                {summary.totalWatchHours}
              </p>
              <p className="text-xs text-blue-400/60 mt-1">小時</p>
            </div>

            {/* 2. 觀看次數 */}
            <div className="bg-gray-800 rounded-lg shadow-lg border border-gray-700 p-4 relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                <svg
                  className="w-12 h-12 text-cyan-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                  />
                </svg>
              </div>
              <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">
                觀看次數
              </p>
              <p className="text-2xl font-bold text-cyan-400">
                {summary.sessionCount}
              </p>
              <p className="text-xs text-cyan-400/60 mt-1">次</p>
            </div>

            {/* 3. 總留言數 */}
            <div className="bg-gray-800 rounded-lg shadow-lg border border-gray-700 p-4 relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                <svg
                  className="w-12 h-12 text-green-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                  />
                </svg>
              </div>
              <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">
                總留言數
              </p>
              <p className="text-2xl font-bold text-green-400">
                {summary.totalMessages}
              </p>
              <p className="text-xs text-green-400/60 mt-1">則</p>
            </div>

            {/* 4. 表情符號 */}
            <div className="bg-gray-800 rounded-lg shadow-lg border border-gray-700 p-4 relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                <svg
                  className="w-12 h-12 text-yellow-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">
                表情符號
              </p>
              <p className="text-2xl font-bold text-yellow-400">
                {summary.totalEmotes}
              </p>
              <p className="text-xs text-yellow-400/60 mt-1">個</p>
            </div>

            {/* 5. 日均觀看 */}
            <div className="bg-gray-800 rounded-lg shadow-lg border border-gray-700 p-4 relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                <svg
                  className="w-12 h-12 text-purple-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                  />
                </svg>
              </div>
              <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">
                日均觀看
              </p>
              <p className="text-2xl font-bold text-purple-400">
                {summary.averageWatchMinutesPerDay}
              </p>
              <p className="text-xs text-purple-400/60 mt-1">分鐘</p>
            </div>

            {/* 6. 首次觀看 */}
            <div className="bg-gray-800 rounded-lg shadow-lg border border-gray-700 p-4">
              <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">
                首次觀看
              </p>
              <p className="text-lg font-semibold text-gray-200">
                {summary.firstWatchDate
                  ? summary.firstWatchDate.slice(0, 10)
                  : "-"}
              </p>
            </div>

            {/* 7. 最後觀看 */}
            <div className="bg-gray-800 rounded-lg shadow-lg border border-gray-700 p-4">
              <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">
                最後觀看
              </p>
              <p className="text-lg font-semibold text-gray-200">
                {summary.lastWatchDate
                  ? summary.lastWatchDate.slice(0, 10)
                  : "-"}
              </p>
            </div>
          </div>
        </div>

        {/* 聊天與互動統計 (Story 2.3) */}
        {messageStats && (
          <div className="mb-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <h2 className="text-lg font-semibold text-gray-200 mb-4 flex items-center gap-2">
              <span className="w-1.5 h-6 bg-green-500 rounded-full"></span>
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

        {/* 觀看時數趨勢圖 (Story 2.2) */}
        <div className="bg-gray-800 rounded-lg shadow-lg border border-gray-700 p-6 mb-8">
          <h2 className="text-lg font-semibold mb-6 text-purple-200 border-l-4 border-blue-500 pl-3">
            觀看時數趨勢
            {timeRange === "all"
              ? "（全部資料）"
              : `（過去 ${getDisplayDays()} 天）`}
          </h2>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="#374151"
                  vertical={false}
                />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 12, fill: "#9CA3AF" }}
                  axisLine={{ stroke: "#4B5563" }}
                  tickLine={false}
                  dy={10}
                />
                <YAxis
                  tick={{ fontSize: 12, fill: "#9CA3AF" }}
                  axisLine={false}
                  tickLine={false}
                  dx={-10}
                  unit="h"
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#1F2937",
                    borderColor: "#374151",
                    borderRadius: "0.5rem",
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
            </ResponsiveContainer>
          </div>
        </div>

        {/* 未來功能預留區 */}
        <div className="mt-8 p-6 bg-gray-800/50 rounded-lg border-2 border-dashed border-gray-700 text-center">
          <h3 className="text-gray-400 font-medium mb-3">
            更多深度分析功能，即將登場
          </h3>
          <div className="flex flex-wrap justify-center gap-4 text-sm text-gray-500">
            <span className="px-3 py-1 bg-gray-800 rounded-full border border-gray-700">
              詳細觀看記錄
            </span>
            <span className="px-3 py-1 bg-gray-800 rounded-full border border-gray-700">
              詞彙雲分析
            </span>
            <span className="px-3 py-1 bg-gray-800 rounded-full border border-gray-700">
              訂閱里程碑
            </span>
            <span className="px-3 py-1 bg-gray-800 rounded-full border border-gray-700">
              忠誠度徽章
            </span>
          </div>
        </div>
      </div>
    </main>
  );
}
