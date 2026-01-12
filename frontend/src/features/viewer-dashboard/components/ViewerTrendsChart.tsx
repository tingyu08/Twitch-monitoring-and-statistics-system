"use client";

import { useTranslations } from "next-intl";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import type { ViewerTrendPoint } from "@/lib/api/viewer";

interface Props {
  data: ViewerTrendPoint[];
  loading?: boolean;
}

export function ViewerTrendsChart({ data, loading }: Props) {
  const t = useTranslations();

  if (loading) {
    return (
      <div className="theme-card p-6">
        <div className="h-[300px] flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-purple-600"></div>
        </div>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="theme-card p-6">
        <h3 className="text-lg font-semibold theme-text-primary mb-4">
          {t("charts.viewerTrends")}
        </h3>
        <div className="h-[200px] flex items-center justify-center">
          <p className="theme-text-muted">{t("charts.noViewerData")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="theme-card p-6">
      <h3 className="text-lg font-semibold theme-text-primary mb-4">
        {t("charts.viewerTrends")}
      </h3>
      <div className="h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
          >
            <XAxis
              dataKey="date"
              tick={{ fill: "#9ca3af", fontSize: 11 }}
              tickFormatter={(value) => value.slice(5)} // MM-DD
            />
            <YAxis tick={{ fill: "#9ca3af", fontSize: 11 }} width={40} />
            <Tooltip
              contentStyle={{
                backgroundColor: "#1f2937",
                borderColor: "#374151",
                color: "#fff",
                borderRadius: "8px",
              }}
              formatter={(value: number, name: string) => [
                value.toLocaleString(),
                name === "avgViewers"
                  ? t("charts.avgViewers")
                  : t("charts.peakViewers"),
              ]}
              labelFormatter={(label, payload) => {
                if (payload && payload[0]) {
                  return `${label} - ${payload[0].payload.title}`;
                }
                return label;
              }}
            />
            <Legend
              formatter={(value) =>
                value === "avgViewers"
                  ? t("charts.avgViewers")
                  : t("charts.peakViewers")
              }
            />
            <Line
              type="monotone"
              dataKey="avgViewers"
              stroke="#8b5cf6"
              strokeWidth={2}
              dot={{ fill: "#8b5cf6", r: 4 }}
              activeDot={{ r: 6 }}
            />
            <Line
              type="monotone"
              dataKey="peakViewers"
              stroke="#f43f5e"
              strokeWidth={2}
              dot={{ fill: "#f43f5e", r: 4 }}
              activeDot={{ r: 6 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="text-xs theme-text-muted mt-3 text-center">
        {t("charts.viewerTrendsDesc", { count: data.length })}
      </p>
    </div>
  );
}
