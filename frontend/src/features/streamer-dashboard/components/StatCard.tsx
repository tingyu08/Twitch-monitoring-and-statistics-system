interface StatCardProps {
  title: string;
  value: string | number;
  unit: string;
  subtitle?: string;
  isEstimated?: boolean;
}

export function StatCard({ title, value, unit, subtitle, isEstimated }: StatCardProps) {
  return (
    <div className="bg-gray-800 p-6 rounded-lg shadow-lg border border-gray-700 hover:border-purple-500 transition-colors">
      <div className="flex items-start justify-between mb-2">
        <h3 className="text-sm font-medium text-gray-400">{title}</h3>
        {isEstimated && (
          <span className="px-2 py-1 text-xs bg-yellow-900/30 text-yellow-400 rounded border border-yellow-700">
            估算
          </span>
        )}
      </div>

      <div className="flex items-baseline gap-2 mb-1">
        <span className="text-4xl font-bold text-white">{value}</span>
        <span className="text-lg text-gray-500">{unit}</span>
      </div>

      {subtitle && (
        <p className="text-xs text-gray-500 mt-2">{subtitle}</p>
      )}
    </div>
  );
}
