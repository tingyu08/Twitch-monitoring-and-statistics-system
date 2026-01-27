"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { PieChart, Pie, Cell, Tooltip, Legend } from "recharts";
import { SafeResponsiveContainer } from "@/components/charts/SafeResponsiveContainer";
import {
  Loader2,
  DollarSign,
  Users,
  Zap,
  TrendingUp,
  AlertCircle,
} from "lucide-react";

interface RevenueOverviewData {
  subscriptions: {
    current: number;
    estimatedMonthlyRevenue: number;
    tier1: number;
    tier2: number;
    tier3: number;
  };
  bits: {
    totalBits: number;
    estimatedRevenue: number;
    eventCount: number;
  };
  totalEstimatedRevenue: number;
}

const COLORS = ["#8B5CF6", "#F97316"]; // Purple for subs, Orange for bits

export function RevenueOverview() {
  const t = useTranslations("streamer.revenue");
  const [data, setData] = useState<RevenueOverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // P1 Fix: 使用 AbortController 來處理清理和避免競態條件
    const abortController = new AbortController();

    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        // 使用相對路徑，讓 Next.js rewrites 處理代理到後端
        const res = await fetch("/api/streamer/revenue/overview", {
          credentials: "include",
          signal: abortController.signal,
        });
        if (!res.ok) throw new Error("Failed to fetch");
        const json = await res.json();

        // P1 Fix: 只在未被取消時更新狀態
        if (!abortController.signal.aborted) {
          setData(json);
        }
      } catch (err) {
        // P1 Fix: 忽略取消的請求錯誤
        if (err instanceof Error && err.name === "AbortError") {
          return;
        }
        if (!abortController.signal.aborted) {
          setError("Failed to load revenue overview");
        }
      } finally {
        if (!abortController.signal.aborted) {
          setLoading(false);
        }
      }
    };

    fetchData();

    // P1 Fix: cleanup function
    return () => {
      abortController.abort();
    };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 text-purple-400 animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="text-center py-12 text-gray-400">
        <AlertCircle className="w-12 h-12 mx-auto mb-4 opacity-50" />
        <p>{error || t("noData")}</p>
      </div>
    );
  }

  // 計算餅圖資料
  const pieData = [
    {
      name: t("subscriptions"),
      value: data.subscriptions.estimatedMonthlyRevenue,
      color: COLORS[0],
    },
    {
      name: t("bits"),
      value: data.bits.estimatedRevenue,
      color: COLORS[1],
    },
  ].filter((item) => item.value > 0);

  // 計算百分比
  const totalRevenue = data.totalEstimatedRevenue || 1;
  const subPercentage = (
    (data.subscriptions.estimatedMonthlyRevenue / totalRevenue) *
    100
  ).toFixed(1);
  const bitsPercentage = (
    (data.bits.estimatedRevenue / totalRevenue) *
    100
  ).toFixed(1);

  return (
    <div className="space-y-6">
      {/* 總收益大卡片 */}
      <div className="bg-gradient-to-br from-purple-600/30 to-green-600/20 rounded-2xl p-6 border border-purple-500/30">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-3 bg-white/10 rounded-xl">
            <DollarSign className="w-7 h-7 text-green-400" />
          </div>
          <div>
            <p className="text-sm text-gray-400">{t("totalEstRevenue")}</p>
            <p className="text-4xl font-bold text-white">
              ${data.totalEstimatedRevenue.toFixed(2)}
            </p>
          </div>
        </div>
        <p className="text-xs text-gray-500 mt-4">{t("revenueDisclaimer")}</p>
      </div>

      {/* 收益來源卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 訂閱收益 */}
        <div className="bg-gray-800/50 rounded-xl p-5 border border-gray-700/50">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-500/20 rounded-lg">
                <Users className="w-5 h-5 text-purple-400" />
              </div>
              <h3 className="text-white font-semibold">{t("subscriptions")}</h3>
            </div>
            <span className="text-sm text-gray-400">{subPercentage}%</span>
          </div>
          <p className="text-3xl font-bold text-purple-400 mb-3">
            ${data.subscriptions.estimatedMonthlyRevenue.toFixed(2)}
          </p>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between text-gray-400">
              <span>{t("totalSubs")}</span>
              <span className="text-white">{data.subscriptions.current}</span>
            </div>
            <div className="flex justify-between text-gray-400">
              <span>Tier 1</span>
              <span className="text-white">{data.subscriptions.tier1}</span>
            </div>
            <div className="flex justify-between text-gray-400">
              <span>Tier 2</span>
              <span className="text-white">{data.subscriptions.tier2}</span>
            </div>
            <div className="flex justify-between text-gray-400">
              <span>Tier 3</span>
              <span className="text-white">{data.subscriptions.tier3}</span>
            </div>
          </div>
        </div>

        {/* Bits 收益 */}
        <div className="bg-gray-800/50 rounded-xl p-5 border border-gray-700/50">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-orange-500/20 rounded-lg">
                <Zap className="w-5 h-5 text-orange-400" />
              </div>
              <h3 className="text-white font-semibold">{t("bits")}</h3>
            </div>
            <span className="text-sm text-gray-400">{bitsPercentage}%</span>
          </div>
          <p className="text-3xl font-bold text-orange-400 mb-3">
            ${data.bits.estimatedRevenue.toFixed(2)}
          </p>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between text-gray-400">
              <span>{t("totalBits")}</span>
              <span className="text-white">
                {data.bits.totalBits.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between text-gray-400">
              <span>{t("cheerEvents")}</span>
              <span className="text-white">{data.bits.eventCount}</span>
            </div>
            <div className="flex justify-between text-gray-400">
              <span>{t("conversionRate")}</span>
              <span className="text-white">100 Bits = $1.00</span>
            </div>
          </div>
        </div>
      </div>

      {/* 收益佔比餅圖 */}
      {pieData.length > 0 && (
        <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700/50">
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-green-400" />
            {t("revenueBreakdown")}
          </h3>
          <div className="h-[280px]">
            <SafeResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={4}
                  dataKey="value"
                  labelLine={false}
                >
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#1F2937",
                    border: "1px solid #374151",
                    borderRadius: "8px",
                  }}
                  formatter={(value) => [
                    `$${Number(value ?? 0).toFixed(2)}`,
                    "",
                  ]}
                />
                <Legend
                  verticalAlign="bottom"
                  height={36}
                  formatter={(value) => (
                    <span style={{ color: "#E5E7EB" }}>{value}</span>
                  )}
                />
              </PieChart>
            </SafeResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
