import { useId } from 'react';

interface StatCardProps {
  title: string;
  value: string | number;
  unit: string;
  subtitle?: string;
  isEstimated?: boolean;
}

export function StatCard({ title, value, unit, subtitle, isEstimated }: StatCardProps) {
  const titleId = useId();
  const valueId = useId();

  return (
    <article
      className="bg-gray-800 p-6 rounded-lg shadow-lg border border-gray-700 hover:border-purple-500 transition-colors"
      role="region"
      aria-labelledby={titleId}
      aria-describedby={valueId}
    >
      <div className="flex items-start justify-between mb-2">
        <h3 id={titleId} className="text-sm font-medium text-gray-400">{title}</h3>
        {isEstimated && (
          <span
            className="px-2 py-1 text-xs bg-yellow-900/30 text-yellow-400 rounded border border-yellow-700"
            role="status"
            aria-label="此數值為估算值"
          >
            估算
          </span>
        )}
      </div>

      <div className="flex items-baseline gap-2 mb-1" aria-live="polite">
        <span id={valueId} className="text-4xl font-bold text-white" aria-label={`${value} ${unit}`}>
          {value}
        </span>
        <span className="text-lg text-gray-500" aria-hidden="true">{unit}</span>
      </div>

      {subtitle && (
        <p className="text-xs text-gray-500 mt-2" aria-label={subtitle}>{subtitle}</p>
      )}
    </article>
  );
}
