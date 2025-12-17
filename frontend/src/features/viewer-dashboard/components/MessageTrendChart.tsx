"use client";

import { MessageDailyStat } from "@/lib/api/viewer";
import {
  Bar,
  BarChart,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
} from "recharts";
import { SafeResponsiveContainer } from "@/components/charts/SafeResponsiveContainer";

interface MessageTrendChartProps {
  data: MessageDailyStat[];
  height?: number;
}

export function MessageTrendChart({
  data,
  height = 350,
}: MessageTrendChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="flex h-[350px] w-full items-center justify-center rounded-xl border bg-card text-card-foreground shadow p-4">
        <p className="text-muted-foreground">無足夠數據顯示趨勢圖</p>
      </div>
    );
  }

  return (
    <div
      className="rounded-xl border bg-card text-card-foreground shadow"
      aria-label="Message Trend Chart"
    >
      <div className="p-6 flex flex-col space-y-1.5">
        <h3 className="font-semibold leading-none tracking-tight">
          每日互動趨勢
        </h3>
        <p className="text-sm text-muted-foreground">
          過去一段時間的留言與互動分佈
        </p>
      </div>
      <div className="p-6 pt-0 pl-0">
        <SafeResponsiveContainer height={height}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="date"
              stroke="#888888"
              fontSize={12}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value) => {
                const date = new Date(value);
                return `${date.getMonth() + 1}/${date.getDate()}`;
              }}
            />
            <YAxis
              stroke="#888888"
              fontSize={12}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value) => `${value}`}
            />
            <Tooltip
              contentStyle={{
                borderRadius: "8px",
                border: "1px solid #e2e8f0",
              }}
              labelStyle={{ color: "#334155", fontWeight: "bold" }}
            />
            <Legend />
            <Bar
              dataKey="chatMessages"
              name="聊天"
              stackId="a"
              fill="#3b82f6"
              radius={[0, 0, 4, 4]}
            />
            <Bar
              dataKey="subscriptions"
              name="訂閱"
              stackId="a"
              fill="#8b5cf6"
            />
            <Bar
              dataKey="cheers"
              name="小奇點"
              stackId="a"
              fill="#eab308"
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </SafeResponsiveContainer>
      </div>
    </div>
  );
}
