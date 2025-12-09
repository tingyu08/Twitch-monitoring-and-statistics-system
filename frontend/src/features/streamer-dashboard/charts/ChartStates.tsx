/**
 * Chart Loading UI Component
 * 
 * 共用的圖表載入、錯誤、空狀態 UI
 */

interface ChartLoadingProps {
  message?: string;
}

export function ChartLoading({ message = '載入圖表資料中...' }: ChartLoadingProps) {
  return (
    <div className="flex items-center justify-center h-[300px]">
      <div className="flex flex-col items-center gap-3">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-purple-500"></div>
        <p className="text-sm text-gray-400">{message}</p>
      </div>
    </div>
  );
}

interface ChartErrorProps {
  error: string;
  onRetry?: () => void;
}

export function ChartError({ error, onRetry }: ChartErrorProps) {
  return (
    <div className="flex flex-col items-center justify-center h-[300px] px-4">
      <div className="text-5xl mb-4">⚠️</div>
      <p className="text-base sm:text-lg font-medium text-red-400 mb-2">無法載入圖表</p>
      <p className="text-xs sm:text-sm text-gray-400 text-center mb-4">{error}</p>
      {onRetry && (
        <button 
          onClick={onRetry}
          className="px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg text-sm transition-colors"
        >
          重試
        </button>
      )}
    </div>
  );
}

interface ChartEmptyProps {
  emoji?: string;
  title?: string;
  description: string;
  hint?: string;
}

export function ChartEmpty({ 
  emoji = '📊', 
  title = '暫無資料',
  description,
  hint 
}: ChartEmptyProps) {
  return (
    <div className="flex flex-col items-center justify-center h-[300px] text-gray-400 px-4">
      <div className="text-5xl mb-4">{emoji}</div>
      <p className="text-base sm:text-lg font-medium mb-2">{title}</p>
      <p className="text-xs sm:text-sm text-center">{description}</p>
      {hint && <p className="text-xs text-gray-500 mt-2">{hint}</p>}
    </div>
  );
}
