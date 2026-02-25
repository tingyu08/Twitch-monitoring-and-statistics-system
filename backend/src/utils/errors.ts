/**
 * Application Error Classes
 *
 * 統一的錯誤處理類別，提供一致的錯誤格式和 HTTP 狀態碼映射
 */

/**
 * 基礎應用程式錯誤類別
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly isOperational: boolean;

  constructor(
    message: string,
    statusCode = 500,
    code = "INTERNAL_ERROR",
    isOperational = true
  ) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational; // 可預期的錯誤 vs 程式 bug
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * 400 Bad Request - 請求參數錯誤
 */
export class BadRequestError extends AppError {
  constructor(message = "Bad Request", code = "BAD_REQUEST") {
    super(message, 400, code);
    this.name = "BadRequestError";
  }
}

/**
 * 401 Unauthorized - 未授權
 */
export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized", code = "UNAUTHORIZED") {
    super(message, 401, code);
    this.name = "UnauthorizedError";
  }
}

/**
 * 403 Forbidden - 禁止存取
 */
export class ForbiddenError extends AppError {
  constructor(message = "Forbidden", code = "FORBIDDEN") {
    super(message, 403, code);
    this.name = "ForbiddenError";
  }
}

/**
 * 404 Not Found - 資源不存在
 */
export class NotFoundError extends AppError {
  constructor(message = "Not Found", code = "NOT_FOUND") {
    super(message, 404, code);
    this.name = "NotFoundError";
  }
}

/**
 * 409 Conflict - 資源衝突
 */
export class ConflictError extends AppError {
  constructor(message = "Conflict", code = "CONFLICT") {
    super(message, 409, code);
    this.name = "ConflictError";
  }
}

/**
 * 422 Unprocessable Entity - 資料驗證失敗
 */
export class ValidationError extends AppError {
  public readonly errors?: Record<string, string[]>;

  constructor(message = "Validation Error", errors?: Record<string, string[]>) {
    super(message, 422, "VALIDATION_ERROR");
    this.name = "ValidationError";
    this.errors = errors;
  }
}

/**
 * 429 Too Many Requests - 請求過於頻繁
 */
export class RateLimitError extends AppError {
  public readonly retryAfter?: number;

  constructor(message = "Too Many Requests", retryAfter?: number) {
    super(message, 429, "RATE_LIMIT_EXCEEDED");
    this.name = "RateLimitError";
    this.retryAfter = retryAfter;
  }
}

/**
 * 503 Service Unavailable - 服務暫時不可用
 */
export class ServiceUnavailableError extends AppError {
  constructor(message = "Service Unavailable", code = "SERVICE_UNAVAILABLE") {
    super(message, 503, code);
    this.name = "ServiceUnavailableError";
  }
}

/**
 * 504 Gateway Timeout - 上游服務超時
 */
export class GatewayTimeoutError extends AppError {
  constructor(message = "Gateway Timeout", code = "GATEWAY_TIMEOUT") {
    super(message, 504, code);
    this.name = "GatewayTimeoutError";
  }
}

/**
 * 外部服務錯誤（如 Twitch API）
 */
export class ExternalServiceError extends AppError {
  public readonly service: string;
  public readonly originalError?: Error;

  constructor(service: string, message: string, originalError?: Error) {
    super(message, 502, "EXTERNAL_SERVICE_ERROR");
    this.name = "ExternalServiceError";
    this.service = service;
    this.originalError = originalError;
  }
}

/**
 * 資料庫錯誤
 */
export class DatabaseError extends AppError {
  public readonly originalError?: Error;

  constructor(message = "Database Error", originalError?: Error) {
    super(message, 500, "DATABASE_ERROR", false); // 非預期錯誤
    this.name = "DatabaseError";
    this.originalError = originalError;
  }
}

// ========== 類型守衛 ==========

/**
 * 檢查錯誤是否為 AppError
 */
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/**
 * 檢查錯誤是否為可預期的操作性錯誤
 */
export function isOperationalError(error: unknown): boolean {
  if (error instanceof AppError) {
    return error.isOperational;
  }
  return false;
}

// ========== 錯誤回應格式化 ==========

export interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    errors?: Record<string, string[]>;
    retryAfter?: number;
  };
}

/**
 * 將錯誤轉換為標準的 API 回應格式
 */
export function formatErrorResponse(error: unknown): { status: number; body: ErrorResponse } {
  if (error instanceof AppError) {
    const body: ErrorResponse = {
      success: false,
      error: {
        code: error.code,
        message: error.message,
      },
    };

    // 加入額外資訊
    if (error instanceof ValidationError && error.errors) {
      body.error.errors = error.errors;
    }
    if (error instanceof RateLimitError && error.retryAfter) {
      body.error.retryAfter = error.retryAfter;
    }

    return { status: error.statusCode, body };
  }

  // 未知錯誤
  return {
    status: 500,
    body: {
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: process.env.NODE_ENV === "production" 
          ? "An unexpected error occurred" 
          : (error instanceof Error ? error.message : "Unknown error"),
      },
    },
  };
}
