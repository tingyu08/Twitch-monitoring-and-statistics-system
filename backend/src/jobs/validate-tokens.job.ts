/**
 * Validate Tokens Job
 *
 * 定期驗證所有活躍的 Twitch Token 有效性
 * - 每日執行一次（建議在低流量時段）
 * - 標記失效的 Token
 * - 記錄驗證結果
 */

import { tokenValidationService } from "../services/token-validation.service";
import { logger } from "../utils/logger";
import { captureJobError } from "./job-error-tracker";

// Job 配置
const JOB_NAME = "ValidateTokensJob";
const DEFAULT_INTERVAL_HOURS = 24; // 預設每 24 小時執行一次

interface JobResult {
  success: boolean;
  startTime: Date;
  endTime: Date;
  durationMs: number;
  stats: {
    total: number;
    valid: number;
    invalid: number;
  };
  errors: string[];
}

let lastRunResult: JobResult | null = null;
let currentRunPromise: Promise<JobResult> | null = null;

/**
 * 執行 Token 驗證任務
 */
export async function validateTokensJob(): Promise<JobResult> {
  if (currentRunPromise) {
    logger.warn(JOB_NAME, "任務已在執行中，回傳既有執行結果 Promise");
    return currentRunPromise;
  }

  currentRunPromise = executeValidateTokensJob();

  try {
    return await currentRunPromise;
  } finally {
    currentRunPromise = null;
  }
}

async function executeValidateTokensJob(): Promise<JobResult> {
  const startTime = new Date();
  logger.info(JOB_NAME, "開始執行 Token 驗證任務");

  try {
    // 驗證所有活躍的 Token
    const result = await tokenValidationService.validateAllActiveTokens();

    const endTime = new Date();
    const durationMs = endTime.getTime() - startTime.getTime();

    const jobResult: JobResult = {
      success: true,
      startTime,
      endTime,
      durationMs,
      stats: {
        total: result.total,
        valid: result.valid,
        invalid: result.invalid,
      },
      errors: result.errors,
    };

    lastRunResult = jobResult;

    logger.info(
      JOB_NAME,
      `任務完成，耗時 ${durationMs}ms。有效: ${result.valid}, 無效: ${result.invalid}`,
      { stats: jobResult.stats }
    );

    // 如果有大量失效的 Token，記錄警告
    if (result.invalid > 0) {
      const invalidRate = (result.invalid / result.total) * 100;
      if (invalidRate > 10) {
        logger.warn(
          JOB_NAME,
          `Token 失效率過高: ${invalidRate.toFixed(1)}% (${result.invalid}/${result.total})`
        );
      }
    }

    return jobResult;
  } catch (error) {
    const endTime = new Date();
    const durationMs = endTime.getTime() - startTime.getTime();

    const jobResult: JobResult = {
      success: false,
      startTime,
      endTime,
      durationMs,
      stats: { total: 0, valid: 0, invalid: 0 },
      errors: [error instanceof Error ? error.message : "Unknown error"],
    };

    lastRunResult = jobResult;

    logger.error(JOB_NAME, "任務執行失敗", error);
    captureJobError("validate-tokens", error);
    return jobResult;
  }
}

/**
 * 獲取上次執行結果
 */
export function getLastRunResult(): JobResult | null {
  return lastRunResult;
}

/**
 * 獲取 Token 狀態統計
 */
export async function getTokenStatusStats(): Promise<Record<string, number>> {
  return tokenValidationService.getTokenStats();
}

/**
 * 手動觸發驗證特定 Token
 */
export async function validateSingleToken(tokenId: string): Promise<{
  isValid: boolean;
  status: string;
  message: string;
}> {
  const result = await tokenValidationService.validateAndUpdateToken(tokenId);
  return {
    isValid: result.isValid,
    status: result.status,
    message: result.message,
  };
}

// 導出 Job 配置供排程器使用
export const validateTokensJobConfig = {
  name: JOB_NAME,
  intervalHours: DEFAULT_INTERVAL_HOURS,
  handler: validateTokensJob,
};
