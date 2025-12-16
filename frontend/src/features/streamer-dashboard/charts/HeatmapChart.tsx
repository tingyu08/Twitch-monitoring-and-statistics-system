'use client';

import React from 'react';
import type { HeatmapCell } from '@/lib/api/streamer';

interface HeatmapChartProps {
  data: HeatmapCell[];
  maxValue?: number;
}

const DAYS = ['週一', '週二', '週三', '週四', '週五', '週六', '週日'];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

export function HeatmapChart({ data, maxValue = 4 }: HeatmapChartProps) {
  const dataMap = new Map<string, number>();
  data.forEach(cell => {
    const key = `${cell.dayOfWeek}-${cell.hour}`;
    dataMap.set(key, cell.value);
  });

  // 使用 API 提供的 maxValue 進行動態顏色計算
  const effectiveMax = maxValue > 0 ? maxValue : 4; // 如果 maxValue 為 0，使用預設值 4

  const getColor = (hours: number) => {
    if (hours === 0) return '#1f2937';
    // 使用實際的最大值進行正規化
    const intensity = Math.min(hours / effectiveMax, 1);
    const blue = Math.round(59 + (255 - 59) * intensity);
    const green = Math.round(130 + (59 - 130) * (1 - intensity));
    return `rgb(59, ${green}, ${blue})`;
  };

  // 為螢幕閱讀器生成資料摘要
  const generateDataSummary = () => {
    if (!data || data.length === 0) return '無資料';
    const totalHours = data.reduce((sum, d) => sum + d.value, 0);
    // 找出最活躍的時段
    let maxHourData = { day: 0, hour: 0, value: 0 };
    data.forEach(cell => {
      if (cell.value > maxHourData.value) {
        maxHourData = { day: cell.dayOfWeek, hour: cell.hour, value: cell.value };
      }
    });
    const peakInfo = maxHourData.value > 0
      ? `，最活躍時段為${DAYS[maxHourData.day === 0 ? 6 : maxHourData.day - 1]} ${maxHourData.hour}:00 (${maxHourData.value.toFixed(1)} 小時)`
      : '';
    return `總計 ${totalHours.toFixed(1)} 開台小時${peakInfo}`;
  };

  return (
    <figure
      className="w-full overflow-x-auto"
      role="img"
      aria-label={`開台時段熱力圖：${generateDataSummary()}`}
    >
      <div className="min-w-[600px] md:min-w-0">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-gray-300" id="heatmap-title">開台時段熱力圖 (小時數)</h3>
          <div className="flex items-center gap-2 text-xs text-gray-400" aria-hidden="true">
            <div className="flex items-center gap-1">
              <div className="w-4 h-4 rounded" style={{ backgroundColor: '#1f2937' }}></div>
              <span>0</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-4 h-4 rounded" style={{ backgroundColor: getColor(effectiveMax * 0.25) }}></div>
              <span>{(effectiveMax * 0.25).toFixed(1)}</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-4 h-4 rounded" style={{ backgroundColor: getColor(effectiveMax * 0.5) }}></div>
              <span>{(effectiveMax * 0.5).toFixed(1)}</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-4 h-4 rounded" style={{ backgroundColor: getColor(effectiveMax) }}></div>
              <span>{effectiveMax.toFixed(1)}+</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-[auto_repeat(24,1fr)] gap-1">
          <div className="h-8"></div>
          
          {HOURS.map(hour => (
            <div key={hour} className="text-xs text-gray-400 text-center flex items-center justify-center h-8">
              {hour}
            </div>
          ))}

          {[1, 2, 3, 4, 5, 6, 0].map((dayOfWeek, dayIndex) => (
            <React.Fragment key={`row-${dayOfWeek}`}>
              <div className="text-xs text-gray-400 flex items-center justify-end pr-2 h-8">
                {DAYS[dayIndex]}
              </div>
              
              {HOURS.map(hour => {
                const key = `${dayOfWeek}-${hour}`;
                const hours = dataMap.get(key) || 0;
                const color = getColor(hours);
                
                return (
                  <div
                    key={`${dayOfWeek}-${hour}`}
                    className="h-8 rounded hover:ring-2 hover:ring-blue-400 cursor-pointer transition-all duration-300 ease-in-out hover:scale-105"
                    style={{ 
                      backgroundColor: color,
                      animation: `fadeIn 0.5s ease-in-out ${(dayIndex * 24 + hour) * 10}ms both`
                    }}
                    title={`${DAYS[dayIndex]} ${hour}:00 - ${hours.toFixed(1)} 小時`}
                    role="gridcell"
                    aria-label={`${DAYS[dayIndex]} ${hour}:00，開台 ${hours.toFixed(1)} 小時`}
                  />
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>
      <figcaption className="sr-only">
        顯示每週每個時段的開台時間分布熱力圖，顏色越深代表該時段開台時間越長
      </figcaption>
    </figure>
  );
}
