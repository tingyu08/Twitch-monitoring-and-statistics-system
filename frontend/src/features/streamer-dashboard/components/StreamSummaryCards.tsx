"use client";

import { useState, useEffect } from 'react';
import { getStreamerSummary, type StreamerSummary } from '@/lib/api/streamer';
import { StatCard } from './StatCard';
import { DateRangePicker } from './DateRangePicker';
import { apiLogger } from '@/lib/logger';

type DateRange = '7d' | '30d' | '90d';

export function StreamSummaryCards() {
  const [range, setRange] = useState<DateRange>('30d');
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
        apiLogger.error('Failed to fetch summary:', err);
        setError(err instanceof Error ? err.message : '載入統計資料失敗');
      } finally {
        setLoading(false);
      }
    };

    fetchSummary();
  }, [range]);

  if (error) {
    return (
      <div className="bg-red-900/20 border border-red-700 rounded-lg p-6">
        <p className="text-red-400">⚠️ {error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 時間範圍選擇器 */}
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-purple-300">開台統計總覽</h2>
        <DateRangePicker selectedRange={range} onRangeChange={setRange} />
      </div>

      {/* Summary Cards */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="bg-gray-800 p-6 rounded-lg shadow-lg border border-gray-700 animate-pulse"
            >
              <div className="h-4 bg-gray-700 rounded w-24 mb-4"></div>
              <div className="h-10 bg-gray-700 rounded w-32 mb-2"></div>
              <div className="h-3 bg-gray-700 rounded w-16"></div>
            </div>
          ))}
        </div>
      ) : summary ? (
        // 檢查是否所有值都是 0（無資料狀態）
        summary.totalStreamSessions === 0 &&
        summary.totalStreamHours === 0 &&
        summary.avgStreamDurationMinutes === 0 ? (
          <div className="bg-gray-800 p-12 rounded-lg shadow-lg border border-gray-700 text-center">
            <p className="text-gray-400 text-lg">暫無統計資料</p>
            <p className="text-gray-500 text-sm mt-2">開始直播後即可查看統計數據</p>
            {summary.isEstimated && (
              <p className="text-yellow-500 text-xs mt-4 px-3 py-1 bg-yellow-900/20 border border-yellow-700 rounded inline-block">
                ⚠️ 資料可能尚未同步完成
              </p>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <StatCard
              title="總開台時數"
              value={summary.totalStreamHours}
              unit="小時"
              subtitle={`在過去 ${range === '7d' ? '7' : range === '30d' ? '30' : '90'} 天內`}
              isEstimated={summary.isEstimated}
            />
            <StatCard
              title="總開台場數"
              value={summary.totalStreamSessions}
              unit="場"
              subtitle={`在過去 ${range === '7d' ? '7' : range === '30d' ? '30' : '90'} 天內`}
              isEstimated={summary.isEstimated}
            />
            <StatCard
              title="平均單場時長"
              value={summary.avgStreamDurationMinutes}
              unit="分鐘"
              subtitle="每場平均開台時間"
              isEstimated={summary.isEstimated}
            />
          </div>
        )
      ) : (
        <div className="bg-gray-800 p-12 rounded-lg shadow-lg border border-gray-700 text-center">
          <p className="text-gray-400 text-lg">暫無統計資料</p>
          <p className="text-gray-500 text-sm mt-2">開始直播後即可查看統計數據</p>
        </div>
      )}
    </div>
  );
}
