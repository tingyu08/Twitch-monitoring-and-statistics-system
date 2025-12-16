"use client";

import { useState, useRef, useEffect } from "react";
import { DayPicker, type DateRange } from "react-day-picker";
import { format, subDays, startOfDay } from "date-fns";
import { zhTW } from "date-fns/locale";
import "react-day-picker/dist/style.css";

interface DateRangePickerProps {
  onRangeSelect: (range: { startDate: Date; endDate: Date }) => void;
  disabled?: boolean;
}

export function DateRangePicker({
  onRangeSelect,
  disabled = false,
}: DateRangePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [range, setRange] = useState<DateRange | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);

  // 點擊外部關閉
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // 當選擇完整範圍時觸發回調
  useEffect(() => {
    if (range?.from && range?.to) {
      onRangeSelect({
        startDate: startOfDay(range.from),
        endDate: startOfDay(range.to),
      });
      // 選擇完成後關閉
      setIsOpen(false);
    }
  }, [range, onRangeSelect]);

  const today = new Date();
  const defaultMonth = subDays(today, 30);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        disabled={disabled}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-label={
          range?.from && range?.to
            ? `已選擇日期範圍：${format(range.from, "MM/dd")} 至 ${format(range.to, "MM/dd")}，點擊更改`
            : "選擇自訂日期範圍"
        }
        className={`
          px-3 py-1.5 rounded-md text-sm font-medium transition-all duration-200
          border border-gray-600 bg-gray-800/50
          ${
            range?.from && range?.to
              ? "text-purple-300 border-purple-500"
              : "text-gray-400 hover:text-white hover:bg-gray-700/50"
          }
          ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
        `}
      >
        {range?.from && range?.to ? (
          <>
            {format(range.from, "MM/dd")} - {format(range.to, "MM/dd")}
          </>
        ) : (
          <>
            <svg
              className="inline-block w-4 h-4 mr-1 -mt-0.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
            自訂日期
          </>
        )}
      </button>

      {isOpen && (
        <div className="absolute z-50 mt-2 right-0 bg-gray-800 border border-gray-700 rounded-lg shadow-xl p-4">
          <style>
            {`
              .rdp {
                --rdp-cell-size: 36px;
                --rdp-accent-color: #a855f7;
                --rdp-background-color: #1f2937;
                color: #f3f4f6;
              }
              .rdp-day_selected:not([disabled]) {
                background-color: #a855f7 !important;
                color: white !important;
              }
              .rdp-day_selected:hover:not([disabled]) {
                background-color: #9333ea !important;
              }
              .rdp-day:hover:not([disabled]):not(.rdp-day_selected) {
                background-color: #374151;
              }
              .rdp-day_range_middle {
                background-color: rgba(168, 85, 247, 0.2) !important;
              }
              .rdp-button:focus-visible:not([disabled]) {
                outline: 2px solid #a855f7;
              }
              .rdp-caption_label {
                font-weight: 600;
              }
              .rdp-head_cell {
                color: #9ca3af;
                font-weight: 500;
              }
              .rdp-nav_button {
                color: #9ca3af;
              }
              .rdp-nav_button:hover {
                background-color: #374151;
              }
            `}
          </style>
          <DayPicker
            mode="range"
            defaultMonth={defaultMonth}
            selected={range}
            onSelect={setRange}
            locale={zhTW}
            disabled={{ after: today }}
            numberOfMonths={1}
            showOutsideDays
            fixedWeeks
          />
          <div className="mt-3 pt-3 border-t border-gray-700 flex justify-between items-center">
            <span className="text-xs text-gray-500">
              {range?.from
                ? range?.to
                  ? `已選擇 ${Math.ceil((range.to.getTime() - range.from.getTime()) / (1000 * 60 * 60 * 24)) + 1} 天`
                  : "請選擇結束日期"
                : "請選擇開始日期"}
            </span>
            <button
              type="button"
              onClick={() => {
                setRange(undefined);
                setIsOpen(false);
              }}
              className="text-xs text-gray-400 hover:text-white"
            >
              清除
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default DateRangePicker;
