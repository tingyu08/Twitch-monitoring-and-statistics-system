/**
 * token-management.init.ts 單元測試
 */

jest.mock("../../db/prisma", () => ({
  prisma: {
    twitchToken: {
      findFirst: jest.fn(),
    },
  },
}));

jest.mock("../twurple-auth.service", () => ({
  twurpleAuthService: {
    setOnTokenFailure: jest.fn(),
    getStatus: jest.fn().mockReturnValue({ userProviderCount: 3 }),
    getActiveUserIds: jest.fn().mockReturnValue(["u1", "u2"]),
  },
}));

jest.mock("../token-validation.service", () => ({
  tokenValidationService: {
    markTokenStatus: jest.fn(),
    getTokenStats: jest.fn().mockResolvedValue({ active: 10, expired: 2 }),
  },
  TokenStatus: {
    REVOKED: "REVOKED",
    INVALID: "INVALID",
    EXPIRED: "EXPIRED",
  },
}));

jest.mock("../../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { prisma } from "../../db/prisma";
import { twurpleAuthService } from "../twurple-auth.service";
import { tokenValidationService, TokenStatus } from "../token-validation.service";
import { logger } from "../../utils/logger";
import {
  initializeTokenManagement,
  getTokenManagementStatus,
} from "../token-management.init";

describe("initializeTokenManagement", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("registers token failure callback", async () => {
    await initializeTokenManagement();
    expect(twurpleAuthService.setOnTokenFailure).toHaveBeenCalledTimes(1);
  });

  it("callback handles revoked reason → REVOKED status for viewer token", async () => {
    await initializeTokenManagement();

    const callback = (twurpleAuthService.setOnTokenFailure as jest.Mock).mock.calls[0][0];

    (prisma.twitchToken.findFirst as jest.Mock).mockResolvedValueOnce({ id: "token-v" });

    await callback("user-123", new Error("revoked"), "revoked");

    expect(tokenValidationService.markTokenStatus).toHaveBeenCalledWith(
      "token-v",
      TokenStatus.REVOKED,
      "Refresh failure: revoked"
    );
  });

  it("callback handles invalid_token reason → INVALID status for streamer token", async () => {
    await initializeTokenManagement();

    const callback = (twurpleAuthService.setOnTokenFailure as jest.Mock).mock.calls[0][0];

    // Viewer token not found, streamer token found
    (prisma.twitchToken.findFirst as jest.Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "token-s" });

    await callback("user-456", new Error("invalid_token"), "invalid_token");

    expect(tokenValidationService.markTokenStatus).toHaveBeenCalledWith(
      "token-s",
      TokenStatus.INVALID,
      "Refresh failure: invalid_token"
    );
  });

  it("callback handles refresh_failed reason → EXPIRED status", async () => {
    await initializeTokenManagement();

    const callback = (twurpleAuthService.setOnTokenFailure as jest.Mock).mock.calls[0][0];

    (prisma.twitchToken.findFirst as jest.Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "token-s2" });

    await callback("user-789", new Error("refresh_failed"), "refresh_failed");

    expect(tokenValidationService.markTokenStatus).toHaveBeenCalledWith(
      "token-s2",
      TokenStatus.EXPIRED,
      "Refresh failure: refresh_failed"
    );
  });

  it("callback handles unknown reason → EXPIRED status (default case)", async () => {
    await initializeTokenManagement();

    const callback = (twurpleAuthService.setOnTokenFailure as jest.Mock).mock.calls[0][0];

    (prisma.twitchToken.findFirst as jest.Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "token-default" });

    await callback("user-000", new Error("unknown"), "unknown_reason");

    expect(tokenValidationService.markTokenStatus).toHaveBeenCalledWith(
      "token-default",
      TokenStatus.EXPIRED,
      "Refresh failure: unknown_reason"
    );
  });

  it("callback logs warning when no token found", async () => {
    await initializeTokenManagement();

    const callback = (twurpleAuthService.setOnTokenFailure as jest.Mock).mock.calls[0][0];

    (prisma.twitchToken.findFirst as jest.Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    await callback("user-nf", new Error("revoked"), "revoked");

    expect(logger.warn).toHaveBeenCalled();
    expect(tokenValidationService.markTokenStatus).not.toHaveBeenCalled();
  });

  it("callback handles db error gracefully", async () => {
    await initializeTokenManagement();

    const callback = (twurpleAuthService.setOnTokenFailure as jest.Mock).mock.calls[0][0];

    (prisma.twitchToken.findFirst as jest.Mock).mockRejectedValue(new Error("DB down"));

    await callback("user-db-err", new Error("revoked"), "revoked");

    expect(logger.error).toHaveBeenCalled();
  });
});

describe("getTokenManagementStatus", () => {
  it("returns auth provider count, token stats, and active user IDs", async () => {
    const status = await getTokenManagementStatus();
    expect(status.authProviderCount).toBe(3);
    expect(status.tokenStats).toEqual({ active: 10, expired: 2 });
    expect(status.activeUserIds).toEqual(["u1", "u2"]);
  });
});
