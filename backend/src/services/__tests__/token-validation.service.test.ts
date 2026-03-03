/**
 * TokenValidationService 單元測試
 */

// 設置環境變數避免 delay 造成測試等待
process.env.TOKEN_VALIDATION_DELAY_MS = "0";

jest.mock("../../db/prisma", () => ({
  prisma: {
    twitchToken: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      groupBy: jest.fn(),
    },
  },
}));

jest.mock("axios");

jest.mock("../../utils/logger", () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock("../../utils/crypto.utils", () => ({
  decryptToken: jest.fn((t: string) => `decrypted_${t}`),
}));

import axios from "axios";
import { prisma } from "../../db/prisma";
import { logger } from "../../utils/logger";
import { decryptToken } from "../../utils/crypto.utils";
import { tokenValidationService, TokenStatus } from "../token-validation.service";

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedFindUnique = prisma.twitchToken.findUnique as jest.Mock;
const mockedFindFirst = prisma.twitchToken.findFirst as jest.Mock;
const mockedFindMany = prisma.twitchToken.findMany as jest.Mock;
const mockedUpdate = prisma.twitchToken.update as jest.Mock;
const mockedGroupBy = prisma.twitchToken.groupBy as jest.Mock;
const mockedDecryptToken = decryptToken as jest.Mock;

// 輔助：建立假 token DB 記錄
function makeToken(overrides: Partial<{
  id: string;
  accessToken: string;
  status: string;
  failureCount: number;
  lastValidatedAt: Date | null;
  ownerType: string;
  streamerId: string | null;
  viewerId: string | null;
  refreshToken: string | null;
}> = {}) {
  return {
    id: "token-1",
    accessToken: "encrypted_access",
    status: TokenStatus.ACTIVE,
    failureCount: 0,
    lastValidatedAt: null,
    ownerType: "streamer",
    streamerId: "streamer-1",
    viewerId: null,
    refreshToken: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.resetAllMocks();
  // 重置 decryptToken 的 mock 實作（resetAllMocks 會清除 mock 實作）
  (decryptToken as jest.Mock).mockImplementation((t: string) => `decrypted_${t}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// validateToken
// ─────────────────────────────────────────────────────────────────────────────
describe("validateToken", () => {
  it("returns isValid:true and status:ACTIVE when Twitch API returns 200", async () => {
    mockedAxios.get.mockResolvedValue({
      status: 200,
      data: { client_id: "c1", login: "user", scopes: [], user_id: "u1", expires_in: 3600 },
    });

    const result = await tokenValidationService.validateToken("someToken");

    expect(result.isValid).toBe(true);
    expect(result.status).toBe(TokenStatus.ACTIVE);
    expect(result.shouldRetry).toBe(false);
    expect(result.message).toContain("3600");
  });

  it("returns isValid:false, status:EXPIRED, shouldRetry:true when 401 with expired message", async () => {
    mockedAxios.get.mockResolvedValue({
      status: 401,
      data: { message: "Token has expired" },
    });

    const result = await tokenValidationService.validateToken("someToken");

    expect(result.isValid).toBe(false);
    expect(result.status).toBe(TokenStatus.EXPIRED);
    expect(result.shouldRetry).toBe(true);
  });

  it("returns isValid:false, status:INVALID, shouldRetry:false when 401 with non-expired message", async () => {
    mockedAxios.get.mockResolvedValue({
      status: 401,
      data: { message: "Invalid access token" },
    });

    const result = await tokenValidationService.validateToken("someToken");

    expect(result.isValid).toBe(false);
    expect(result.status).toBe(TokenStatus.INVALID);
    expect(result.shouldRetry).toBe(false);
    expect(result.message).toBe("Invalid access token");
  });

  it("returns isValid:false, shouldRetry:true when status code is 500", async () => {
    mockedAxios.get.mockResolvedValue({
      status: 500,
      data: {},
    });

    const result = await tokenValidationService.validateToken("someToken");

    expect(result.isValid).toBe(false);
    expect(result.shouldRetry).toBe(true);
    expect(result.message).toContain("500");
  });

  it("passes validateStatus callback that accepts status codes below 500", async () => {
    mockedAxios.get.mockResolvedValue({
      status: 200,
      data: { client_id: "c1", login: "user", scopes: [], user_id: "u1", expires_in: 60 },
    });

    await tokenValidationService.validateToken("someToken");

    const config = mockedAxios.get.mock.calls[0][1] as {
      validateStatus: (status: number) => boolean;
    };

    expect(config.validateStatus(499)).toBe(true);
    expect(config.validateStatus(500)).toBe(false);
  });

  it("returns isValid:false, shouldRetry:true when axios throws an error", async () => {
    mockedAxios.get.mockRejectedValue(new Error("Network error"));

    const result = await tokenValidationService.validateToken("someToken");

    expect(result.isValid).toBe(false);
    expect(result.shouldRetry).toBe(true);
    expect(result.message).toBe("Network error");
    expect(logger.error).toHaveBeenCalled();
  });

  it("returns Unknown error when axios rejects with a non-Error value", async () => {
    mockedAxios.get.mockRejectedValue("non-error-rejection");

    const result = await tokenValidationService.validateToken("someToken");

    expect(result.isValid).toBe(false);
    expect(result.shouldRetry).toBe(true);
    expect(result.message).toBe("Unknown error");
  });

  it("uses default message when 401 response has no message body", async () => {
    mockedAxios.get.mockResolvedValue({
      status: 401,
      data: null,
    });

    const result = await tokenValidationService.validateToken("someToken");

    expect(result.isValid).toBe(false);
    expect(result.status).toBe(TokenStatus.INVALID);
    expect(result.shouldRetry).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// validateAndUpdateToken
// ─────────────────────────────────────────────────────────────────────────────
describe("validateAndUpdateToken", () => {
  it("returns invalid result when token not found in DB", async () => {
    mockedFindUnique.mockResolvedValue(null);

    const result = await tokenValidationService.validateAndUpdateToken("missing-id");

    expect(result.isValid).toBe(false);
    expect(result.status).toBe(TokenStatus.INVALID);
    expect(result.message).toContain("not found");
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it("skips DB update when token is ACTIVE, failureCount=0, and recently validated", async () => {
    // lastValidatedAt is very recent → skip update
    const recentTime = new Date(Date.now() - 1000); // 1 second ago
    const token = makeToken({
      status: TokenStatus.ACTIVE,
      failureCount: 0,
      lastValidatedAt: recentTime,
    });
    mockedFindUnique.mockResolvedValue(token);
    mockedAxios.get.mockResolvedValue({
      status: 200,
      data: { expires_in: 1000, client_id: "c", login: "l", scopes: [], user_id: "u" },
    });

    const result = await tokenValidationService.validateAndUpdateToken("token-1");

    expect(result.isValid).toBe(true);
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it("updates DB when token is valid but has never been validated (lastValidatedAt=null)", async () => {
    const token = makeToken({ status: TokenStatus.ACTIVE, failureCount: 0, lastValidatedAt: null });
    mockedFindUnique.mockResolvedValue(token);
    mockedAxios.get.mockResolvedValue({
      status: 200,
      data: { expires_in: 1000, client_id: "c", login: "l", scopes: [], user_id: "u" },
    });
    mockedUpdate.mockResolvedValue({});

    const result = await tokenValidationService.validateAndUpdateToken("token-1");

    expect(result.isValid).toBe(true);
    expect(mockedUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "token-1" },
        data: expect.objectContaining({ status: TokenStatus.ACTIVE, failureCount: 0 }),
      })
    );
  });

  it("updates DB when token is valid but failureCount > 0", async () => {
    const token = makeToken({ status: TokenStatus.ACTIVE, failureCount: 1, lastValidatedAt: null });
    mockedFindUnique.mockResolvedValue(token);
    mockedAxios.get.mockResolvedValue({
      status: 200,
      data: { expires_in: 500, client_id: "c", login: "l", scopes: [], user_id: "u" },
    });
    mockedUpdate.mockResolvedValue({});

    await tokenValidationService.validateAndUpdateToken("token-1");

    expect(mockedUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ failureCount: 0 }),
      })
    );
  });

  it("increments failureCount and keeps original status when failureCount < MAX (3)", async () => {
    const token = makeToken({ status: TokenStatus.ACTIVE, failureCount: 1 });
    mockedFindUnique.mockResolvedValue(token);
    mockedAxios.get.mockResolvedValue({
      status: 401,
      data: { message: "Invalid access token" },
    });
    mockedUpdate.mockResolvedValue({});

    const result = await tokenValidationService.validateAndUpdateToken("token-1");

    expect(result.isValid).toBe(false);
    expect(mockedUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          failureCount: 2,
          status: TokenStatus.ACTIVE, // 原始 status，因 newFailureCount(2) < MAX(3)
        }),
      })
    );
  });

  it("sets status from validation result when failureCount reaches MAX (3)", async () => {
    const token = makeToken({ status: TokenStatus.ACTIVE, failureCount: 2 });
    mockedFindUnique.mockResolvedValue(token);
    mockedAxios.get.mockResolvedValue({
      status: 401,
      data: { message: "Token has expired" },
    });
    mockedUpdate.mockResolvedValue({});

    const result = await tokenValidationService.validateAndUpdateToken("token-1");

    expect(result.isValid).toBe(false);
    expect(mockedUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          failureCount: 3,
          status: TokenStatus.EXPIRED, // 來自 result.status
        }),
      })
    );
    expect(logger.warn).toHaveBeenCalled();
  });

  it("uses decryptToken before calling validateToken", async () => {
    const token = makeToken({ accessToken: "raw_encrypted" });
    mockedFindUnique.mockResolvedValue(token);
    mockedAxios.get.mockResolvedValue({
      status: 200,
      data: { expires_in: 100, client_id: "c", login: "l", scopes: [], user_id: "u" },
    });
    mockedUpdate.mockResolvedValue({});

    await tokenValidationService.validateAndUpdateToken("token-1");

    expect(mockedDecryptToken).toHaveBeenCalledWith("raw_encrypted");
    expect(mockedAxios.get).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "OAuth decrypted_raw_encrypted",
        }),
      })
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// validateAllActiveTokens
// ─────────────────────────────────────────────────────────────────────────────
describe("validateAllActiveTokens", () => {
  it("returns total:0 when no active tokens exist", async () => {
    mockedFindMany.mockResolvedValue([]);

    const result = await tokenValidationService.validateAllActiveTokens();

    expect(result.total).toBe(0);
    expect(result.valid).toBe(0);
    expect(result.invalid).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it("correctly counts valid and invalid tokens in a batch", async () => {
    const batch = [
      { id: "t1", ownerType: "streamer", streamerId: "s1", viewerId: null },
      { id: "t2", ownerType: "viewer", streamerId: null, viewerId: "v1" },
    ];
    // First call returns batch, second call returns [] to end loop
    mockedFindMany.mockResolvedValueOnce(batch).mockResolvedValueOnce([]);

    // t1 → ACTIVE (valid), t2 → EXPIRED (invalid)
    mockedFindUnique
      .mockResolvedValueOnce(makeToken({ id: "t1", accessToken: "enc1" }))
      .mockResolvedValueOnce(makeToken({ id: "t2", accessToken: "enc2", status: TokenStatus.ACTIVE, failureCount: 0 }));

    mockedAxios.get
      .mockResolvedValueOnce({
        status: 200,
        data: { expires_in: 100, client_id: "c", login: "l", scopes: [], user_id: "u" },
      })
      .mockResolvedValueOnce({
        status: 401,
        data: { message: "Invalid access token" },
      });

    mockedUpdate.mockResolvedValue({});

    const result = await tokenValidationService.validateAllActiveTokens();

    expect(result.total).toBe(2);
    expect(result.valid).toBe(1);
    expect(result.invalid).toBe(1);
    expect(result.errors).toHaveLength(1);
  });

  it("counts token as invalid and adds to errors when validateAndUpdateToken throws", async () => {
    const batch = [{ id: "t-err", ownerType: "streamer", streamerId: "s1", viewerId: null }];
    mockedFindMany.mockResolvedValueOnce(batch).mockResolvedValueOnce([]);

    // Make validateAndUpdateToken throw by making findUnique throw
    mockedFindUnique.mockRejectedValueOnce(new Error("DB connection error"));

    const result = await tokenValidationService.validateAllActiveTokens();

    expect(result.total).toBe(1);
    expect(result.invalid).toBe(1);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("t-err");
  });

  it("uses positive TOKEN_VALIDATION_CONCURRENCY from env", async () => {
    const originalConcurrency = process.env.TOKEN_VALIDATION_CONCURRENCY;
    process.env.TOKEN_VALIDATION_CONCURRENCY = "2";

    const batch = [{ id: "t1", ownerType: "streamer", streamerId: "s1", viewerId: null }];
    mockedFindMany.mockResolvedValueOnce(batch).mockResolvedValueOnce([]);

    const validateSpy = jest
      .spyOn(tokenValidationService, "validateAndUpdateToken")
      .mockResolvedValue({
        isValid: true,
        status: TokenStatus.ACTIVE,
        message: "ok",
        shouldRetry: false,
      });

    try {
      const result = await tokenValidationService.validateAllActiveTokens();
      expect(result).toEqual({ total: 1, valid: 1, invalid: 0, errors: [] });
      expect(validateSpy).toHaveBeenCalledWith("t1");
    } finally {
      validateSpy.mockRestore();
      process.env.TOKEN_VALIDATION_CONCURRENCY = originalConcurrency;
    }
  });

  it("uses production default concurrency and executes delay branch when delay is positive", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalDelay = process.env.TOKEN_VALIDATION_DELAY_MS;
    const originalConcurrency = process.env.TOKEN_VALIDATION_CONCURRENCY;

    process.env.NODE_ENV = "production";
    process.env.TOKEN_VALIDATION_DELAY_MS = "1";
    delete process.env.TOKEN_VALIDATION_CONCURRENCY;

    try {
      const ServiceConstructor = (tokenValidationService as unknown as {
        constructor: new () => {
          validateAllActiveTokens: () => Promise<{
            total: number;
            valid: number;
            invalid: number;
            errors: string[];
          }>;
          validateAndUpdateToken: (tokenId: string) => Promise<{
            isValid: boolean;
            status: string;
            message: string;
            shouldRetry: boolean;
          }>;
          getValidationConcurrencyLimit: () => number;
        };
      }).constructor;

      const isolatedService = new ServiceConstructor();

      mockedFindMany
        .mockResolvedValueOnce([{ id: "iso-1", ownerType: "streamer", streamerId: "s1", viewerId: null }])
        .mockResolvedValueOnce([]);

      const validateSpy = jest.spyOn(isolatedService, "validateAndUpdateToken").mockResolvedValue({
        isValid: true,
        status: TokenStatus.ACTIVE,
        message: "ok",
        shouldRetry: false,
      });
      const setTimeoutSpy = jest.spyOn(global, "setTimeout");

      expect(isolatedService.getValidationConcurrencyLimit()).toBe(3);

      const result = await isolatedService.validateAllActiveTokens();
      expect(result).toEqual({ total: 1, valid: 1, invalid: 0, errors: [] });
      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 1);

      validateSpy.mockRestore();
      setTimeoutSpy.mockRestore();
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
      process.env.TOKEN_VALIDATION_DELAY_MS = originalDelay;
      if (originalConcurrency === undefined) {
        delete process.env.TOKEN_VALIDATION_CONCURRENCY;
      } else {
        process.env.TOKEN_VALIDATION_CONCURRENCY = originalConcurrency;
      }
    }
  });

  it("keeps only the latest 200 result errors", async () => {
    const batch = Array.from({ length: 201 }, (_, index) => ({
      id: `invalid-${index}`,
      ownerType: "streamer",
      streamerId: "s1",
      viewerId: null,
    }));
    mockedFindMany.mockResolvedValueOnce(batch).mockResolvedValueOnce([]);

    const validateSpy = jest
      .spyOn(tokenValidationService, "validateAndUpdateToken")
      .mockResolvedValue({
        isValid: false,
        status: TokenStatus.INVALID,
        message: "bad token",
        shouldRetry: false,
      });

    try {
      const result = await tokenValidationService.validateAllActiveTokens();

      expect(result.total).toBe(201);
      expect(result.invalid).toBe(201);
      expect(result.errors).toHaveLength(200);
      expect(result.errors[0]).toContain("invalid-1");
      expect(result.errors[199]).toContain("invalid-200");
    } finally {
      validateSpy.mockRestore();
    }
  });

  it("keeps only the latest 200 thrown errors", async () => {
    const batch = Array.from({ length: 201 }, (_, index) => ({
      id: `throw-${index}`,
      ownerType: "viewer",
      streamerId: null,
      viewerId: "v1",
    }));
    mockedFindMany.mockResolvedValueOnce(batch).mockResolvedValueOnce([]);

    const validateSpy = jest
      .spyOn(tokenValidationService, "validateAndUpdateToken")
      .mockRejectedValue(new Error("boom"));

    try {
      const result = await tokenValidationService.validateAllActiveTokens();

      expect(result.total).toBe(201);
      expect(result.invalid).toBe(201);
      expect(result.errors).toHaveLength(200);
      expect(result.errors[0]).toContain("throw-1");
      expect(result.errors[199]).toContain("throw-200");
    } finally {
      validateSpy.mockRestore();
    }
  });

  it("formats thrown non-Error values as Unknown error", async () => {
    const batch = [{ id: "throw-unknown", ownerType: "viewer", streamerId: null, viewerId: "v1" }];
    mockedFindMany.mockResolvedValueOnce(batch).mockResolvedValueOnce([]);

    const validateSpy = jest
      .spyOn(tokenValidationService, "validateAndUpdateToken")
      .mockRejectedValue("raw-error");

    try {
      const result = await tokenValidationService.validateAllActiveTokens();

      expect(result.invalid).toBe(1);
      expect(result.errors[0]).toContain("Unknown error");
    } finally {
      validateSpy.mockRestore();
    }
  });

  it("awaits delay between validations when delay is greater than zero", async () => {
    const originalDelay = (tokenValidationService as unknown as { TOKEN_VALIDATION_DELAY_MS: number })
      .TOKEN_VALIDATION_DELAY_MS;
    (tokenValidationService as unknown as { TOKEN_VALIDATION_DELAY_MS: number }).TOKEN_VALIDATION_DELAY_MS = 1;
    const setTimeoutSpy = jest.spyOn(global, "setTimeout");

    const batch = [{ id: "delayed-1", ownerType: "streamer", streamerId: "s1", viewerId: null }];
    mockedFindMany.mockResolvedValueOnce(batch).mockResolvedValueOnce([]);

    const validateSpy = jest
      .spyOn(tokenValidationService, "validateAndUpdateToken")
      .mockResolvedValue({
        isValid: true,
        status: TokenStatus.ACTIVE,
        message: "ok",
        shouldRetry: false,
      });

    try {
      const result = await tokenValidationService.validateAllActiveTokens();
      expect(result.valid).toBe(1);
      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 1);
    } finally {
      validateSpy.mockRestore();
      setTimeoutSpy.mockRestore();
      (tokenValidationService as unknown as { TOKEN_VALIDATION_DELAY_MS: number }).TOKEN_VALIDATION_DELAY_MS =
        originalDelay;
    }
  });

  it("skips delay wait when delay is zero", async () => {
    const originalDelay = (tokenValidationService as unknown as { TOKEN_VALIDATION_DELAY_MS: number })
      .TOKEN_VALIDATION_DELAY_MS;
    (tokenValidationService as unknown as { TOKEN_VALIDATION_DELAY_MS: number }).TOKEN_VALIDATION_DELAY_MS = 0;
    const setTimeoutSpy = jest.spyOn(global, "setTimeout");

    const batch = [{ id: "no-delay-1", ownerType: "streamer", streamerId: "s1", viewerId: null }];
    mockedFindMany.mockResolvedValueOnce(batch).mockResolvedValueOnce([]);

    const validateSpy = jest
      .spyOn(tokenValidationService, "validateAndUpdateToken")
      .mockResolvedValue({
        isValid: true,
        status: TokenStatus.ACTIVE,
        message: "ok",
        shouldRetry: false,
      });

    try {
      const result = await tokenValidationService.validateAllActiveTokens();
      expect(result.valid).toBe(1);
      expect(setTimeoutSpy).not.toHaveBeenCalledWith(expect.any(Function), 0);
    } finally {
      validateSpy.mockRestore();
      setTimeoutSpy.mockRestore();
      (tokenValidationService as unknown as { TOKEN_VALIDATION_DELAY_MS: number }).TOKEN_VALIDATION_DELAY_MS =
        originalDelay;
    }
  });

  it("handles multiple batches correctly", async () => {
    // Simulate TOKEN_SCAN_BATCH_SIZE = 200 exactly filled → needs second query
    const firstBatch = Array.from({ length: 200 }, (_, i) => ({
      id: `t${i}`,
      ownerType: "streamer",
      streamerId: "s1",
      viewerId: null,
    }));
    const secondBatch: typeof firstBatch = [];

    mockedFindMany
      .mockResolvedValueOnce(firstBatch)
      .mockResolvedValueOnce(secondBatch);

    // All tokens valid
    mockedFindUnique.mockResolvedValue(makeToken({ status: TokenStatus.ACTIVE, failureCount: 0, lastValidatedAt: null }));
    mockedAxios.get.mockResolvedValue({
      status: 200,
      data: { expires_in: 100, client_id: "c", login: "l", scopes: [], user_id: "u" },
    });
    mockedUpdate.mockResolvedValue({});

    const result = await tokenValidationService.validateAllActiveTokens();

    expect(result.total).toBe(200);
    expect(result.valid).toBe(200);
    expect(result.invalid).toBe(0);
    // Second findMany was called with cursor
    expect(mockedFindMany).toHaveBeenCalledTimes(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// markTokenStatus
// ─────────────────────────────────────────────────────────────────────────────
describe("markTokenStatus", () => {
  it("calls prisma.twitchToken.update with the given status", async () => {
    mockedUpdate.mockResolvedValue({});

    await tokenValidationService.markTokenStatus("token-1", TokenStatus.REVOKED, "manual revoke");

    expect(mockedUpdate).toHaveBeenCalledWith({
      where: { id: "token-1" },
      data: {
        status: TokenStatus.REVOKED,
        failureCount: undefined,
      },
    });
    expect(logger.info).toHaveBeenCalled();
  });

  it("resets failureCount to 0 when marking as ACTIVE", async () => {
    mockedUpdate.mockResolvedValue({});

    await tokenValidationService.markTokenStatus("token-1", TokenStatus.ACTIVE);

    expect(mockedUpdate).toHaveBeenCalledWith({
      where: { id: "token-1" },
      data: {
        status: TokenStatus.ACTIVE,
        failureCount: 0,
      },
    });
  });

  it("does not set failureCount when marking as EXPIRED", async () => {
    mockedUpdate.mockResolvedValue({});

    await tokenValidationService.markTokenStatus("token-1", TokenStatus.EXPIRED);

    expect(mockedUpdate).toHaveBeenCalledWith({
      where: { id: "token-1" },
      data: {
        status: TokenStatus.EXPIRED,
        failureCount: undefined,
      },
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// markTokenStatusByTwitchUserId
// ─────────────────────────────────────────────────────────────────────────────
describe("markTokenStatusByTwitchUserId", () => {
  it("finds token and calls markTokenStatus when token exists (streamer)", async () => {
    const token = makeToken({ id: "found-token" });
    mockedFindFirst.mockResolvedValue(token);
    mockedUpdate.mockResolvedValue({});

    await tokenValidationService.markTokenStatusByTwitchUserId(
      "twitch-123",
      "streamer",
      TokenStatus.REVOKED,
      "revoke reason"
    );

    expect(mockedFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ ownerType: "streamer" }),
      })
    );
    expect(mockedUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "found-token" } })
    );
  });

  it("finds token by viewer when ownerType is viewer", async () => {
    const token = makeToken({ id: "viewer-token", ownerType: "viewer" });
    mockedFindFirst.mockResolvedValue(token);
    mockedUpdate.mockResolvedValue({});

    await tokenValidationService.markTokenStatusByTwitchUserId(
      "twitch-456",
      "viewer",
      TokenStatus.EXPIRED
    );

    expect(mockedFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ ownerType: "viewer" }),
      })
    );
    expect(mockedUpdate).toHaveBeenCalled();
  });

  it("logs warn and does not call markTokenStatus when token not found", async () => {
    mockedFindFirst.mockResolvedValue(null);

    await tokenValidationService.markTokenStatusByTwitchUserId(
      "unknown-twitch-id",
      "streamer",
      TokenStatus.REVOKED
    );

    expect(mockedUpdate).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getTokensNeedingRefresh
// ─────────────────────────────────────────────────────────────────────────────
describe("getTokensNeedingRefresh", () => {
  it("returns expired tokens with refresh tokens", async () => {
    const expiredTokens = [
      { id: "exp-1", ownerType: "streamer", refreshToken: "rt1", streamerId: "s1", viewerId: null },
      { id: "exp-2", ownerType: "viewer", refreshToken: "rt2", streamerId: null, viewerId: "v1" },
    ];
    mockedFindMany.mockResolvedValue(expiredTokens);

    const result = await tokenValidationService.getTokensNeedingRefresh();

    expect(mockedFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: TokenStatus.EXPIRED,
          refreshToken: { not: null },
        }),
      })
    );
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("exp-1");
  });

  it("passes failureCount lt MAX_FAILURE_COUNT (3) as filter", async () => {
    mockedFindMany.mockResolvedValue([]);

    await tokenValidationService.getTokensNeedingRefresh();

    expect(mockedFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          failureCount: { lt: 3 },
        }),
      })
    );
  });

  it("returns empty array when no tokens need refresh", async () => {
    mockedFindMany.mockResolvedValue([]);

    const result = await tokenValidationService.getTokensNeedingRefresh();

    expect(result).toHaveLength(0);
  });

  it("falls back to default take=500 when refresh limit is invalid", async () => {
    const originalLimit = (tokenValidationService as unknown as { TOKENS_NEEDING_REFRESH_LIMIT: number })
      .TOKENS_NEEDING_REFRESH_LIMIT;
    (tokenValidationService as unknown as { TOKENS_NEEDING_REFRESH_LIMIT: number }).TOKENS_NEEDING_REFRESH_LIMIT =
      0;
    mockedFindMany.mockResolvedValue([]);

    try {
      await tokenValidationService.getTokensNeedingRefresh();

      expect(mockedFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 500,
        })
      );
    } finally {
      (tokenValidationService as unknown as { TOKENS_NEEDING_REFRESH_LIMIT: number }).TOKENS_NEEDING_REFRESH_LIMIT =
        originalLimit;
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getTokenStats
// ─────────────────────────────────────────────────────────────────────────────
describe("getTokenStats", () => {
  it("returns a record mapping status to count", async () => {
    mockedGroupBy.mockResolvedValue([
      { status: "active", _count: { status: 10 } },
      { status: "expired", _count: { status: 3 } },
      { status: "revoked", _count: { status: 1 } },
    ]);

    const result = await tokenValidationService.getTokenStats();

    expect(result).toEqual({ active: 10, expired: 3, revoked: 1 });
  });

  it("calls groupBy with correct arguments", async () => {
    mockedGroupBy.mockResolvedValue([]);

    await tokenValidationService.getTokenStats();

    expect(mockedGroupBy).toHaveBeenCalledWith({
      by: ["status"],
      _count: { status: true },
    });
  });

  it("returns empty object when no tokens exist", async () => {
    mockedGroupBy.mockResolvedValue([]);

    const result = await tokenValidationService.getTokenStats();

    expect(result).toEqual({});
  });
});
