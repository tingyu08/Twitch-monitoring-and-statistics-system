"use client";

import { useTranslations } from "next-intl";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { SafeResponsiveContainer } from "@/components/charts/SafeResponsiveContainer";

interface WatchTimeTrendChartProps {
  data: {
    date: string;
    watchHours: number;
  }[];
}

export function WatchTimeTrendChart({ data }: WatchTimeTrendChartProps) {
  const t = useTranslations();

  return (
    <div className="h-80">
      <SafeResponsiveContainer>
        <LineChart data={data}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="currentColor"
            className="text-purple-200 dark:text-white/10"
            vertical={false}
          />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 12, fill: "currentColor" }}
            stroke="currentColor"
            className="text-purple-600 dark:text-purple-300/70"
            axisLine={{
              stroke: "currentColor",
              className: "text-purple-200 dark:text-white/20",
            }}
            tickLine={false}
            dy={10}
          />
          <YAxis
            tick={{ fontSize: 12, fill: "currentColor" }}
            stroke="currentColor"
            className="text-purple-600 dark:text-purple-300/70"
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
            dataKey="watchHours"
            name={t("stats.watchHours")}
            stroke="#60A5FA"
            strokeWidth={3}
            dot={{ r: 4, fill: "#60A5FA", strokeWidth: 0 }}
            activeDot={{ r: 6, fill: "#BFDBFE" }}
          />
        </LineChart>
      </SafeResponsiveContainer>
    </div>
  );
}
