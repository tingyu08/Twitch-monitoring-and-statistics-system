"use client";

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import type { TimeSeriesDataPoint } from "@/lib/api/streamer";
import { SafeResponsiveContainer } from "@/components/charts/SafeResponsiveContainer";
import { useTranslations } from "next-intl";

interface TimeSeriesChartProps {
  data: TimeSeriesDataPoint[];
  granularity: "day" | "week";
}

export function TimeSeriesChart({ data, granularity }: TimeSeriesChartProps) {
  const t = useTranslations("streamer.charts.timeSeries");

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  };

  const formatXAxis = (value: string) => {
    return formatDate(value);
  };

  // 為螢幕閱讀器生成資料摘要
  const generateDataSummary = () => {
    if (!data || data.length === 0) return t("summary").split(",")[0]; // Fallback or dedicated noData string
    const totalHours = data.reduce((sum, d) => sum + d.totalHours, 0);
    const totalSessions = data.reduce((sum, d) => sum + d.sessionCount, 0);
    return t("summary", {
      count: data.length,
      unit: granularity === "day" ? t("unitDay") : t("unitWeek"),
      hours: totalHours.toFixed(1),
      sessions: totalSessions,
    });
  };

  return (
    <figure
      className="w-full"
      role="img"
      aria-label={t("ariaLabel", { summary: generateDataSummary() })}
    >
      <SafeResponsiveContainer height={300}>
        <LineChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
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
              value: t("yAxis"),
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
            labelFormatter={(value) => t("tooltipDate", { date: formatDate(value as string) })}
            formatter={(value, name) => {
              const val = (value as number) ?? 0;
              if (name === "totalHours")
                return [t("tooltipHours", { value: val }), t("labelHours")];
              if (name === "sessionCount")
                return [t("tooltipSessions", { value: val }), t("labelSessions")];
              return [val, name];
            }}
            animationDuration={300}
            animationEasing="ease-in-out"
          />
          <Legend
            wrapperStyle={{ color: "#9ca3af" }}
            formatter={(value) => {
              if (value === "totalHours") return t("legendHours");
              if (value === "sessionCount") return t("legendSessions");
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
      <figcaption className="sr-only">{t("figcaption")}</figcaption>
    </figure>
  );
}
