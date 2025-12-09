'use client';

import React from 'react';
import type { HeatmapCell } from '@/lib/api/streamer';

interface HeatmapChartProps {
  data: HeatmapCell[];
}

const DAYS = ['週一', '週二', '週三', '週四', '週五', '週六', '週日'];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

export function HeatmapChart({ data }: HeatmapChartProps) {
  const dataMap = new Map<string, number>();
  data.forEach(cell => {
    const key = `${cell.dayOfWeek}-${cell.hour}`;
    dataMap.set(key, cell.value);
  });

  const getColor = (hours: number) => {
    if (hours === 0) return '#1f2937';
    // 假設最大開台時數為 4 小時，正規化到 0-1
    const intensity = Math.min(hours / 4, 1);
    const blue = Math.round(59 + (255 - 59) * intensity);
    const green = Math.round(130 + (59 - 130) * (1 - intensity));
    return `rgb(59, ${green}, ${blue})`;
  };

  return (
    <div className="w-full overflow-x-auto">
      <div className="min-w-[600px] md:min-w-0">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-gray-300">開台時段熱力圖 (小時數)</h3>
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <div className="flex items-center gap-1">
              <div className="w-4 h-4 rounded" style={{ backgroundColor: '#1f2937' }}></div>
              <span>0</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-4 h-4 rounded" style={{ backgroundColor: getColor(1) }}></div>
              <span>1</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-4 h-4 rounded" style={{ backgroundColor: getColor(2) }}></div>
              <span>2</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-4 h-4 rounded" style={{ backgroundColor: getColor(4) }}></div>
              <span>4+</span>
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
                    className="h-8 rounded hover:ring-2 hover:ring-blue-400 cursor-pointer transition-all"
                    style={{ backgroundColor: color }}
                    title={`${DAYS[dayIndex]} ${hour}:00 - ${hours.toFixed(1)} 小時`}
                  />
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}
