"use client";

import { useEffect, useState } from "react";
import { getStreamerGameStats, type GameStats } from "@/lib/api/streamer";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { ChartLoading, ChartError, ChartEmpty } from "./ChartStates";
import { useTranslations } from "next-intl";

interface Props {
  range: "7d" | "30d" | "90d";
}

const COLORS = ["#8b5cf6", "#d946ef", "#f43f5e", "#ec4899", "#a855f7"];

export function GameStatsChart({ range }: Props) {
  const t = useTranslations("streamer.charts");
  const [data, setData] = useState<GameStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    getStreamerGameStats(range)
      .then((res) => {
        if (mounted) {
          setData(res);
          setLoading(false);
        }
      })
      .catch(() => {
        if (mounted) {
          setError(true);
          setLoading(false);
        }
      });
    return () => {
      mounted = false;
    };
  }, [range]);

  if (loading) return <ChartLoading />;
  // Simple retry by callback
  if (error)
    return (
      <ChartError
        error="Unable to load game statistics"
        onRetry={() => window.location.reload()}
      />
    );
  if (data.length === 0)
    return (
      <ChartEmpty description="No game statistics available for the selected range." />
    );

  // Take top 5
  const chartData = data.slice(0, 5);

  return (
    <div className="w-full h-full bg-white dark:bg-[#1a1b26] rounded-2xl p-6 shadow-sm border border-gray-100 dark:border-gray-800">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold theme-text-primary">
          {t("gameStats", { defaultMessage: "Category Performance" })}
        </h3>
      </div>

      <div className="w-full h-[250px]">
        <ResponsiveContainer width="100%" height="100%">
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
                color: "#fff",
                borderRadius: "8px",
              }}
              formatter={(value: number) => [`${value} hrs`, "Total Hours"]}
            />
            <Bar dataKey="totalHours" radius={[0, 4, 4, 0]} barSize={20}>
              {chartData.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={COLORS[index % COLORS.length]}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
