/**
 * token-management.routes.ts 單元測試
 */

jest.mock("../../../services/token-validation.service", () => ({
  tokenValidationService: {
    markTokenStatus: jest.fn().mockResolvedValue(undefined),
    getTokensNeedingRefresh: jest.fn().mockResolvedValue([
      { id: "tok1", ownerType: "viewer", streamerId: null, viewerId: "v1" },
    ]),
    getTokenStats: jest.fn().mockResolvedValue({ active: 10, expired: 2 }),
  },
  TokenStatus: {
    ACTIVE: "active",
    EXPIRED: "expired",
    REVOKED: "revoked",
    INVALID: "invalid",
  },
}));

jest.mock("../../../jobs/validate-tokens.job", () => ({
  validateTokensJob: jest.fn().mockResolvedValue({
    success: true,
    durationMs: 123,
    stats: { total: 10, valid: 8, invalid: 2 },
    errors: [],
  }),
  getLastRunResult: jest.fn().mockReturnValue(null),
  getTokenStatusStats: jest.fn().mockResolvedValue({ active: 10, expired: 2 }),
  validateSingleToken: jest.fn().mockResolvedValue({
    isValid: true,
    status: "active",
    message: "Token is valid",
  }),
}));

jest.mock("../../../services/token-management.init", () => ({
  getTokenManagementStatus: jest.fn().mockResolvedValue({
    authProviderCount: 3,
    activeUserIds: ["u1", "u2"],
    tokenStats: { active: 10, expired: 2 },
  }),
}));

jest.mock("../../../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock("../../../utils/request-values", () => ({
  getSingleStringValue: jest.fn((v) => v ?? null),
}));

jest.mock("../../../middlewares/validate.middleware", () => ({
  validateRequest: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import request from "supertest";
import express from "express";
import tokenMgmtRouter from "../token-management.routes";
import {
  validateTokensJob,
  getLastRunResult,
  validateSingleToken,
} from "../../../jobs/validate-tokens.job";
import { tokenValidationService } from "../../../services/token-validation.service";
import { getTokenManagementStatus } from "../../../services/token-management.init";

const app = express();
app.use(express.json());
app.use("/api/admin/tokens", tokenMgmtRouter);

describe("token-management.routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (validateTokensJob as jest.Mock).mockResolvedValue({
      success: true, durationMs: 123,
      stats: { total: 10, valid: 8, invalid: 2 }, errors: [],
    });
    (getLastRunResult as jest.Mock).mockReturnValue(null);
    (validateSingleToken as jest.Mock).mockResolvedValue({
      isValid: true, status: "active", message: "Token is valid",
    });
    (tokenValidationService.getTokensNeedingRefresh as jest.Mock).mockResolvedValue([
      { id: "tok1", ownerType: "viewer", streamerId: null, viewerId: "v1" },
    ]);
    (getTokenManagementStatus as jest.Mock).mockResolvedValue({
      authProviderCount: 3, activeUserIds: ["u1", "u2"], tokenStats: { active: 10, expired: 2 },
    });
  });

  // ====================================================
  // GET /stats
  // ====================================================
  describe("GET /stats", () => {
    it("returns token stats", async () => {
      const res = await request(app).get("/api/admin/tokens/stats");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty("tokenStats");
      expect(res.body.data.activeProviders).toBe(3);
    });

    it("returns 500 on error", async () => {
      (getTokenManagementStatus as jest.Mock).mockRejectedValue(new Error("fail"));
      const res = await request(app).get("/api/admin/tokens/stats");
      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    });
  });

  // ====================================================
  // POST /validate-all
  // ====================================================
  describe("POST /validate-all", () => {
    it("triggers validation and returns result", async () => {
      const res = await request(app).post("/api/admin/tokens/validate-all");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.stats).toEqual({ total: 10, valid: 8, invalid: 2 });
    });

    it("returns success:false when job result has success=false", async () => {
      (validateTokensJob as jest.Mock).mockResolvedValue({
        success: false, durationMs: 50,
        stats: { total: 0, valid: 0, invalid: 0 },
        errors: ["err1", "err2", "e3", "e4", "e5", "e6", "e7", "e8", "e9", "e10", "e11"],
      });
      const res = await request(app).post("/api/admin/tokens/validate-all");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      // only first 10 errors returned
      expect(res.body.data.errors.length).toBe(10);
      expect(res.body.data.hasMoreErrors).toBe(true);
    });

    it("returns 500 on thrown error", async () => {
      (validateTokensJob as jest.Mock).mockRejectedValue(new Error("crash"));
      const res = await request(app).post("/api/admin/tokens/validate-all");
      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    });
  });

  // ====================================================
  // POST /:tokenId/validate
  // ====================================================
  describe("POST /:tokenId/validate", () => {
    it("validates single token", async () => {
      const res = await request(app).post(
        "/api/admin/tokens/550e8400-e29b-41d4-a716-446655440000/validate"
      );
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.isValid).toBe(true);
    });

    it("returns 500 on thrown error", async () => {
      (validateSingleToken as jest.Mock).mockRejectedValue(new Error("fail"));
      const res = await request(app).post(
        "/api/admin/tokens/550e8400-e29b-41d4-a716-446655440000/validate"
      );
      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    });

    it("returns 400 when tokenId resolves to null", async () => {
      const { getSingleStringValue } = jest.requireMock("../../../utils/request-values") as {
        getSingleStringValue: jest.Mock;
      };
      getSingleStringValue.mockReturnValueOnce(null);

      const res = await request(app).post(
        "/api/admin/tokens/550e8400-e29b-41d4-a716-446655440000/validate"
      );
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("tokenId is required");
    });
  });

  // ====================================================
  // PATCH /:tokenId/status
  // ====================================================
  describe("PATCH /:tokenId/status", () => {
    const validId = "550e8400-e29b-41d4-a716-446655440000";

    it("updates token status to expired", async () => {
      const res = await request(app)
        .patch(`/api/admin/tokens/${validId}/status`)
        .send({ status: "expired", reason: "manual" });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(tokenValidationService.markTokenStatus).toHaveBeenCalledWith(
        validId, "expired", "manual"
      );
    });

    it("returns 400 for invalid status", async () => {
      const res = await request(app)
        .patch(`/api/admin/tokens/${validId}/status`)
        .send({ status: "UNKNOWN" });
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("returns 500 on thrown error", async () => {
      (tokenValidationService.markTokenStatus as jest.Mock).mockRejectedValue(new Error("fail"));
      const res = await request(app)
        .patch(`/api/admin/tokens/${validId}/status`)
        .send({ status: "revoked" });
      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    });

    it("returns 400 when tokenId resolves to null", async () => {
      const { getSingleStringValue } = jest.requireMock("../../../utils/request-values") as {
        getSingleStringValue: jest.Mock;
      };
      getSingleStringValue.mockReturnValueOnce(null);

      const res = await request(app)
        .patch(`/api/admin/tokens/${validId}/status`)
        .send({ status: "active" });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("tokenId is required");
    });
  });

  // ====================================================
  // GET /last-validation
  // ====================================================
  describe("GET /last-validation", () => {
    it("returns null when no job has run", async () => {
      (getLastRunResult as jest.Mock).mockReturnValue(null);
      const res = await request(app).get("/api/admin/tokens/last-validation");
      expect(res.status).toBe(200);
      expect(res.body.data).toBeNull();
    });

    it("returns last result when job has run", async () => {
      (getLastRunResult as jest.Mock).mockReturnValue({
        success: true,
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        durationMs: 200,
        stats: { total: 5, valid: 5, invalid: 0 },
        errors: [],
      });
      const res = await request(app).get("/api/admin/tokens/last-validation");
      expect(res.status).toBe(200);
      expect(res.body.data.success).toBe(true);
      expect(res.body.data.duration).toBe("200ms");
    });
  });

  // ====================================================
  // GET /needs-refresh
  // ====================================================
  describe("GET /needs-refresh", () => {
    it("returns tokens needing refresh", async () => {
      const res = await request(app).get("/api/admin/tokens/needs-refresh");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.count).toBe(1);
      expect(res.body.data.tokens[0].id).toBe("tok1");
    });

    it("returns 500 on error", async () => {
      (tokenValidationService.getTokensNeedingRefresh as jest.Mock).mockRejectedValue(
        new Error("fail")
      );
      const res = await request(app).get("/api/admin/tokens/needs-refresh");
      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    });
  });
});
