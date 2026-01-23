"use client";

import { useEffect, useState } from "react";
import { getStreamerGameStats, type GameStats } from "@/lib/api/streamer";
import { BarChart, Bar, XAxis, YAxis, Tooltip, Cell } from "recharts";
import { SafeResponsiveContainer } from "@/components/charts/SafeResponsiveContainer";
import { ChartLoading, ChartError, ChartEmpty } from "./ChartStates";
import { useTranslations } from "next-intl";

interface Props {
  range?: "7d" | "30d" | "90d";
  data?: GameStats[];
  loading?: boolean;
}

const COLORS = ["#8b5cf6", "#d946ef", "#f43f5e", "#ec4899", "#a855f7"];

export function GameStatsChart({
  range = "30d",
  data: externalData,
  loading: externalLoading,
}: Props) {
  const t = useTranslations("streamer.charts");
  const [internalData, setInternalData] = useState<GameStats[]>([]);
  const [internalLoading, setInternalLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    // 如果有傳外部數據，就不需要自己抓
    if (externalData) return;

    let mounted = true;
    setInternalLoading(true);
    getStreamerGameStats(range)
      .then((res) => {
        if (mounted) {
          setInternalData(res);
          setInternalLoading(false);
        }
      })
      .catch(() => {
        if (mounted) {
          setError(true);
          setInternalLoading(false);
        }
      });
    return () => {
      mounted = false;
    };
  }, [range, externalData]);

  const isLoading = externalData ? externalLoading : internalLoading;
  const displayData = externalData || internalData;

  if (isLoading) return <ChartLoading />;
  // Simple retry by callback
  if (error)
    return <ChartError error={t("noGameStats")} onRetry={() => window.location.reload()} />;
  if (displayData.length === 0) return <ChartEmpty description={t("noGameStatsDesc")} />;

  // Take top 5
  const chartData = displayData.slice(0, 5);

  return (
    <div className="theme-card p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold theme-text-primary">
          {t("gameStats", { defaultMessage: "Category Performance" })}
        </h3>
      </div>

      <div className="w-full h-[250px]">
        <SafeResponsiveContainer width="100%" height="100%">
          <BarChart
            layout="vertical"
            data={chartData}
            margin={{ top: 5, right: 30, left: 40, bottom: 5 }}
          >
            <XAxis type="number" hide />
            <YAxis
              type="category"
              dataKey="gameName"
              width={100}
              tick={{ fill: "#9ca3af", fontSize: 12 }}
              interval={0}
            />
            <Tooltip
              cursor={{ fill: "transparent" }}
              contentStyle={{
                backgroundColor: "#1f2937",
                borderColor: "#374151",
                color: "#e5e7eb", // gray-200 for title
                borderRadius: "8px",
              }}
              itemStyle={{ color: "#c084fc" }} // purple-400 for value text
              formatter={(value) => [`${value ?? 0} hrs`, t("totalHours")]}
            />
            <Bar dataKey="totalHours" radius={[0, 4, 4, 0]} barSize={20}>
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </SafeResponsiveContainer>
      </div>
    </div>
  );
}
