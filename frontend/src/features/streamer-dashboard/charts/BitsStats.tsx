"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { SafeResponsiveContainer } from "@/components/charts/SafeResponsiveContainer";
import { Loader2, Zap, Trophy, TrendingUp } from "lucide-react";
import { getApiUrl } from "@/lib/api/getApiUrl";

interface BitsData {
  date: string;
  totalBits: number;
  estimatedRevenue: number;
  eventCount: number;
}

interface TopSupporter {
  userName: string;
  totalBits: number;
  eventCount: number;
}

interface BitsStatsProps {
  days?: number;
}

export function BitsStats({ days = 30 }: BitsStatsProps) {
  const t = useTranslations("streamer.revenue");
  const [data, setData] = useState<BitsData[]>([]);
  const [topSupporters, setTopSupporters] = useState<TopSupporter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // P1 Fix: 使用 AbortController 來處理清理和避免競態條件
    const abortController = new AbortController();

    const fetchData = async () => {
      setLoading(true);
      try {
        // 開發環境直接連接後端以避免 Next.js rewrites 延遲
        const [bitsRes, supportersRes] = await Promise.all([
          fetch(getApiUrl(`/api/streamer/revenue/bits?days=${days}`), {
            credentials: "include",
            signal: abortController.signal,
          }),
          fetch(getApiUrl(`/api/streamer/revenue/top-supporters?limit=5`), {
            credentials: "include",
            signal: abortController.signal,
          }),
        ]);

        if (!bitsRes.ok || !supportersRes.ok) throw new Error("Failed to fetch");

        const [bitsJson, supportersJson] = await Promise.all([
          bitsRes.json(),
          supportersRes.json(),
        ]);

        // P1 Fix: 只在未被取消時更新狀態
        if (!abortController.signal.aborted) {
          setData(bitsJson);
          setTopSupporters(supportersJson);
        }
      } catch (err) {
        // P1 Fix: 忽略取消的請求錯誤
        if (err instanceof Error && err.name === "AbortError") {
          return;
        }
        if (!abortController.signal.aborted) {
          setError("Failed to load bits data");
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
  }, [days]);

  // 計算總計
  const totalBits = data.reduce((sum, d) => sum + d.totalBits, 0);
  const totalRevenue = totalBits * 0.01;
  const totalEvents = data.reduce((sum, d) => sum + d.eventCount, 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 text-purple-400 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12 text-gray-400">
        <Zap className="w-12 h-12 mx-auto mb-4 opacity-50" />
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 摘要卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700/50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-orange-500/20 rounded-lg">
              <Zap className="w-5 h-5 text-orange-400" />
            </div>
            <div>
              <p className="text-sm text-gray-400">{t("totalBits")}</p>
              <p className="text-2xl font-bold text-white">{totalBits.toLocaleString()}</p>
            </div>
          </div>
        </div>

        <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700/50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-500/20 rounded-lg">
              <TrendingUp className="w-5 h-5 text-green-400" />
            </div>
            <div>
              <p className="text-sm text-gray-400">{t("estRevenue")}</p>
              <p className="text-2xl font-bold text-white">${totalRevenue.toFixed(2)}</p>
            </div>
          </div>
        </div>

        <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700/50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/20 rounded-lg">
              <Trophy className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <p className="text-sm text-gray-400">{t("cheerEvents")}</p>
              <p className="text-2xl font-bold text-white">{totalEvents}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 每日 Bits 柱狀圖 */}
        <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700/50">
          <h3 className="text-lg font-semibold text-white mb-4">{t("dailyBits")}</h3>
          {data.length > 0 ? (
            <div className="h-[250px]">
              <SafeResponsiveContainer width="100%" height="100%">
                <BarChart data={data}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis
                    dataKey="date"
                    stroke="#9CA3AF"
                    tick={{ fill: "#9CA3AF", fontSize: 12 }}
                    tickFormatter={(value) => value.slice(5)}
                  />
                  <YAxis stroke="#9CA3AF" tick={{ fill: "#9CA3AF", fontSize: 12 }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#1F2937",
                      border: "1px solid #374151",
                      borderRadius: "8px",
                    }}
                    labelStyle={{ color: "#E5E7EB" }}
                    formatter={(value) => [(value ?? 0).toLocaleString(), "Bits"]}
                  />
                  <Bar dataKey="totalBits" fill="#F97316" radius={[4, 4, 0, 0]} />
                </BarChart>
              </SafeResponsiveContainer>
            </div>
          ) : (
            <div className="h-[250px] flex items-center justify-center text-gray-500">
              {t("noBitsData")}
            </div>
          )}
        </div>

        {/* Top 贊助者排行榜 */}
        <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700/50">
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Trophy className="w-5 h-5 text-yellow-400" />
            {t("topSupporters")}
          </h3>
          {topSupporters.length > 0 ? (
            <div className="space-y-3">
              {topSupporters.map((supporter, index) => (
                <div
                  key={supporter.userName}
                  className="flex items-center justify-between p-3 bg-gray-900/50 rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`w-6 h-6 rounded-full flex items-center justify-center text-sm font-bold ${
                        index === 0
                          ? "bg-yellow-500 text-black"
                          : index === 1
                            ? "bg-gray-400 text-black"
                            : index === 2
                              ? "bg-orange-600 text-white"
                              : "bg-gray-600 text-white"
                      }`}
                    >
                      {index + 1}
                    </span>
                    <span className="text-white font-medium">{supporter.userName}</span>
                  </div>
                  <div className="text-right">
                    <p className="text-orange-400 font-semibold">
                      {supporter.totalBits.toLocaleString()} Bits
                    </p>
                    <p className="text-xs text-gray-500">
                      {supporter.eventCount} {t("cheers")}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="h-[200px] flex items-center justify-center text-gray-500">
              {t("noSupporters")}
            </div>
          )}
        </div>
      </div>

      {/* 注意事項 */}
      <p className="text-xs text-gray-500 text-center">{t("revenueDisclaimer")}</p>
    </div>
  );
}
