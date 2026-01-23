import { useTranslations } from "next-intl";

type DateRange = "7d" | "30d" | "90d";

interface DateRangePickerProps {
  selectedRange: DateRange;
  onRangeChange: (range: DateRange) => void;
}

export function DateRangePicker({
  selectedRange,
  onRangeChange,
}: DateRangePickerProps) {
  const t = useTranslations("streamer.datePicker");

  const rangeOptions: { value: DateRange; label: string }[] = [
    { value: "7d", label: t("recent7") },
    { value: "30d", label: t("recent30") },
    { value: "90d", label: t("recent90") },
  ];

  return (
    <div className="flex gap-2" role="group" aria-label={t("select")}>
      {rangeOptions.map((option) => (
        <button
          key={option.value}
          onClick={() => onRangeChange(option.value)}
          aria-pressed={selectedRange === option.value}
          aria-label={`${option.label}${
            selectedRange === option.value ? `, ${t("current")}` : ""
          }`}
          className={`
            px-4 py-2 rounded-lg font-medium transition-[color,background-color,border-color,box-shadow,transform,opacity] text-sm sm:text-base
            ${
              selectedRange === option.value
                ? "bg-purple-600 text-white shadow-lg shadow-purple-500/50"
                : "bg-white/50 dark:bg-gray-700 theme-text-secondary dark:text-gray-300 hover:bg-white/80 dark:hover:bg-gray-600 border border-purple-200 dark:border-transparent"
            }
          `}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
