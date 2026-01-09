"use client";

import React, { useMemo, useState, useCallback } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import type { SubscriptionDataPoint } from "@/lib/api/streamer";
import type { ChartRange } from "../hooks/useChartData";
import { SafeResponsiveContainer } from "@/components/charts/SafeResponsiveContainer";
import { useTranslations } from "next-intl";

interface SubscriptionTrendChartProps {
  data: SubscriptionDataPoint[];
  isEstimated?: boolean;
  range?: ChartRange;
  currentDataDays?: number;
}

export function SubscriptionTrendChart({
  data,
  isEstimated = false,
  range,
  currentDataDays = 0,
}: SubscriptionTrendChartProps) {
  const t = useTranslations("streamer.charts.subs");
  const [visibleLines, setVisibleLines] = useState<Record<string, boolean>>({
    subsTotal: true,
    subsDelta: true,
  });

  // 將資料轉換為 Recharts 格式（只保留有資料的點）
  const chartData = useMemo(
    () =>
      data
        .filter((point) => point.subsTotal !== null) // 只顯示有資料的點
        .map((point) => ({
          date: point.date.split("-").slice(1).join("/"), // 轉換為 MM/DD 格式
          subsTotal: point.subsTotal,
          subsDelta: point.subsDelta,
        })),
    [data]
  );

  // 只在選擇 90d 且可用天數不足 90 天時顯示估算徽章
  const showEstimateBadge =
    range === "90d" && currentDataDays > 0 && currentDataDays < 90;

  // Recharts Legend onClick payload 結構: { value, id, type, color, payload, dataKey }
  const handleLegendClick = useCallback((e: any) => {
    const key = e?.dataKey;
    if (!key || typeof key !== "string") return;
    setVisibleLines((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  return (
    <div className="w-full">
      {/* 估算徽章放在圖表外層，避免跑版 */}
      {showEstimateBadge && (
        <div className="mb-2 flex justify-start">
          <span className="inline-flex items-center gap-1 px-2 py-1 bg-amber-900/40 border border-amber-500/60 rounded text-xs text-amber-100">
            <span role="img" aria-label="estimate">
              ⚠️
            </span>
            <span>{t("estimate", { days: currentDataDays })}</span>
          </span>
        </div>
      )}
      <SafeResponsiveContainer height={300}>
        <LineChart
          data={chartData}
          margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <XAxis
            dataKey="date"
            stroke="#9CA3AF"
            tick={{ fill: "#9CA3AF", fontSize: 12 }}
          />
          <YAxis
            stroke="#9CA3AF"
            tick={{ fill: "#9CA3AF", fontSize: 12 }}
            label={{
              value: t("yAxis"),
              angle: -90,
              position: "insideLeft",
              fill: "#9CA3AF",
            }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#1F2937",
              border: "1px solid #374151",
              borderRadius: "0.375rem",
              color: "#F3F4F6",
            }}
            labelStyle={{ color: "#D1D5DB" }}
            formatter={(value: number, name: string) => {
              // name maps to Line's name prop, which is translated
              if (name === t("netChange") && value > 0) {
                return [`+${value}`, name];
              }
              return [value, name];
            }}
          />
          <Legend
            wrapperStyle={{ color: "#D1D5DB", paddingTop: "12px" }}
            iconType="line"
            onClick={handleLegendClick}
            formatter={(value: string, entry: any) => {
              // value matches Line name
              const dataKey = entry?.payload?.dataKey;
              const isHidden = dataKey ? !visibleLines[dataKey] : false;
              return (
                <span
                  style={{
                    cursor: "pointer",
                    opacity: isHidden ? 0.4 : 1,
                    textDecoration: isHidden ? "line-through" : "none",
                  }}
                >
                  {value}
                </span>
              );
            }}
          />
          <Line
            type="monotone"
            dataKey="subsTotal"
            name={t("total")}
            stroke="#A78BFA"
            strokeWidth={2}
            dot={{ r: 4, fill: "#A78BFA" }}
            activeDot={{ r: 6 }}
            animationDuration={1500}
            hide={!visibleLines["subsTotal"]}
          />
          <Line
            type="monotone"
            dataKey="subsDelta"
            name={t("netChange")}
            stroke="#60A5FA"
            strokeWidth={2}
            dot={{ r: 3, fill: "#60A5FA" }}
            activeDot={{ r: 5 }}
            animationDuration={1500}
            strokeDasharray="5 5"
            hide={!visibleLines["subsDelta"]}
          />
        </LineChart>
      </SafeResponsiveContainer>
      <div className="mt-4 text-xs text-gray-400 text-center">
        <p>💡 {t("tip")}</p>
      </div>
    </div>
  );
}
