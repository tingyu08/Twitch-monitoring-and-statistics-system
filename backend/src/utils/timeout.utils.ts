/**
 * Timeout Utilities
 *
 * 提供 Promise 超時保護功能，用於防止外部 API 呼叫無限等待。
 *
 * @module timeout.utils
 * @example
 * ```typescript
 * import { withTimeout, API_TIMEOUT_MS } from './timeout.utils';
 *
 * // 基本用法
 * const result = await withTimeout(
 *   fetchData(),
 *   API_TIMEOUT_MS.MEDIUM,
 *   'Data fetch timed out'
 * );
 *
 * // 錯誤處理
 * try {
 *   await withTimeout(slowOperation(), 5000);
 * } catch (error) {
 *   if (isTimeoutError(error)) {
 *     console.log('Operation timed out');
 *   }
 * }
 * ```
 */

/**
 * 為 Promise 添加超時保護
 *
 * @template T - Promise 回傳的類型
 * @param {Promise<T>} promise - 要執行的 Promise
 * @param {number} timeoutMs - 超時時間（毫秒）
 * @param {string} [errorMessage='Operation timed out'] - 超時時的錯誤訊息
 * @returns {Promise<T>} Promise 結果
 * @throws {TimeoutError} 當操作超時時拋出
 *
 * @example
 * ```typescript
 * const channelInfo = await withTimeout(
 *   twitchApi.getChannel('user123'),
 *   10000,
 *   'Twitch API request timed out'
 * );
 * ```
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage = "Operation timed out"
): Promise<T> {
  let timeoutId: NodeJS.Timeout | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new TimeoutError(errorMessage, timeoutMs));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    return result;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * 自定義超時錯誤類
 *
 * @class TimeoutError
 * @extends {Error}
 *
 * @property {number} timeoutMs - 設定的超時時間（毫秒）
 * @property {boolean} isTimeout - 用於類型檢查的標記，始終為 true
 *
 * @example
 * ```typescript
 * throw new TimeoutError('API request timed out', 10000);
 * ```
 */
export class TimeoutError extends Error {
  public readonly timeoutMs: number;
  public readonly isTimeout = true;

  constructor(message: string, timeoutMs: number) {
    super(message);
    this.name = "TimeoutError";
    this.timeoutMs = timeoutMs;
    Object.setPrototypeOf(this, TimeoutError.prototype);
  }
}

/**
 * 判斷錯誤是否為超時錯誤
 *
 * @param {unknown} error - 要檢查的錯誤物件
 * @returns {boolean} 如果是 TimeoutError 則回傳 true
 *
 * @example
 * ```typescript
 * try {
 *   await withTimeout(operation(), 5000);
 * } catch (error) {
 *   if (isTimeoutError(error)) {
 *     // 處理超時情況
 *   }
 * }
 * ```
 */
export function isTimeoutError(error: unknown): error is TimeoutError {
  return error instanceof TimeoutError || (error instanceof Error && "isTimeout" in error);
}

/**
 * API 請求的預設超時時間（毫秒）
 *
 * @constant
 * @property {number} SHORT - 5 秒，適用於簡單查詢
 * @property {number} MEDIUM - 10 秒，適用於一般 API 呼叫
 * @property {number} LONG - 30 秒，適用於複雜查詢或批量操作
 *
 * @example
 * ```typescript
 * // 簡單查詢使用 SHORT
 * await withTimeout(simpleQuery(), API_TIMEOUT_MS.SHORT);
 *
 * // 批量操作使用 LONG
 * await withTimeout(batchOperation(), API_TIMEOUT_MS.LONG);
 * ```
 */
export const API_TIMEOUT_MS = {
  SHORT: 5000, // 5 秒 - 簡單查詢
  MEDIUM: 10000, // 10 秒 - 一般 API 呼叫
  LONG: 30000, // 30 秒 - 複雜查詢或批量操作
};
