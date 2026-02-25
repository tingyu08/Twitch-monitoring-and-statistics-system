/**
 * errors.ts 單元測試
 *
 * 測試範圍：
 * - 所有 AppError 子類別的建構與屬性
 * - isAppError / isOperationalError 類型守衛
 * - formatErrorResponse 錯誤格式化
 */

import {
  AppError,
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  ValidationError,
  RateLimitError,
  ServiceUnavailableError,
  GatewayTimeoutError,
  ExternalServiceError,
  DatabaseError,
  isAppError,
  isOperationalError,
  formatErrorResponse,
} from "../errors";

describe("AppError", () => {
  it("應使用預設值建立錯誤", () => {
    const err = new AppError("Something went wrong");
    expect(err.message).toBe("Something went wrong");
    expect(err.statusCode).toBe(500);
    expect(err.code).toBe("INTERNAL_ERROR");
    expect(err.isOperational).toBe(true);
    expect(err.name).toBe("AppError");
  });

  it("應使用自訂參數建立錯誤", () => {
    const err = new AppError("Custom error", 418, "TEAPOT", false);
    expect(err.statusCode).toBe(418);
    expect(err.code).toBe("TEAPOT");
    expect(err.isOperational).toBe(false);
  });

  it("應為 Error 的實例", () => {
    const err = new AppError("test");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AppError);
  });

  it("應有 stack trace", () => {
    const err = new AppError("test");
    expect(err.stack).toBeDefined();
  });
});

describe("BadRequestError", () => {
  it("應使用預設值建立 400 錯誤", () => {
    const err = new BadRequestError();
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe("BAD_REQUEST");
    expect(err.message).toBe("Bad Request");
    expect(err.name).toBe("BadRequestError");
  });

  it("應使用自訂訊息建立錯誤", () => {
    const err = new BadRequestError("Invalid input", "INVALID_INPUT");
    expect(err.message).toBe("Invalid input");
    expect(err.code).toBe("INVALID_INPUT");
  });
});

describe("UnauthorizedError", () => {
  it("應使用預設值建立 401 錯誤", () => {
    const err = new UnauthorizedError();
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe("UNAUTHORIZED");
    expect(err.name).toBe("UnauthorizedError");
  });

  it("應使用自訂訊息建立錯誤", () => {
    const err = new UnauthorizedError("Token expired");
    expect(err.message).toBe("Token expired");
  });
});

describe("ForbiddenError", () => {
  it("應使用預設值建立 403 錯誤", () => {
    const err = new ForbiddenError();
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe("FORBIDDEN");
    expect(err.name).toBe("ForbiddenError");
  });
});

describe("NotFoundError", () => {
  it("應使用預設值建立 404 錯誤", () => {
    const err = new NotFoundError();
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe("NOT_FOUND");
    expect(err.name).toBe("NotFoundError");
  });

  it("應使用自訂訊息建立錯誤", () => {
    const err = new NotFoundError("User not found");
    expect(err.message).toBe("User not found");
  });
});

describe("ConflictError", () => {
  it("應使用預設值建立 409 錯誤", () => {
    const err = new ConflictError();
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe("CONFLICT");
    expect(err.name).toBe("ConflictError");
  });
});

describe("ValidationError", () => {
  it("應使用預設值建立 422 錯誤", () => {
    const err = new ValidationError();
    expect(err.statusCode).toBe(422);
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.name).toBe("ValidationError");
    expect(err.errors).toBeUndefined();
  });

  it("應儲存驗證錯誤詳情", () => {
    const errors = { email: ["Invalid email format"], name: ["Name is required"] };
    const err = new ValidationError("Validation failed", errors);
    expect(err.errors).toEqual(errors);
    expect(err.message).toBe("Validation failed");
  });
});

describe("RateLimitError", () => {
  it("應使用預設值建立 429 錯誤", () => {
    const err = new RateLimitError();
    expect(err.statusCode).toBe(429);
    expect(err.code).toBe("RATE_LIMIT_EXCEEDED");
    expect(err.name).toBe("RateLimitError");
    expect(err.retryAfter).toBeUndefined();
  });

  it("應儲存 retryAfter 值", () => {
    const err = new RateLimitError("Slow down", 60);
    expect(err.retryAfter).toBe(60);
    expect(err.message).toBe("Slow down");
  });
});

describe("ServiceUnavailableError", () => {
  it("應使用預設值建立 503 錯誤", () => {
    const err = new ServiceUnavailableError();
    expect(err.statusCode).toBe(503);
    expect(err.code).toBe("SERVICE_UNAVAILABLE");
    expect(err.name).toBe("ServiceUnavailableError");
  });
});

describe("GatewayTimeoutError", () => {
  it("應使用預設值建立 504 錯誤", () => {
    const err = new GatewayTimeoutError();
    expect(err.statusCode).toBe(504);
    expect(err.code).toBe("GATEWAY_TIMEOUT");
    expect(err.name).toBe("GatewayTimeoutError");
  });
});

describe("ExternalServiceError", () => {
  it("應儲存 service 名稱與原始錯誤", () => {
    const original = new Error("Network error");
    const err = new ExternalServiceError("TwitchAPI", "API call failed", original);
    expect(err.statusCode).toBe(502);
    expect(err.code).toBe("EXTERNAL_SERVICE_ERROR");
    expect(err.service).toBe("TwitchAPI");
    expect(err.originalError).toBe(original);
    expect(err.name).toBe("ExternalServiceError");
  });

  it("originalError 可以不傳", () => {
    const err = new ExternalServiceError("TwitchAPI", "API call failed");
    expect(err.originalError).toBeUndefined();
  });
});

describe("DatabaseError", () => {
  it("應使用預設值建立資料庫錯誤（非操作性錯誤）", () => {
    const err = new DatabaseError();
    expect(err.statusCode).toBe(500);
    expect(err.code).toBe("DATABASE_ERROR");
    expect(err.isOperational).toBe(false);
    expect(err.name).toBe("DatabaseError");
  });

  it("應儲存原始錯誤", () => {
    const original = new Error("Connection refused");
    const err = new DatabaseError("DB connection failed", original);
    expect(err.originalError).toBe(original);
    expect(err.message).toBe("DB connection failed");
  });
});

describe("isAppError", () => {
  it("AppError 實例應回傳 true", () => {
    expect(isAppError(new AppError("test"))).toBe(true);
    expect(isAppError(new NotFoundError())).toBe(true);
    expect(isAppError(new BadRequestError())).toBe(true);
  });

  it("非 AppError 應回傳 false", () => {
    expect(isAppError(new Error("test"))).toBe(false);
    expect(isAppError("string error")).toBe(false);
    expect(isAppError(null)).toBe(false);
    expect(isAppError(undefined)).toBe(false);
    expect(isAppError(42)).toBe(false);
  });
});

describe("isOperationalError", () => {
  it("操作性 AppError 應回傳 true", () => {
    expect(isOperationalError(new NotFoundError())).toBe(true);
    expect(isOperationalError(new BadRequestError())).toBe(true);
    expect(isOperationalError(new AppError("test", 500, "CODE", true))).toBe(true);
  });

  it("非操作性 AppError 應回傳 false", () => {
    expect(isOperationalError(new DatabaseError())).toBe(false);
    expect(isOperationalError(new AppError("test", 500, "CODE", false))).toBe(false);
  });

  it("非 AppError 應回傳 false", () => {
    expect(isOperationalError(new Error("test"))).toBe(false);
    expect(isOperationalError("string")).toBe(false);
    expect(isOperationalError(null)).toBe(false);
  });
});

describe("formatErrorResponse", () => {
  it("應格式化 AppError 為標準回應", () => {
    const err = new NotFoundError("User not found");
    const result = formatErrorResponse(err);
    expect(result.status).toBe(404);
    expect(result.body.success).toBe(false);
    expect(result.body.error.code).toBe("NOT_FOUND");
    expect(result.body.error.message).toBe("User not found");
  });

  it("應在 ValidationError 中包含 errors 詳情", () => {
    const errors = { email: ["Invalid email"] };
    const err = new ValidationError("Validation failed", errors);
    const result = formatErrorResponse(err);
    expect(result.status).toBe(422);
    expect(result.body.error.errors).toEqual(errors);
  });

  it("沒有 errors 的 ValidationError 不應包含 errors 欄位", () => {
    const err = new ValidationError("Validation failed");
    const result = formatErrorResponse(err);
    expect(result.body.error.errors).toBeUndefined();
  });

  it("應在 RateLimitError 中包含 retryAfter", () => {
    const err = new RateLimitError("Too many requests", 30);
    const result = formatErrorResponse(err);
    expect(result.status).toBe(429);
    expect(result.body.error.retryAfter).toBe(30);
  });

  it("沒有 retryAfter 的 RateLimitError 不應包含 retryAfter 欄位", () => {
    const err = new RateLimitError("Too many requests");
    const result = formatErrorResponse(err);
    expect(result.body.error.retryAfter).toBeUndefined();
  });

  it("應在非生產環境中格式化未知 Error", () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";
    const result = formatErrorResponse(new Error("Unexpected failure"));
    expect(result.status).toBe(500);
    expect(result.body.error.code).toBe("INTERNAL_ERROR");
    expect(result.body.error.message).toBe("Unexpected failure");
    process.env.NODE_ENV = originalEnv;
  });

  it("應在生產環境中隱藏未知錯誤訊息", () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const result = formatErrorResponse(new Error("Internal secret"));
    expect(result.status).toBe(500);
    expect(result.body.error.message).toBe("An unexpected error occurred");
    process.env.NODE_ENV = originalEnv;
  });

  it("應處理非 Error 類型的未知錯誤", () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";
    const result = formatErrorResponse("just a string");
    expect(result.status).toBe(500);
    expect(result.body.error.message).toBe("Unknown error");
    process.env.NODE_ENV = originalEnv;
  });
});
