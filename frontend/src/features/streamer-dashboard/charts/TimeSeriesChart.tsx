"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import type { TimeSeriesDataPoint } from "@/lib/api/streamer";
import { SafeResponsiveContainer } from "@/components/charts/SafeResponsiveContainer";

interface TimeSeriesChartProps {
  data: TimeSeriesDataPoint[];
  granularity: "day" | "week";
}

export function TimeSeriesChart({ data, granularity }: TimeSeriesChartProps) {
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  };

  const formatXAxis = (value: string) => {
    return formatDate(value);
  };

  // 為螢幕閱讀器生成資料摘要
  const generateDataSummary = () => {
    if (!data || data.length === 0) return "無資料";
    const totalHours = data.reduce((sum, d) => sum + d.totalHours, 0);
    const totalSessions = data.reduce((sum, d) => sum + d.sessionCount, 0);
    return `顯示 ${data.length} 個${
      granularity === "day" ? "日" : "週"
    }的資料，總開台時數 ${totalHours.toFixed(
      1
    )} 小時，總開台場數 ${totalSessions} 場`;
  };

  return (
    <figure
      className="w-full"
      role="img"
      aria-label={`開台時數與場數趨勢圖表：${generateDataSummary()}`}
    >
      <SafeResponsiveContainer height={300}>
        <LineChart
          data={data}
          margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <XAxis
            dataKey="date"
            tickFormatter={formatXAxis}
            stroke="#9ca3af"
            style={{ fontSize: "12px" }}
          />
          <YAxis
            stroke="#9ca3af"
            style={{ fontSize: "12px" }}
            label={{
              value: "開台時數 (h)",
              angle: -90,
              position: "insideLeft",
              style: { fill: "#9ca3af" },
            }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#1f2937",
              border: "1px solid #374151",
              borderRadius: "8px",
              color: "#f9fafb",
            }}
            labelFormatter={(value) => `日期: ${formatDate(value as string)}`}
            formatter={(value: number, name: string) => {
              if (name === "totalHours") return [`${value} 小時`, "開台時數"];
              if (name === "sessionCount") return [`${value} 場`, "開台場數"];
              return [value, name];
            }}
            animationDuration={300}
            animationEasing="ease-in-out"
          />
          <Legend
            wrapperStyle={{ color: "#9ca3af" }}
            formatter={(value) => {
              if (value === "totalHours") return "開台時數 (h)";
              if (value === "sessionCount") return "開台場數";
              return value;
            }}
          />
          <Line
            type="monotone"
            dataKey="totalHours"
            stroke="#3b82f6"
            strokeWidth={2}
            dot={{ fill: "#3b82f6", r: 4 }}
            activeDot={{ r: 6 }}
            animationDuration={1500}
            animationBegin={0}
            animationEasing="ease-in-out"
          />
          <Line
            type="monotone"
            dataKey="sessionCount"
            stroke="#10b981"
            strokeWidth={2}
            dot={{ fill: "#10b981", r: 4 }}
            activeDot={{ r: 6 }}
            animationDuration={1500}
            animationBegin={200}
            animationEasing="ease-in-out"
          />
        </LineChart>
      </SafeResponsiveContainer>
      <figcaption className="sr-only">
        顯示開台時數與開台場數隨時間變化的折線圖，藍色線條代表開台時數，綠色線條代表開台場數
      </figcaption>
    </figure>
  );
}
