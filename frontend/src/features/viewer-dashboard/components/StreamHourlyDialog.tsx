"use client";

import { useEffect, useState, useRef } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useTranslations } from "next-intl";
import { viewerApi, type HourlyViewerStat } from "@/lib/api/viewer";
import { X } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channelId: string;
  date: string | null;
  title: string | null;
}

export function StreamHourlyDialog({
  open,
  onOpenChange,
  channelId,
  date,
  title,
}: Props) {
  const t = useTranslations();
  const [data, setData] = useState<HourlyViewerStat[]>([]);
  const [loading, setLoading] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && channelId && date) {
      setLoading(true);
      viewerApi
        .getChannelStreamHourlyStats(channelId, date)
        .then((res) => setData(res || []))
        .finally(() => setLoading(false));
    }
  }, [open, channelId, date]);

  // Handle overlay click to close
  const handleOverlayClick = (e: React.MouseEvent) => {
    if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
      onOpenChange(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      onClick={handleOverlayClick}
    >
      <div
        ref={modalRef}
        className="relative w-full max-w-2xl bg-white dark:bg-[#1a1b26] rounded-2xl shadow-2xl p-6 border border-gray-200 dark:border-gray-800 animate-in zoom-in-95 duration-200"
      >
        <button
          onClick={() => onOpenChange(false)}
          className="absolute right-4 top-4 p-2 rounded-full hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
        >
          <X className="w-5 h-5 text-gray-500" />
        </button>

        <div className="mb-6">
          <h2 className="text-xl font-bold theme-text-primary mb-1">
            {date} {t("charts.hourlyAnalysis")}
          </h2>
          <p className="theme-text-secondary text-sm line-clamp-2 pr-8">
            {title}
          </p>
        </div>

        <div className="py-2">
          {loading ? (
            <div className="h-[300px] flex items-center justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-purple-600"></div>
            </div>
          ) : data.length > 0 ? (
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={data}
                  margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
                >
                  <defs>
                    <linearGradient
                      id="colorViewers"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.5} />
                      <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="hour"
                    tick={{ fill: "#9ca3af", fontSize: 11 }}
                    tickMargin={10}
                  />
                  <YAxis
                    tick={{ fill: "#9ca3af", fontSize: 11 }}
                    tickFormatter={(val) =>
                      val >= 1000 ? `${(val / 1000).toFixed(1)}k` : val
                    }
                    width={40}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#1f2937",
                      borderColor: "#374151",
                      color: "#fff",
                      borderRadius: "8px",
                      boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.1)",
                    }}
                    cursor={{
                      stroke: "#8b5cf6",
                      strokeWidth: 1,
                      strokeDasharray: "4 4",
                    }}
                    formatter={(value: number) => [
                      value.toLocaleString(),
                      t("charts.viewers"),
                    ]}
                  />
                  <Area
                    type="monotone"
                    dataKey="viewers"
                    stroke="#8b5cf6"
                    strokeWidth={3}
                    fillOpacity={1}
                    fill="url(#colorViewers)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-[300px] flex items-center justify-center text-gray-500 bg-gray-50 dark:bg-black/20 rounded-xl border border-dashed border-gray-200 dark:border-white/10">
              {t("charts.noHourlyData")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
