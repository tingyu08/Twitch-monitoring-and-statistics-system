type DateRange = '7d' | '30d' | '90d';

interface DateRangePickerProps {
  selectedRange: DateRange;
  onRangeChange: (range: DateRange) => void;
}

const rangeOptions: { value: DateRange; label: string }[] = [
  { value: '7d', label: '最近 7 天' },
  { value: '30d', label: '最近 30 天' },
  { value: '90d', label: '最近 90 天' },
];

export function DateRangePicker({ selectedRange, onRangeChange }: DateRangePickerProps) {
  return (
    <div className="flex gap-2">
      {rangeOptions.map((option) => (
        <button
          key={option.value}
          onClick={() => onRangeChange(option.value)}
          className={`
            px-4 py-2 rounded-lg font-medium transition-all
            ${
              selectedRange === option.value
                ? 'bg-purple-600 text-white shadow-lg shadow-purple-500/50'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }
          `}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
