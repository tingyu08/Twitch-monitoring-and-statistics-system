"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend } from "recharts";
import { SafeResponsiveContainer } from "@/components/charts/SafeResponsiveContainer";
import type { ViewerTrendPoint } from "@/lib/api/viewer";

/** 按天聚合後的資料點 */
export interface DailyViewerTrendPoint {
  /** YYYY-MM-DD */
  date: string;
  avgViewers: number;
  peakViewers: number;
  /** 當天所有直播 session（供點擊展開使用） */
  sessions: ViewerTrendPoint[];
}

/**
 * 將每場直播的資料點按天聚合：
 * - avgViewers = 各場加權平均（依 durationHours 加權）
 * - peakViewers = 當天最高值
 */
function aggregateByDay(data: ViewerTrendPoint[]): DailyViewerTrendPoint[] {
  const dayMap = new Map<string, ViewerTrendPoint[]>();

  for (const point of data) {
    // 從 ISO timestamp 取 YYYY-MM-DD
    const dayKey = point.date.slice(0, 10);
    const existing = dayMap.get(dayKey);
    if (existing) {
      existing.push(point);
    } else {
      dayMap.set(dayKey, [point]);
    }
  }

  const result: DailyViewerTrendPoint[] = [];

  for (const [dayKey, sessions] of dayMap) {
    let totalWeightedViewers = 0;
    let totalDuration = 0;
    let peakViewers = 0;

    for (const session of sessions) {
      const duration = session.durationHours || 0;
      totalWeightedViewers += session.avgViewers * duration;
      totalDuration += duration;
      peakViewers = Math.max(peakViewers, session.peakViewers);
    }

    result.push({
      date: dayKey,
      avgViewers: totalDuration > 0 ? Math.round(totalWeightedViewers / totalDuration) : 0,
      peakViewers,
      sessions,
    });
  }

  return result.sort((a, b) => a.date.localeCompare(b.date));
}

interface Props {
  data: ViewerTrendPoint[];
  loading?: boolean;
  /** 點擊某天的資料點，回傳該天所有直播 session */
  onDayClick?: (sessions: ViewerTrendPoint[], date: string) => void;
  /** @deprecated 請改用 onDayClick */
  onPointClick?: (point: ViewerTrendPoint) => void;
}

export function ViewerTrendsChart({ data, loading, onDayClick, onPointClick }: Props) {
  const t = useTranslations();

  const dailyData = useMemo(() => aggregateByDay(data || []), [data]);

  const handleDaySelect = (point: DailyViewerTrendPoint) => {
    if (onDayClick) {
      onDayClick(point.sessions, point.date);
    } else if (onPointClick && point.sessions.length > 0) {
      onPointClick(point.sessions[0]);
    }
  };

  const handleChartClick = (e: any) => {
    if (!e || !e.activePayload || !e.activePayload[0]) return;
    handleDaySelect(e.activePayload[0].payload as DailyViewerTrendPoint);
  };

  const handleDotClick = (_e: any, payload: any) => {
    if (payload?.payload) {
      handleDaySelect(payload.payload as DailyViewerTrendPoint);
    }
  };

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
      <h3 className="text-lg font-semibold theme-text-primary mb-4 flex items-center gap-2">
        {t("charts.viewerTrends")}
        <span className="text-xs font-normal theme-text-secondary bg-gray-100 dark:bg-white/10 px-2 py-0.5 rounded-full">
          {t("charts.clickForDetails")}
        </span>
      </h3>
      <div className="h-[300px]">
        <SafeResponsiveContainer width="100%" height="100%">
          <LineChart
            data={dailyData}
            margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
            onClick={handleChartClick}
            className={onDayClick || onPointClick ? "cursor-pointer" : ""}
          >
            <XAxis
              dataKey="date"
              tick={{ fill: "#9ca3af", fontSize: 11 }}
              tickFormatter={(value: string) => value.slice(5)} // MM-DD
            />
            <YAxis tick={{ fill: "#9ca3af", fontSize: 11 }} width={40} />
            <Tooltip
              contentStyle={{
                backgroundColor: "#1f2937",
                borderColor: "#374151",
                color: "#fff",
                borderRadius: "8px",
              }}
              wrapperStyle={{ pointerEvents: "none" }}
              formatter={(value, name) => [
                ((value as number) ?? 0).toLocaleString(),
                name === "avgViewers" ? t("charts.avgViewers") : t("charts.peakViewers"),
              ]}
              labelFormatter={(label, payload) => {
                if (payload && payload[0]) {
                  const point = payload[0].payload as DailyViewerTrendPoint;
                  const sessionCount = point.sessions.length;
                  if (sessionCount === 1) {
                    return `${label} - ${point.sessions[0].title}`;
                  }
                  return `${label} (${t("charts.sessionCount", { count: sessionCount })})`;
                }
                return label;
              }}
            />
            <Legend
              formatter={(value) =>
                value === "avgViewers" ? t("charts.avgViewers") : t("charts.peakViewers")
              }
            />
            <Line
              type="monotone"
              dataKey="avgViewers"
              stroke="#8b5cf6"
              strokeWidth={2}
              dot={{ fill: "#8b5cf6", r: 4 }}
              activeDot={{
                r: 8,
                stroke: "#fff",
                strokeWidth: 2,
                cursor: "pointer",
                onClick: handleDotClick,
              }}
            />
            <Line
              type="monotone"
              dataKey="peakViewers"
              stroke="#f43f5e"
              strokeWidth={2}
              dot={{ fill: "#f43f5e", r: 4 }}
              activeDot={{
                r: 8,
                stroke: "#fff",
                strokeWidth: 2,
                cursor: "pointer",
                onClick: handleDotClick,
              }}
            />
          </LineChart>
        </SafeResponsiveContainer>
      </div>
      <p className="text-xs theme-text-muted mt-3 text-center">
        {t("charts.viewerTrendsDesc", { count: data.length })}
      </p>
    </div>
  );
}
