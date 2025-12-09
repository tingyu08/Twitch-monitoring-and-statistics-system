"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getMe, type StreamerInfo } from '@/lib/api/auth';
import { useAuthSession } from '@/features/auth/AuthContext';
import { StreamSummaryCards } from '@/features/streamer-dashboard/components/StreamSummaryCards';
import { TimeSeriesChart, HeatmapChart, ChartLoading, ChartError, ChartEmpty } from '@/features/streamer-dashboard/charts';
import { useTimeSeriesData, useHeatmapData, type ChartRange, type ChartGranularity } from '@/features/streamer-dashboard/hooks/useChartData';
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

  // Story 1.3: 使用 SWR hooks 獲取圖表資料
  const timeSeries = useTimeSeriesData(chartRange, granularity);
  const heatmap = useHeatmapData(chartRange);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const data = await getMe();
        setUser(data);
      } catch (err: any) {
        authLogger.error("Dashboard fetch error:", err);
        setError(err.message || '無法獲取資料');
        
        const errMsg = err.message?.toLowerCase() || '';
        if (errMsg.includes('unauthorized') || errMsg.includes('auth') || errMsg.includes('token')) {
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

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8">
      <div className="max-w-7xl mx-auto">
        <header className="mb-8 border-b border-gray-700 pb-4 flex justify-between items-center gap-4">
          <div className="flex items-center gap-4">
            {/* 使用正確的欄位名稱 avatarUrl */}
            {user?.avatarUrl && (
              <img
                src={user.avatarUrl}
                alt="Profile"
                className="w-14 h-14 rounded-full border-2 border-purple-500"
              />
            )}
            <div>
              <h1 className="text-3xl font-bold text-purple-400">實況主儀表板</h1>
              <p className="text-gray-400 mt-2">
                歡迎回來，{user?.displayName || '實況主'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={logout}
            className="px-4 py-2 rounded bg-gray-700 hover:bg-gray-600 text-sm text-white transition-colors"
          >
            登出
          </button>
        </header>

        {/* Story 1.2: 開台統計總覽 */}
        <div className="mb-8">
          <StreamSummaryCards />
        </div>

        {/* Story 1.3: 時間與頻率圖表 */}
        <div className="mb-8">
          <div className="bg-gray-800 p-4 sm:p-6 rounded-lg shadow-lg border border-gray-700">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
              <h2 className="text-lg sm:text-xl font-semibold text-purple-300">開台時間分析</h2>
              <div className="flex flex-wrap gap-2">
                {/* 時間範圍選擇 */}
                <select
                  id="chart-range"
                  name="chart-range"
                  value={chartRange}
                  onChange={(e) => setChartRange(e.target.value as '7d' | '30d' | '90d')}
                  className="px-3 py-1.5 bg-gray-700 border border-gray-600 rounded text-sm text-white"
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
              <TimeSeriesChart data={timeSeries.data} granularity={granularity} />
            )}
          </div>
        </div>

        {/* Story 1.3: 熱力圖 */}
        <div className="mb-8">
          <div className="bg-gray-800 p-4 sm:p-6 rounded-lg shadow-lg border border-gray-700">
            <h2 className="text-lg sm:text-xl font-semibold text-purple-300 mb-6">開台時段分布</h2>
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
              <HeatmapChart data={heatmap.data} />
            )}
          </div>
        </div>

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