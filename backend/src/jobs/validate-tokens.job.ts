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

/**
 * 執行 Token 驗證任務
 */
export async function validateTokensJob(): Promise<JobResult> {
  const startTime = new Date();
  logger.info(JOB_NAME, "Starting token validation job");

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
      `Job completed in ${durationMs}ms. Valid: ${result.valid}, Invalid: ${result.invalid}`,
      { stats: jobResult.stats }
    );

    // 如果有大量失效的 Token，記錄警告
    if (result.invalid > 0) {
      const invalidRate = (result.invalid / result.total) * 100;
      if (invalidRate > 10) {
        logger.warn(
          JOB_NAME,
          `High token failure rate: ${invalidRate.toFixed(1)}% (${result.invalid}/${result.total})`
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

    logger.error(JOB_NAME, "Job failed", error);
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
