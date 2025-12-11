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
  actionButton?: {
    label: string;
    onClick: () => void;
    isLoading?: boolean;
  };
}

export function ChartEmpty({
  emoji = '📊',
  title = '暫無資料',
  description,
  hint,
  actionButton
}: ChartEmptyProps) {
  return (
    <div className="flex flex-col items-center justify-center h-[300px] text-gray-400 px-4">
      <div className="text-5xl mb-4">{emoji}</div>
      <p className="text-base sm:text-lg font-medium mb-2">{title}</p>
      <p className="text-xs sm:text-sm text-center">{description}</p>
      {hint && <p className="text-xs text-gray-500 mt-2">{hint}</p>}
      {actionButton && (
        <button
          onClick={actionButton.onClick}
          disabled={actionButton.isLoading}
          className="mt-4 px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
        >
          {actionButton.isLoading ? (
            <>
              <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <span>同步中...</span>
            </>
          ) : (
            actionButton.label
          )}
        </button>
      )}
    </div>
  );
}

interface ChartDataLimitedBannerProps {
  currentDays: number;
  minDays: number;
  onSync?: () => void;
  isSyncing?: boolean;
}

export function ChartDataLimitedBanner({
  currentDays,
  minDays,
  onSync,
  isSyncing = false
}: ChartDataLimitedBannerProps) {
  return (
    <div className="bg-yellow-900/20 border border-yellow-600/50 rounded-lg p-4 mb-4">
      <div className="flex items-start gap-3">
        <span className="text-2xl">⚠️</span>
        <div className="flex-1">
          <h3 className="font-semibold text-yellow-400">📊 資料收集中</h3>
          <p className="text-sm text-gray-300 mt-1">
            目前僅有 <strong>{currentDays}</strong> 天的訂閱數據。為獲得可靠的趨勢分析，建議至少收集{' '}
            <strong>{minDays}</strong> 天數據。
          </p>
          {onSync && (
            <button
              onClick={onSync}
              disabled={isSyncing}
              className="mt-3 px-4 py-2 bg-yellow-600 hover:bg-yellow-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
            >
              {isSyncing ? (
                <>
                  <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <span>同步中...</span>
                </>
              ) : (
                '立即同步訂閱數據'
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function ChartEstimatedBadge() {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-1 bg-blue-900/40 border border-blue-500/60 rounded text-xs text-blue-200">
      <span role="img" aria-label="estimate">⚠️</span>
      <span>估算</span>
    </span>
  );
}
