/**
 * Memory Thresholds Configuration
 *
 * 統一的記憶體閾值常數，針對 Zeabur 免費層的 512MB RAM 限制進行優化。
 * 所有記憶體相關的監控和保護機制應使用這些統一的閾值，確保一致性。
 *
 * @module memory-thresholds
 *
 * @example
 * ```typescript
 * import { MEMORY_THRESHOLDS, isMemorySafe, isMemoryCritical } from './memory-thresholds';
 *
 * // 檢查記憶體狀態
 * if (isMemoryCritical()) {
 *   // 清理快取或停止非必要操作
 * }
 *
 * // 使用閾值常數
 * if (currentMemoryMB > MEMORY_THRESHOLDS.WARNING_MB) {
 *   logger.warn('Memory usage is high');
 * }
 * ```
 */

// 環境變數覆蓋，或使用預設值
export const MEMORY_THRESHOLDS = {
  /**
   * 警告閾值 (MB) - 約 50% RAM
   * 達到此閾值時觸發 GC 和警告日誌
   */
  WARNING_MB: parseInt(process.env.MEMORY_WARNING_MB || "350"),

  /**
   * 危險閾值 (MB) - 約 70% RAM
   * 達到此閾值時強制清理快取
   */
  CRITICAL_MB: parseInt(process.env.MEMORY_CRITICAL_MB || "420"),

  /**
   * 最大閾值 (MB) - 約 80% RAM
   * 達到此閾值時應該停止新任務
   */
  MAX_MB: parseInt(process.env.MEMORY_MAX_MB || "450"),

  /**
   * GC 觸發閾值 (MB)
   * 記憶體超過此值時自動觸發 GC
   */
  GC_TRIGGER_MB: parseInt(process.env.MEMORY_GC_TRIGGER_MB || "380"),
} as const;

/**
 * 檢查當前記憶體是否安全（低於警告閾值）
 *
 * @returns {boolean} 如果記憶體使用量低於 WARNING_MB 則回傳 true
 *
 * @example
 * ```typescript
 * if (isMemorySafe()) {
 *   // 可以執行記憶體密集型操作
 * }
 * ```
 */
export function isMemorySafe(): boolean {
  const rss = process.memoryUsage().rss / 1024 / 1024;
  return rss < MEMORY_THRESHOLDS.WARNING_MB;
}

/**
 * 檢查當前記憶體是否處於危險狀態（達到或超過危險閾值）
 *
 * @returns {boolean} 如果記憶體使用量達到或超過 CRITICAL_MB 則回傳 true
 *
 * @example
 * ```typescript
 * if (isMemoryCritical()) {
 *   cacheManager.clear(); // 強制清理快取
 *   global.gc?.(); // 觸發 GC
 * }
 * ```
 */
export function isMemoryCritical(): boolean {
  const rss = process.memoryUsage().rss / 1024 / 1024;
  return rss >= MEMORY_THRESHOLDS.CRITICAL_MB;
}

/**
 * 檢查是否應該停止新任務（達到或超過最大閾值）
 *
 * @returns {boolean} 如果記憶體使用量達到或超過 MAX_MB 則回傳 true
 *
 * @example
 * ```typescript
 * if (shouldStopNewTasks()) {
 *   logger.warn('Memory too high, skipping new task');
 *   return;
 * }
 * ```
 */
export function shouldStopNewTasks(): boolean {
  const rss = process.memoryUsage().rss / 1024 / 1024;
  return rss >= MEMORY_THRESHOLDS.MAX_MB;
}

/**
 * 取得當前 Heap 記憶體使用量
 *
 * @returns {number} 當前記憶體使用量（MB），四捨五入為整數
 *
 * @example
 * ```typescript
 * const memoryMB = getCurrentMemoryMB();
 * logger.info(`Current memory usage: ${memoryMB}MB`);
 * ```
 */
export function getCurrentMemoryMB(): number {
  return Math.round(process.memoryUsage().rss / 1024 / 1024);
}
