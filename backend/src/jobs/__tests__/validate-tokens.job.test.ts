/**
 * validate-tokens.job.ts 單元測試
 */

jest.mock("../../services/token-validation.service", () => ({
  tokenValidationService: {
    validateAllActiveTokens: jest.fn().mockResolvedValue({
      total: 10,
      valid: 8,
      invalid: 2,
      errors: [],
    }),
    getTokenStats: jest.fn().mockResolvedValue({ active: 8, expired: 2 }),
    validateAndUpdateToken: jest.fn().mockResolvedValue({
      isValid: true,
      status: "active",
      message: "Token is valid",
    }),
  },
}));

jest.mock("../../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { tokenValidationService } from "../../services/token-validation.service";
import { logger } from "../../utils/logger";

// Import after mocks
let validateTokensJob: () => Promise<unknown>;
let getLastRunResult: () => unknown;
let getTokenStatusStats: () => Promise<unknown>;
let validateSingleToken: (id: string) => Promise<unknown>;

beforeAll(async () => {
  const mod = await import("../../jobs/validate-tokens.job");
  validateTokensJob = mod.validateTokensJob;
  getLastRunResult = mod.getLastRunResult;
  getTokenStatusStats = mod.getTokenStatusStats;
  validateSingleToken = mod.validateSingleToken;
});

describe("validateTokensJob", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (tokenValidationService.validateAllActiveTokens as jest.Mock).mockResolvedValue({
      total: 10, valid: 8, invalid: 2, errors: [],
    });
  });

  it("runs successfully and returns job result", async () => {
    const result = await validateTokensJob() as {
      success: boolean;
      stats: { total: number; valid: number; invalid: number };
      errors: string[];
      durationMs: number;
    };
    expect(result.success).toBe(true);
    expect(result.stats.total).toBe(10);
    expect(result.stats.valid).toBe(8);
    expect(result.stats.invalid).toBe(2);
    expect(logger.info).toHaveBeenCalled();
  });

  it("logs warning when invalid rate > 10%", async () => {
    (tokenValidationService.validateAllActiveTokens as jest.Mock).mockResolvedValue({
      total: 10, valid: 2, invalid: 8, errors: [],
    });
    const result = await validateTokensJob() as { success: boolean };
    expect(result.success).toBe(true);
    expect(logger.warn).toHaveBeenCalled();
  });

  it("does not log warning when invalid rate <= 10%", async () => {
    (tokenValidationService.validateAllActiveTokens as jest.Mock).mockResolvedValue({
      total: 10, valid: 9, invalid: 1, errors: [],
    });
    await validateTokensJob();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("handles errors gracefully and returns success=false", async () => {
    (tokenValidationService.validateAllActiveTokens as jest.Mock).mockRejectedValue(
      new Error("DB crash")
    );
    const result = await validateTokensJob() as {
      success: boolean;
      errors: string[];
    };
    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain("DB crash");
    expect(logger.error).toHaveBeenCalled();
  });

  it("handles non-Error rejection", async () => {
    (tokenValidationService.validateAllActiveTokens as jest.Mock).mockRejectedValue("string error");
    const result = await validateTokensJob() as { success: boolean; errors: string[] };
    expect(result.success).toBe(false);
    expect(result.errors[0]).toBe("Unknown error");
  });

  it("deduplicates concurrent calls (service called only once)", async () => {
    let callCount = 0;
    (tokenValidationService.validateAllActiveTokens as jest.Mock).mockImplementation(async () => {
      callCount++;
      return { total: 1, valid: 1, invalid: 0, errors: [] };
    });

    await Promise.all([validateTokensJob(), validateTokensJob()]);
    expect(callCount).toBe(1);
  });
});

describe("getLastRunResult", () => {
  it("returns the result of the last run", async () => {
    (tokenValidationService.validateAllActiveTokens as jest.Mock).mockResolvedValue({
      total: 5, valid: 5, invalid: 0, errors: [],
    });
    await validateTokensJob();
    const result = getLastRunResult() as { success: boolean; stats: { total: number } };
    expect(result).not.toBeNull();
    expect(result.success).toBe(true);
    expect(result.stats.total).toBe(5);
  });
});

describe("getTokenStatusStats", () => {
  it("delegates to tokenValidationService.getTokenStats", async () => {
    const stats = await getTokenStatusStats();
    expect(tokenValidationService.getTokenStats).toHaveBeenCalled();
    expect(stats).toEqual({ active: 8, expired: 2 });
  });
});

describe("validateSingleToken", () => {
  it("delegates to tokenValidationService.validateAndUpdateToken", async () => {
    const result = await validateSingleToken("tok-123") as {
      isValid: boolean;
      status: string;
      message: string;
    };
    expect(tokenValidationService.validateAndUpdateToken).toHaveBeenCalledWith("tok-123");
    expect(result.isValid).toBe(true);
    expect(result.status).toBe("active");
  });
});
