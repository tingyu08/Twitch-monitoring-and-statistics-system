/**
 * 資料庫操作重試輔助函數
 * 專門處理 Turso 遠端資料庫的暫時性錯誤（502, 503, 超時等）
 */

import { logger } from "./logger";

interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  shouldRetry?: (error: unknown) => boolean;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxRetries: 3,
  initialDelayMs: 500,
  maxDelayMs: 5000,
  backoffMultiplier: 2,
  shouldRetry: (error: unknown) => {
    // 檢查是否為可重試的錯誤
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      return (
        message.includes("502") ||
        message.includes("503") ||
        message.includes("400") ||           // Turso 暫時性錯誤
        message.includes("404") ||           // Turso 連線問題也可能返回 404
        message.includes("bad gateway") ||
        message.includes("service unavailable") ||
        message.includes("timeout") ||
        message.includes("econnreset") ||
        message.includes("etimedout") ||
        message.includes("enotfound") ||
        message.includes("network") ||
        message.includes("fetch failed") ||  // 網路層級錯誤
        message.includes("server_error") ||  // Turso SERVER_ERROR
        message.includes("batch request")    // 批次請求錯誤
      );
    }
    return false;
  },
};

/**
 * 使用指數退避策略重試資料庫操作
 */
export async function retryDatabaseOperation<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: unknown;
  let delay = opts.initialDelayMs;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      // 如果不應該重試，或已達到最大重試次數，直接拋出錯誤
      if (!opts.shouldRetry(error) || attempt === opts.maxRetries) {
        throw error;
      }

      // 記錄重試資訊（使用 debug 級別減少日誌噪音）
      logger.debug(
        "DB Retry",
        `資料庫操作失敗，將在 ${delay}ms 後重試 (嘗試 ${attempt + 1}/${opts.maxRetries}): ${
          error instanceof Error ? error.message.substring(0, 50) : String(error)
        }`
      );

      // 等待後重試
      await new Promise((resolve) => setTimeout(resolve, delay));

      // 指數退避，但不超過最大延遲
      delay = Math.min(delay * opts.backoffMultiplier, opts.maxDelayMs);
    }
  }

  // 理論上不會執行到這裡，但為了 TypeScript 類型安全
  throw lastError;
}

/**
 * 批次操作輔助函數，將大批次分割成小批次處理
 * 每個小批次之間有延遲，避免壓垮遠端資料庫
 */
export async function batchOperation<T, R>(
  items: T[],
  operation: (batch: T[]) => Promise<R>,
  options: {
    batchSize?: number;
    delayBetweenBatchesMs?: number;
    onBatchComplete?: (batchIndex: number, total: number) => void;
    fallbackToSingleOnBatchFailure?: boolean;
  } = {}
): Promise<R[]> {
  const {
    batchSize = 10, // Turso Free Tier 優化：減小批次大小
    delayBetweenBatchesMs = 200,
    onBatchComplete,
    fallbackToSingleOnBatchFailure = true,
  } = options;

  const results: R[] = [];
  const totalBatches = Math.ceil(items.length / batchSize);

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchIndex = Math.floor(i / batchSize) + 1;

    try {
      const result = await retryDatabaseOperation(() => operation(batch));
      results.push(result);

      if (onBatchComplete) {
        onBatchComplete(batchIndex, totalBatches);
      }
    } catch (error) {
      logger.error(
        "DB Batch",
        `批次 ${batchIndex}/${totalBatches} 處理失敗`,
        error
      );

      if (fallbackToSingleOnBatchFailure && batch.length > 1) {
        logger.warn("DB Batch", `批次 ${batchIndex} 進入逐筆降級重試模式`);

        for (const item of batch) {
          try {
            const singleResult = await retryDatabaseOperation(() => operation([item]));
            results.push(singleResult);
          } catch (singleError) {
            logger.error("DB Batch", `批次 ${batchIndex} 逐筆重試仍失敗，已跳過一筆資料`, singleError);
          }
        }
      }

      // 繼續處理下一批，不中斷整個流程
    }

    // 批次之間延遲，避免壓垮資料庫
    if (i + batchSize < items.length) {
      await new Promise((resolve) => setTimeout(resolve, delayBetweenBatchesMs));
    }
  }

  return results;
}
