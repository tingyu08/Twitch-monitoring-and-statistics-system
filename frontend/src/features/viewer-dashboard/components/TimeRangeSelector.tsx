"use client";

import { DateRangePicker } from "./DateRangePicker";

export type TimeRange = "7" | "30" | "90" | "all" | "custom";

export interface CustomDateRange {
  startDate: Date;
  endDate: Date;
}

interface TimeRangeSelectorProps {
  currentRange: TimeRange;
  onRangeChange: (range: TimeRange) => void;
  onCustomRangeChange?: (range: CustomDateRange) => void;
  disabled?: boolean;
}

const RANGE_OPTIONS: { value: TimeRange; label: string; days: number | null }[] = [
  { value: "7", label: "7 天", days: 7 },
  { value: "30", label: "30 天", days: 30 },
  { value: "90", label: "90 天", days: 90 },
  { value: "all", label: "全部", days: null },
];

export function TimeRangeSelector({
  currentRange,
  onRangeChange,
  onCustomRangeChange,
  disabled = false,
}: TimeRangeSelectorProps) {
  const handleCustomRangeSelect = (range: { startDate: Date; endDate: Date }) => {
    if (onCustomRangeChange) {
      onCustomRangeChange(range);
      onRangeChange("custom");
    }
  };

  return (
    <div 
      className="flex items-center gap-3 flex-wrap"
      role="group"
      aria-label="時間範圍選擇"
    >
      <span id="time-range-label" className="text-sm text-gray-400">時間範圍：</span>
      <div 
        className="flex bg-gray-800 rounded-lg p-1 border border-gray-700"
        role="radiogroup"
        aria-labelledby="time-range-label"
      >
        {RANGE_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={currentRange === option.value}
            onClick={() => onRangeChange(option.value)}
            disabled={disabled}
            aria-label={`顯示${option.label}的資料${currentRange === option.value ? '，目前已選擇' : ''}`}
            className={`
              px-3 py-1.5 rounded-md text-sm font-medium transition-all duration-200
              ${
                currentRange === option.value
                  ? "bg-purple-600 text-white shadow-sm shadow-purple-900/20"
                  : "text-gray-400 hover:text-white hover:bg-gray-700/50"
              }
              ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
            `}
          >
            {option.label}
          </button>
        ))}
      </div>
      
      {/* 自訂日期選擇器 */}
      {onCustomRangeChange && (
        <DateRangePicker
          onRangeSelect={handleCustomRangeSelect}
          disabled={disabled}
        />
      )}
    </div>
  );
}

// 輔助函數：將 TimeRange 轉換為 API 需要的 days 參數
export function getRangeDays(range: TimeRange): number {
  switch (range) {
    case "7":
      return 7;
    case "30":
      return 30;
    case "90":
      return 90;
    case "all":
      return 365; // 預設取一年資料
    case "custom":
      return 0; // 自訂範圍不使用 days，直接用日期
    default:
      return 30;
  }
}

// 輔助函數：計算自訂範圍的天數
export function getCustomRangeDays(range: CustomDateRange): number {
  const diffMs = range.endDate.getTime() - range.startDate.getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24)) + 1;
}

export default TimeRangeSelector;
