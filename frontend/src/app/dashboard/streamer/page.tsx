"use client";

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { getMe, type StreamerInfo } from '@/lib/api/auth';
import { useAuthSession } from '@/features/auth/AuthContext';
import { StreamSummaryCards } from '@/features/streamer-dashboard/components/StreamSummaryCards';
import { DisplayPreferences } from '@/features/streamer-dashboard/components/DisplayPreferences';
import {
  TimeSeriesChart,
  HeatmapChart,
  SubscriptionTrendChart,
  ChartLoading,
  ChartError,
  ChartEmpty,
  ChartDataLimitedBanner,
} from '@/features/streamer-dashboard/charts';
import { useTimeSeriesData, useHeatmapData, useSubscriptionTrendData, type ChartRange, type ChartGranularity } from '@/features/streamer-dashboard/hooks/useChartData';
import { useUiPreferences } from '@/features/streamer-dashboard/hooks/useUiPreferences';
import { authLogger } from '@/lib/logger';

export default function StreamerDashboard() {
  const [user, setUser] = useState<StreamerInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const router = useRouter();
  const { logout } = useAuthSession();

  // Story 1.3: 圖表範圍與粒度狀態
  const [chartRange, setChartRange] = useState<ChartRange>('30d');
  const [granularity, setGranularity] = useState<ChartGranularity>('day');

  // Story 1.4: 訂閱趨勢範圍狀態
  const [subsChartRange, setSubsChartRange] = useState<ChartRange>('30d');

  // Story 1.3: 使用 SWR hooks 獲取圖表資料
  const timeSeries = useTimeSeriesData(chartRange, granularity);
  const heatmap = useHeatmapData(chartRange);

  // Story 1.4: 使用 SWR hooks 獲取訂閱趨勢資料
  const subscriptionTrend = useSubscriptionTrendData(subsChartRange);

  // Story 1.5: UI 顯示偏好
  const { preferences, togglePreference, showAll, resetToDefault, isLoaded, visibleCount } = useUiPreferences();

  const visibleSectionCount = useMemo(() => {
    if (typeof visibleCount === 'number') return visibleCount;
    const prefs = preferences ?? {};
    return ['showSummaryCards', 'showTimeSeriesChart', 'showHeatmapChart', 'showSubscriptionChart'].reduce(
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
        setUser(data);
      } catch (err: unknown) {
        authLogger.error("Dashboard fetch error:", err);
        const errorMessage = err instanceof Error ? err.message : '無法獲取資料';
        setError(errorMessage);

        // 檢查是否為認證錯誤 (包含 status 401)
        const errMsg = errorMessage.toLowerCase();
        if (errMsg.includes('unauthorized') || 
            errMsg.includes('auth') || 
            errMsg.includes('token') ||
            errMsg.includes('status 401')) {
            setTimeout(() => router.push('/'), 2000);
        }
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [router]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-purple-500"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center justify-center p-4">
        <p className="text-red-400 mb-4 text-xl">無法載入資料</p>
        <p className="text-gray-400 mb-4">{error}</p>
        <p className="text-gray-500 text-sm">正在返回首頁...</p>
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-purple-500"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8" data-testid="dashboard-container">
      <div className="max-w-7xl mx-auto">
        <header className="mb-8 border-b border-gray-700 pb-4 flex justify-between items-center gap-4" data-testid="dashboard-header">
          <div className="flex items-center gap-4">
            {/* 使用正確的欄位名稱 avatarUrl */}
            {user?.avatarUrl && (
              <Image
                src={user.avatarUrl}
                alt="Profile"
                width={56}
                height={56}
                className="rounded-full border-2 border-purple-500"
                data-testid="user-avatar"
                unoptimized
              />
            )}
            <div>
              <h1 className="text-3xl font-bold text-purple-400" data-testid="dashboard-title">實況主儀表板</h1>
              <p className="text-gray-400 mt-2" data-testid="user-greeting">
                歡迎回來，{user?.displayName || '實況主'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={logout}
            className="px-4 py-2 rounded bg-gray-700 hover:bg-gray-600 text-sm text-white transition-colors"
            data-testid="logout-button"
          >
            登出
          </button>
        </header>

        <div className="mb-6 flex justify-end">
          <DisplayPreferences preferences={uiPrefs} onToggle={togglePreference} compact />
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
            <div className="bg-gray-800 p-4 sm:p-6 rounded-lg shadow-lg border border-gray-700">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
                <h2 className="text-lg sm:text-xl font-semibold text-purple-300" data-testid="timeseries-title">開台時間分析</h2>
                <div className="flex flex-wrap gap-2">
                  {/* 時間範圍選擇 */}
                  <select
                    id="chart-range"
                    name="chart-range"
                    value={chartRange}
                    onChange={(e) => setChartRange(e.target.value as '7d' | '30d' | '90d')}
                    className="px-3 py-1.5 bg-gray-700 border border-gray-600 rounded text-sm text-white"
                    data-testid="chart-range-select"
                  >
                    <option value="7d">最近 7 天</option>
                    <option value="30d">最近 30 天</option>
                    <option value="90d">最近 90 天</option>
                  </select>
                  {/* 粒度選擇 */}
                  <select
                    id="chart-granularity"
                    name="chart-granularity"
                    value={granularity}
                    onChange={(e) => setGranularity(e.target.value as 'day' | 'week')}
                    className="px-3 py-1.5 bg-gray-700 border border-gray-600 rounded text-sm text-white"
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
                <ChartError error={timeSeries.error} onRetry={timeSeries.refresh} />
              ) : timeSeries.data.length === 0 ? (
                <ChartEmpty
                  emoji="📊"
                  title="暫無開台資料"
                  description={`在選定的 ${chartRange === '7d' ? '7天' : chartRange === '30d' ? '30天' : '90天'} 時間範圍內沒有開台記錄`}
                  hint="試試切換其他時間範圍"
                />
              ) : (
                <div data-testid="timeseries-chart">
                  <TimeSeriesChart data={timeSeries.data} granularity={granularity} />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Story 1.3: 熱力圖 */}
        {uiPrefs.showHeatmapChart && (
          <div className="mb-8" data-testid="heatmap-section">
            <div className="bg-gray-800 p-4 sm:p-6 rounded-lg shadow-lg border border-gray-700">
              <h2 className="text-lg sm:text-xl font-semibold text-purple-300 mb-6" data-testid="heatmap-title">開台時段分布</h2>
              {heatmap.isLoading ? (
                <ChartLoading message="載入熱力圖資料中..." />
              ) : heatmap.error ? (
                <ChartError error={heatmap.error} onRetry={heatmap.refresh} />
              ) : heatmap.data.length === 0 ? (
                <ChartEmpty
                  emoji="🔥"
                  title="暫無時段資料"
                  description={`在選定的 ${chartRange === '7d' ? '7天' : chartRange === '30d' ? '30天' : '90天'} 時間範圍內沒有開台記錄`}
                  hint="試試切換其他時間範圍"
                />
              ) : (
                <div data-testid="heatmap-chart">
                  <HeatmapChart data={heatmap.data} maxValue={heatmap.maxValue} />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Story 1.4: 訂閱趨勢 */}
        {uiPrefs.showSubscriptionChart && (
          <div className="mb-8" data-testid="subscription-section">
            <div className="bg-gray-800 p-4 sm:p-6 rounded-lg shadow-lg border border-gray-700">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
                <h2 className="text-lg sm:text-xl font-semibold text-purple-300">
                  訂閱數趨勢
                </h2>
                <select
                  id="subs-chart-range"
                  name="subs-chart-range"
                  value={subsChartRange}
                  onChange={(e) => setSubsChartRange(e.target.value as ChartRange)}
                  className="px-3 py-1.5 bg-gray-700 border border-gray-600 rounded text-sm text-white"
                >
                  <option value="7d">最近 7 天</option>
                  <option value="30d">最近 30 天</option>
                  <option value="90d">最近 90 天</option>
                </select>
              </div>

              {/* Show banner if insufficient data */}
              {subscriptionTrend.currentDataDays < subscriptionTrend.minDataDays && subscriptionTrend.currentDataDays > 0 && (
                <ChartDataLimitedBanner
                  currentDays={subscriptionTrend.currentDataDays}
                  minDays={subscriptionTrend.minDataDays}
                />
              )}

              {subscriptionTrend.isLoading ? (
                <ChartLoading message="載入訂閱趨勢資料中..." />
              ) : subscriptionTrend.error ? (
                <ChartError error={subscriptionTrend.error} onRetry={subscriptionTrend.refresh} />
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
          <div className="mb-8 p-6 rounded-lg border border-dashed border-gray-700 bg-gray-800/60 text-center text-gray-300">
            所有圖表都被隱藏，請在「顯示偏好」中開啟想要的區塊。
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* 基本資料卡片 */}
          <div className="bg-gray-800 p-6 rounded-lg shadow-lg border border-gray-700">
            <h2 className="text-xl font-semibold mb-4 text-purple-300">帳戶資訊</h2>
            <div className="space-y-3">
              <div className="flex justify-between border-b border-gray-700 pb-2">
                <span className="text-gray-400">顯示名稱</span>
                <span>{user?.displayName}</span>
              </div>
              <div className="flex justify-between border-b border-gray-700 pb-2">
                <span className="text-gray-400">Twitch ID</span>
                <span className="text-xs font-mono text-gray-500">{user?.twitchUserId}</span>
              </div>
              <div className="flex justify-between border-b border-gray-700 pb-2">
                <span className="text-gray-400">系統 ID</span>
                <span className="text-xs font-mono text-gray-500">{user?.streamerId}</span>
              </div>
              <div className="flex justify-between border-b border-gray-700 pb-2">
                <span className="text-gray-400">頻道連結</span>
                <a href={user?.channelUrl} target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:text-purple-300 text-sm truncate max-w-[200px]">
                  {user?.channelUrl}
                </a>
              </div>
            </div>
          </div>

          {/* 功能區塊 */}
          <div className="bg-gray-800 p-6 rounded-lg shadow-lg border border-gray-700">
            <h2 className="text-xl font-semibold mb-4 text-purple-300">快速功能</h2>
            <div className="space-y-3">
              <button className="w-full bg-purple-600 hover:bg-purple-700 text-white py-2 px-4 rounded transition duration-200">
                管理實況設定
              </button>
              <button className="w-full bg-gray-700 hover:bg-gray-600 text-white py-2 px-4 rounded transition duration-200">
                查看收益分析
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}