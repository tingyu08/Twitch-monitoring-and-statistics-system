"use client";

import React from "react";
import type { HeatmapCell } from "@/lib/api/streamer";
import { useTranslations } from "next-intl";

interface HeatmapChartProps {
  data: HeatmapCell[];
  maxValue?: number;
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);

export function HeatmapChart({ data, maxValue = 4 }: HeatmapChartProps) {
  const t = useTranslations("streamer.charts.heatmap");

  const DAYS = [
    t("days.mon"),
    t("days.tue"),
    t("days.wed"),
    t("days.thu"),
    t("days.fri"),
    t("days.sat"),
    t("days.sun"),
  ];

  // 處理時區轉換 (UTC -> 本地時間)
  const localData = React.useMemo(() => {
    // 取得本地時區偏移 (小時)，例如 TW 為 +8
    const offsetHours = -(new Date().getTimezoneOffset() / 60);

    return data.map((cell) => {
      // 加上偏移量
      let newHour = cell.hour + offsetHours;
      let newDay = cell.dayOfWeek;

      // 處理跨日 (往未來)
      if (newHour >= 24) {
        newHour -= 24;
        // 假設 dayOfWeek 是 0(Sun) - 6(Sat)
        newDay = (newDay + 1) % 7;
      }
      // 處理跨日 (往過去)
      else if (newHour < 0) {
        newHour += 24;
        newDay = (newDay - 1 + 7) % 7;
      }

      // 如果時區有半小時間隔 (如印度 +5.5)，四捨五入到最近的小時
      return {
        ...cell,
        hour: Math.round(newHour),
        dayOfWeek: newDay,
      };
    });
  }, [data]);

  const dataMap = new Map<string, number>();
  localData.forEach((cell) => {
    const key = `${cell.dayOfWeek}-${cell.hour}`;
    // 如果轉換後多個時段重疊到同一小時 (罕見)，累加數值？
    // Heatmap 主要是顯示「有開台的時間」，如果原本是 hour duration，累加是對的。
    const current = dataMap.get(key) || 0;
    dataMap.set(key, current + cell.value);
  });

  // 使用 API 提供的 maxValue 進行動態顏色計算
  const effectiveMax = maxValue > 0 ? maxValue : 4; // 如果 maxValue 為 0，使用預設值 4

  const getColor = (hours: number) => {
    if (hours === 0) return "#1f2937";
    // 使用實際的最大值進行正規化
    const intensity = Math.min(hours / effectiveMax, 1);
    const blue = Math.round(59 + (255 - 59) * intensity);
    const green = Math.round(130 + (59 - 130) * (1 - intensity));
    return `rgb(59, ${green}, ${blue})`;
  };

  // 為螢幕閱讀器生成資料摘要
  const generateDataSummary = () => {
    if (!localData || localData.length === 0) return t("noData");
    const totalHours = localData.reduce((sum, d) => sum + d.value, 0);
    // 找出最活躍的時段
    let maxHourData = { day: 0, hour: 0, value: 0 };
    localData.forEach((cell) => {
      if (cell.value > maxHourData.value) {
        maxHourData = {
          day: cell.dayOfWeek,
          hour: cell.hour,
          value: cell.value,
        };
      }
    });
    const peakInfo =
      maxHourData.value > 0
        ? t("peak", {
            day: DAYS[maxHourData.day === 0 ? 6 : maxHourData.day - 1],
            hour: maxHourData.hour,
            hours: maxHourData.value.toFixed(1),
          })
        : "";
    return t("total", { hours: totalHours.toFixed(1) }) + peakInfo;
  };

  return (
    <figure
      className="w-full overflow-x-auto"
      role="img"
      aria-label={t("ariaLabel", { summary: generateDataSummary() })}
    >
      <div className="min-w-[600px] md:min-w-0">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-gray-300" id="heatmap-title">
            {t("title")}
          </h3>
          <div
            className="flex items-center gap-2 text-xs text-gray-400"
            aria-hidden="true"
          >
            <div className="flex items-center gap-1">
              <div
                className="w-4 h-4 rounded"
                style={{ backgroundColor: "#1f2937" }}
              ></div>
              <span>0</span>
            </div>
            <div className="flex items-center gap-1">
              <div
                className="w-4 h-4 rounded"
                style={{ backgroundColor: getColor(effectiveMax * 0.25) }}
              ></div>
              <span>{(effectiveMax * 0.25).toFixed(1)}</span>
            </div>
            <div className="flex items-center gap-1">
              <div
                className="w-4 h-4 rounded"
                style={{ backgroundColor: getColor(effectiveMax * 0.5) }}
              ></div>
              <span>{(effectiveMax * 0.5).toFixed(1)}</span>
            </div>
            <div className="flex items-center gap-1">
              <div
                className="w-4 h-4 rounded"
                style={{ backgroundColor: getColor(effectiveMax) }}
              ></div>
              <span>{effectiveMax.toFixed(1)}+</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-[auto_repeat(24,1fr)] gap-1">
          <div className="h-8"></div>

          {HOURS.map((hour) => (
            <div
              key={hour}
              className="text-xs text-gray-400 text-center flex items-center justify-center h-8"
            >
              {hour}
            </div>
          ))}

          {[1, 2, 3, 4, 5, 6, 0].map((dayOfWeek, dayIndex) => (
            <React.Fragment key={`row-${dayOfWeek}`}>
              <div className="text-xs text-gray-400 flex items-center justify-end pr-2 h-8">
                {DAYS[dayIndex]}
              </div>

              {HOURS.map((hour) => {
                const key = `${dayOfWeek}-${hour}`;
                const hours = dataMap.get(key) || 0;
                const color = getColor(hours);

                return (
                  <div
                    key={`${dayOfWeek}-${hour}`}
                    className="h-8 rounded hover:ring-2 hover:ring-blue-400 cursor-pointer transition-all duration-300 ease-in-out hover:scale-105"
                    style={{
                      backgroundColor: color,
                      animation: `fadeIn 0.5s ease-in-out ${
                        (dayIndex * 24 + hour) * 10
                      }ms both`,
                    }}
                    title={t("cellTooltip", {
                      day: DAYS[dayIndex],
                      hour: hour,
                      hours: hours.toFixed(1),
                    })}
                    role="gridcell"
                    aria-label={t("cellAria", {
                      day: DAYS[dayIndex],
                      hour: hour,
                      hours: hours.toFixed(1),
                    })}
                  />
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>
      <figcaption className="sr-only">{t("figcaption")}</figcaption>
    </figure>
  );
}
