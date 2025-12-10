'use client';

import React from 'react';
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

interface SubscriptionTrendChartProps {
  data: SubscriptionDataPoint[];
}

export function SubscriptionTrendChart({ data }: SubscriptionTrendChartProps) {
  // 將資料轉換為 Recharts 格式（只保留有資料的點）
  const chartData = data
    .filter((point) => point.subsTotal !== null) // 只顯示有資料的點
    .map((point) => ({
      date: point.date.split('-').slice(1).join('/'), // 轉換為 MM/DD 格式
      訂閱總數: point.subsTotal,
      淨變化: point.subsDelta,
    }));

  return (
    <div className="w-full">
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
            wrapperStyle={{ color: '#D1D5DB', paddingTop: '20px' }}
            iconType="line"
          />
          <Line
            type="monotone"
            dataKey="訂閱總數"
            stroke="#A78BFA"
            strokeWidth={2}
            dot={{ r: 4, fill: '#A78BFA' }}
            activeDot={{ r: 6 }}
            animationDuration={1500}
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
          />
        </LineChart>
      </ResponsiveContainer>
      <div className="mt-4 text-xs text-gray-400 text-center">
        <p>💡 提示：訂閱總數（紫色實線）顯示每日總訂閱數，淨變化（藍色虛線）顯示相較前一日的變化量</p>
      </div>
    </div>
  );
}
