'use client';

import React, { useMemo, useState, useCallback } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import type { SubscriptionDataPoint } from '@/lib/api/streamer';
import type { ChartRange } from '../hooks/useChartData';

interface SubscriptionTrendChartProps {
  data: SubscriptionDataPoint[];
  isEstimated?: boolean;
  range?: ChartRange;
  currentDataDays?: number;
}

export function SubscriptionTrendChart({ data, isEstimated = false, range, currentDataDays = 0 }: SubscriptionTrendChartProps) {
  const [visibleLines, setVisibleLines] = useState<Record<string, boolean>>({
    訂閱總數: true,
    淨變化: true,
  });

  // 將資料轉換為 Recharts 格式（只保留有資料的點）
  const chartData = useMemo(
    () =>
      data
        .filter((point) => point.subsTotal !== null) // 只顯示有資料的點
        .map((point) => ({
          date: point.date.split('-').slice(1).join('/'), // 轉換為 MM/DD 格式
          訂閱總數: point.subsTotal,
          淨變化: point.subsDelta,
        })),
    [data]
  );

  // 只在選擇 90d 且可用天數不足 90 天時顯示估算徽章
  const showEstimateBadge = range === '90d' && currentDataDays > 0 && currentDataDays < 90;

  // Recharts Legend onClick payload 結構: { value, id, type, color, payload, dataKey }
  const handleLegendClick = useCallback((e: any) => {
    const key = e?.dataKey || e?.value;
    if (!key || typeof key !== 'string') return;
    setVisibleLines((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  return (
    <div className="w-full">
      {/* 估算徽章放在圖表外層，避免跑版 */}
      {showEstimateBadge && (
        <div className="mb-2 flex justify-start">
          <span className="inline-flex items-center gap-1 px-2 py-1 bg-amber-900/40 border border-amber-500/60 rounded text-xs text-amber-100">
            <span role="img" aria-label="estimate">⚠️</span>
            <span>估算值（資料僅 {currentDataDays} 天）</span>
          </span>
        </div>
      )}
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <XAxis
            dataKey="date"
            stroke="#9CA3AF"
            tick={{ fill: '#9CA3AF', fontSize: 12 }}
          />
          <YAxis
            stroke="#9CA3AF"
            tick={{ fill: '#9CA3AF', fontSize: 12 }}
            label={{ value: '訂閱數', angle: -90, position: 'insideLeft', fill: '#9CA3AF' }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#1F2937',
              border: '1px solid #374151',
              borderRadius: '0.375rem',
              color: '#F3F4F6',
            }}
            labelStyle={{ color: '#D1D5DB' }}
            formatter={(value: number, name: string) => {
              if (name === '淨變化' && value > 0) {
                return [`+${value}`, name];
              }
              return [value, name];
            }}
          />
          <Legend
            wrapperStyle={{ color: '#D1D5DB', paddingTop: '12px' }}
            iconType="line"
            onClick={handleLegendClick}
            formatter={(value: string) => {
              const isHidden = !visibleLines[value];
              return (
                <span
                  style={{
                    cursor: 'pointer',
                    opacity: isHidden ? 0.4 : 1,
                    textDecoration: isHidden ? 'line-through' : 'none',
                  }}
                >
                  {value}
                </span>
              );
            }}
          />
          <Line
            type="monotone"
            dataKey="訂閱總數"
            stroke="#A78BFA"
            strokeWidth={2}
            dot={{ r: 4, fill: '#A78BFA' }}
            activeDot={{ r: 6 }}
            animationDuration={1500}
            hide={!visibleLines['訂閱總數']}
          />
          <Line
            type="monotone"
            dataKey="淨變化"
            stroke="#60A5FA"
            strokeWidth={2}
            dot={{ r: 3, fill: '#60A5FA' }}
            activeDot={{ r: 5 }}
            animationDuration={1500}
            strokeDasharray="5 5"
            hide={!visibleLines['淨變化']}
          />
        </LineChart>
      </ResponsiveContainer>
      <div className="mt-4 text-xs text-gray-400 text-center">
        <p>💡 提示：點擊圖例可顯示/隱藏對應線條。訂閱總數（紫色實線）顯示每日總訂閱數，淨變化（藍色虛線）顯示相較前一日的變化量</p>
      </div>
    </div>
  );
}
