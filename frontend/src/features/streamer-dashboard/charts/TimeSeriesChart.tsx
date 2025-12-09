'use client';

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import type { TimeSeriesDataPoint } from '@/lib/api/streamer';

interface TimeSeriesChartProps {
  data: TimeSeriesDataPoint[];
  granularity: 'day' | 'week';
}

export function TimeSeriesChart({ data, granularity }: TimeSeriesChartProps) {
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  };

  const formatXAxis = (value: string) => {
    return formatDate(value);
  };

  return (
    <div className="w-full">
      <ResponsiveContainer width="100%" height={300} minHeight={300}>
        <LineChart
          data={data}
          margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <XAxis
            dataKey="date"
            tickFormatter={formatXAxis}
            stroke="#9ca3af"
            style={{ fontSize: '12px' }}
          />
          <YAxis
            stroke="#9ca3af"
            style={{ fontSize: '12px' }}
            label={{ value: '開台時數 (h)', angle: -90, position: 'insideLeft', style: { fill: '#9ca3af' } }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#1f2937',
              border: '1px solid #374151',
              borderRadius: '8px',
              color: '#f9fafb',
            }}
            labelFormatter={(value) => `日期: ${formatDate(value as string)}`}
            formatter={(value: number, name: string) => {
              if (name === 'totalHours') return [`${value} 小時`, '開台時數'];
              if (name === 'sessionCount') return [`${value} 場`, '開台場數'];
              return [value, name];
            }}
          />
          <Legend
            wrapperStyle={{ color: '#9ca3af' }}
            formatter={(value) => {
              if (value === 'totalHours') return '開台時數 (h)';
              if (value === 'sessionCount') return '開台場數';
              return value;
            }}
          />
          <Line
            type="monotone"
            dataKey="totalHours"
            stroke="#3b82f6"
            strokeWidth={2}
            dot={{ fill: '#3b82f6', r: 4 }}
            activeDot={{ r: 6 }}
          />
          <Line
            type="monotone"
            dataKey="sessionCount"
            stroke="#10b981"
            strokeWidth={2}
            dot={{ fill: '#10b981', r: 4 }}
            activeDot={{ r: 6 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
