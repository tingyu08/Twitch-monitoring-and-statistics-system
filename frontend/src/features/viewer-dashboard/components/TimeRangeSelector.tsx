"use client";

import { useTranslations } from "next-intl";
import { DateRangePicker } from "./DateRangePicker";

export type TimeRange = "7" | "30" | "90" | "all" | "custom";

export interface CustomDateRange {
  startDate: Date;
  endDate: Date;
}

export interface TimeRangeSelectorProps {
  currentRange: TimeRange;
  onRangeChange: (range: TimeRange) => void;
  onCustomRangeChange: (range: CustomDateRange) => void;
  disabled?: boolean;
}

// Keep for compatibility if used elsewhere for logic
export const RANGE_OPTIONS = [
  { value: "7", label: "7 天", days: 7 },
  { value: "30", label: "30 天", days: 30 },
  { value: "90", label: "90 天", days: 90 },
  { value: "all", label: "全部", days: 3650 }, // ~10年
] as const;

export function TimeRangeSelector({
  currentRange,
  onRangeChange,
  onCustomRangeChange,
  disabled = false,
}: TimeRangeSelectorProps) {
  const t = useTranslations("timeRange");

  // Dynamic options with translations
  const displayOptions = [
    { value: "7", label: t("days7") },
    { value: "30", label: t("days30") },
    { value: "90", label: t("days90") },
    { value: "all", label: t("all") },
  ];

  return (
    <div
      className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3"
      role="group"
      aria-label={t("label")}
    >
      <span
        id="time-range-label"
        className="text-sm theme-text-secondary whitespace-nowrap"
      >
        {t("label")}
      </span>

      <div className="flex flex-wrap items-center gap-2">
        <div
          className="flex bg-white dark:bg-[#1a1b26] rounded-lg p-0.5 sm:p-1 border border-purple-200 dark:border-white/5"
          role="radiogroup"
          aria-labelledby="time-range-label"
        >
          {displayOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={currentRange === option.value}
              onClick={() => onRangeChange(option.value as TimeRange)}
              disabled={disabled}
              className={`
                px-2 sm:px-3 py-1 sm:py-1.5 rounded-md text-xs sm:text-sm font-medium transition-all duration-200
                ${
                  currentRange === option.value
                    ? "bg-purple-600 text-white shadow-sm shadow-purple-900/20"
                    : "text-purple-700 dark:text-gray-400 hover:text-purple-900 dark:hover:text-white hover:bg-purple-50 dark:hover:bg-white/5"
                }
                ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
              `}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="flex items-center">
          <DateRangePicker
            onRangeSelect={onCustomRangeChange}
            disabled={disabled}
          />
        </div>
      </div>

      {currentRange === "custom" && (
        <span className="text-xs text-purple-600 dark:text-purple-400 animate-fade-in">
          {t("custom")}
        </span>
      )}
    </div>
  );
}

export function getRangeDays(range: TimeRange): number {
  const option = RANGE_OPTIONS.find((opt) => opt.value === range);
  return option?.days || 30;
}

export function getCustomRangeDays(range: CustomDateRange): number {
  const diffTime = Math.abs(
    range.endDate.getTime() - range.startDate.getTime()
  );
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays + 1;
}
