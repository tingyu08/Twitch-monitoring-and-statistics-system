"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { SafeResponsiveContainer } from "@/components/charts/SafeResponsiveContainer";
import { Loader2, TrendingUp, Users, DollarSign } from "lucide-react";

interface SubscriptionData {
  date: string;
  tier1Count: number;
  tier2Count: number;
  tier3Count: number;
  totalSubscribers: number;
  estimatedRevenue: number;
}

interface SubscriptionStatsProps {
  days?: number;
}

export function SubscriptionStats({ days = 30 }: SubscriptionStatsProps) {
  const t = useTranslations("streamer.revenue");
  const [data, setData] = useState<SubscriptionData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const apiBaseUrl =
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    (process.env.NODE_ENV === "production"
      ? "https://twitch-monitoring-and-statistics-system.onrender.com"
      : "http://localhost:4000");

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const res = await fetch(`${apiBaseUrl}/api/streamer/revenue/subscriptions?days=${days}`, {
          credentials: "include",
        });
        if (!res.ok) throw new Error("Failed to fetch");
        const json = await res.json();
        setData(json);
      } catch {
        setError("Failed to load subscription data");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [apiBaseUrl, days]);

  // 計算摘要統計
  const latestData = data[data.length - 1];
  const firstData = data[0];
  const growthRate =
    latestData && firstData && firstData.totalSubscribers > 0
      ? (
          ((latestData.totalSubscribers - firstData.totalSubscribers) /
            firstData.totalSubscribers) *
          100
        ).toFixed(1)
      : "0";

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 text-purple-400 animate-spin" />
      </div>
    );
  }

  if (error || data.length === 0) {
    return (
      <div className="text-center py-12 text-gray-400">
        <Users className="w-12 h-12 mx-auto mb-4 opacity-50" />
        <p>{t("noSubData")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 摘要卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700/50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-500/20 rounded-lg">
              <Users className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <p className="text-sm text-gray-400">{t("totalSubs")}</p>
              <p className="text-2xl font-bold text-white">{latestData?.totalSubscribers || 0}</p>
            </div>
          </div>
        </div>

        <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700/50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-500/20 rounded-lg">
              <TrendingUp className="w-5 h-5 text-green-400" />
            </div>
            <div>
              <p className="text-sm text-gray-400">{t("growth")}</p>
              <p
                className={`text-2xl font-bold ${
                  Number(growthRate) >= 0 ? "text-green-400" : "text-red-400"
                }`}
              >
                {Number(growthRate) >= 0 ? "+" : ""}
                {growthRate}%
              </p>
            </div>
          </div>
        </div>

        <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700/50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-yellow-500/20 rounded-lg">
              <DollarSign className="w-5 h-5 text-yellow-400" />
            </div>
            <div>
              <p className="text-sm text-gray-400">{t("estRevenue")}</p>
              <p className="text-2xl font-bold text-white">
                ${latestData?.estimatedRevenue?.toFixed(2) || "0.00"}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* 層級分佈堆疊圖 */}
      <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700/50">
        <h3 className="text-lg font-semibold text-white mb-4">{t("tierDistribution")}</h3>
        <div className="h-[300px]">
          <SafeResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis
                dataKey="date"
                stroke="#9CA3AF"
                tick={{ fill: "#9CA3AF", fontSize: 12 }}
                tickFormatter={(value) => value.slice(5)} // MM-DD
              />
              <YAxis stroke="#9CA3AF" tick={{ fill: "#9CA3AF", fontSize: 12 }} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#1F2937",
                  border: "1px solid #374151",
                  borderRadius: "8px",
                }}
                labelStyle={{ color: "#E5E7EB" }}
              />
              <Legend />
              <Bar dataKey="tier1Count" name="Tier 1" stackId="a" fill="#8B5CF6" />
              <Bar dataKey="tier2Count" name="Tier 2" stackId="a" fill="#6366F1" />
              <Bar dataKey="tier3Count" name="Tier 3" stackId="a" fill="#4F46E5" />
            </BarChart>
          </SafeResponsiveContainer>
        </div>
      </div>

      {/* 注意事項 */}
      <p className="text-xs text-gray-500 text-center">{t("revenueDisclaimer")}</p>
    </div>
  );
}
