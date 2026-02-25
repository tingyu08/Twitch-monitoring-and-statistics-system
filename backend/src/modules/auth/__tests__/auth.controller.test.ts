import { AuthController, clearAuthCookies, AUTH_COOKIE_OPTIONS } from "../auth.controller";
import { Request, Response } from "express";
import { TwitchOAuthClient } from "../twitch-oauth.client";
import * as AuthService from "../auth.service";
import * as JwtUtils from "../jwt.utils";
import * as ViewerAuthSnapshotService from "../../viewer/viewer-auth-snapshot.service";
import crypto from "crypto";
import axios from "axios";

// Must mock prisma before auth modules are loaded (auth.controller -> auth.service -> prisma)
jest.mock("../../../db/prisma", () => ({
  prisma: {
    $transaction: jest.fn(),
    streamer: { upsert: jest.fn(), findUnique: jest.fn() },
    channel: { upsert: jest.fn(), findFirst: jest.fn() },
    viewer: { upsert: jest.fn(), findUnique: jest.fn() },
    twitchToken: {
      findFirst: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
  },
}));

jest.mock("../../../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  authLogger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock("../../../jobs/sync-user-follows.job", () => ({
  triggerFollowSyncForUser: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../../utils/db-retry", () => ({
  retryDatabaseOperation: jest.fn().mockImplementation((fn: () => unknown) => fn()),
}));

jest.mock("../../../utils/crypto.utils", () => ({
  encryptToken: jest.fn().mockReturnValue("encrypted_token"),
}));

jest.mock("../auth.service");
jest.mock("../jwt.utils");
jest.mock("crypto");
jest.mock("../../viewer/viewer-auth-snapshot.service", () => ({
  getViewerAuthSnapshotById: jest.fn(),
  invalidateViewerAuthSnapshot: jest.fn(),
}));

// Mock axios for isAxiosError usage
jest.mock("axios", () => ({
  ...jest.requireActual("axios"),
  isAxiosError: jest.fn(),
}));

describe("AuthController", () => {
  let controller: AuthController;
  let mockTwitchClient: jest.Mocked<TwitchOAuthClient>;
  let mockReq: Partial<Request> & { user?: unknown };
  let mockRes: Partial<Response>;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;
  let redirectMock: jest.Mock;
  let cookieMock: jest.Mock;
  let clearCookieMock: jest.Mock;

  beforeEach(() => {
    mockTwitchClient = {
      getOAuthUrl: jest.fn(),
      getAccessToken: jest.fn(),
      getUserInfo: jest.fn(),
      getBroadcasterSubscriptions: jest.fn(),
    } as unknown as jest.Mocked<TwitchOAuthClient>;

    controller = new AuthController(mockTwitchClient);

    jsonMock = jest.fn();
    redirectMock = jest.fn();
    cookieMock = jest.fn();
    clearCookieMock = jest.fn();
    statusMock = jest.fn().mockReturnValue({ json: jsonMock });

    mockReq = {
      cookies: {},
      query: {},
      body: {},
      user: undefined,
    } as unknown as Partial<Request>;

    mockRes = {
      json: jsonMock,
      status: statusMock,
      redirect: redirectMock,
      cookie: cookieMock,
      clearCookie: clearCookieMock,
    } as unknown as Partial<Response>;

    jest.clearAllMocks();

    (ViewerAuthSnapshotService.getViewerAuthSnapshotById as jest.Mock).mockResolvedValue({
      id: "viewer-1",
      twitchUserId: "twitch-1",
      tokenVersion: 1,
      consentedAt: null,
      consentVersion: 1,
      isAnonymized: false,
    });

    (axios.isAxiosError as unknown as jest.Mock).mockReturnValue(false);
  });

  // ============================================================
  // login
  // ============================================================
  describe("login", () => {
    it("should redirect to twitch auth url and set state cookie", async () => {
      (crypto.randomBytes as jest.Mock).mockReturnValue({
        toString: () => "random_state",
      });
      mockTwitchClient.getOAuthUrl.mockReturnValue("http://twitch.auth.url");

      await controller.login(mockReq as Request, mockRes as Response);

      expect(cookieMock).toHaveBeenCalledWith(
        "twitch_auth_state",
        "random_state",
        expect.any(Object)
      );
      expect(redirectMock).toHaveBeenCalledWith("http://twitch.auth.url");
    });

    it("should pass state to getOAuthUrl", async () => {
      (crypto.randomBytes as jest.Mock).mockReturnValue({
        toString: () => "my_state",
      });
      mockTwitchClient.getOAuthUrl.mockReturnValue("http://twitch.auth.url/with_state");

      await controller.login(mockReq as Request, mockRes as Response);

      expect(mockTwitchClient.getOAuthUrl).toHaveBeenCalledWith("my_state", expect.any(Object));
    });

    it("should handle errors and return 500", async () => {
      (crypto.randomBytes as jest.Mock).mockImplementation(() => {
        throw new Error("Crypto Error");
      });

      await controller.login(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(500);
      expect(jsonMock).toHaveBeenCalledWith({ message: "Internal Server Error" });
    });

    it("should create AuthController with default TwitchOAuthClient when no client passed", () => {
      const defaultController = new AuthController();
      expect(defaultController).toBeDefined();
    });
  });

  // ============================================================
  // twitchCallback
  // ============================================================
  describe("twitchCallback", () => {
    it("should handle state mismatch (CSRF)", async () => {
      mockReq.query = { state: "state1", code: "code1" };
      mockReq.cookies = { twitch_auth_state: "state2" };

      await controller.twitchCallback(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(403);
      expect(jsonMock).toHaveBeenCalledWith({
        message: "Invalid state parameter (CSRF detected)",
      });
    });

    it("should reject when state is missing in query", async () => {
      mockReq.query = { code: "code1" };
      mockReq.cookies = { twitch_auth_state: "state1" };

      await controller.twitchCallback(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(403);
    });

    it("should reject when stored state cookie is missing", async () => {
      mockReq.query = { state: "state1", code: "code1" };
      mockReq.cookies = {};

      await controller.twitchCallback(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(403);
    });

    it("should handle missing code after valid state", async () => {
      mockReq.query = { state: "state1" };
      mockReq.cookies = { twitch_auth_state: "state1" };

      await controller.twitchCallback(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({ message: "Authorization code missing" });
    });

    it("should succeed login and set auth cookies, then redirect to dashboard", async () => {
      mockReq.query = { state: "state1", code: "valid_code" };
      mockReq.cookies = { twitch_auth_state: "state1" };

      (AuthService.handleStreamerTwitchCallback as jest.Mock).mockResolvedValue({
        accessToken: "at",
        refreshToken: "rt",
      });

      await controller.twitchCallback(mockReq as Request, mockRes as Response);

      expect(AuthService.handleStreamerTwitchCallback).toHaveBeenCalledWith("valid_code");
      expect(cookieMock).toHaveBeenCalledWith("auth_token", "at", expect.any(Object));
      expect(cookieMock).toHaveBeenCalledWith("refresh_token", "rt", expect.any(Object));
      expect(redirectMock).toHaveBeenCalledWith(expect.stringContaining("/dashboard/viewer"));
    });

    it("should redirect to error page on service failure", async () => {
      mockReq.query = { state: "state1", code: "code1" };
      mockReq.cookies = { twitch_auth_state: "state1" };
      (AuthService.handleStreamerTwitchCallback as jest.Mock).mockRejectedValue(
        new Error("Service failure")
      );

      await controller.twitchCallback(mockReq as Request, mockRes as Response);

      expect(redirectMock).toHaveBeenCalledWith(
        expect.stringContaining("/auth/error?reason=internal_error")
      );
    });

    it("should redirect to error when Twitch returns error query param", async () => {
      mockReq.query = {
        error: "access_denied",
        error_description: "User denied access",
      };
      await controller.twitchCallback(mockReq as Request, mockRes as Response);
      expect(redirectMock).toHaveBeenCalledWith(
        expect.stringContaining("/auth/error?reason=access_denied")
      );
    });

    it("should redirect to error page on non-Error exception", async () => {
      mockReq.query = { state: "state1", code: "code1" };
      mockReq.cookies = { twitch_auth_state: "state1" };
      (AuthService.handleStreamerTwitchCallback as jest.Mock).mockRejectedValue("string error");

      await controller.twitchCallback(mockReq as Request, mockRes as Response);

      expect(redirectMock).toHaveBeenCalledWith(
        expect.stringContaining("/auth/error?reason=internal_error")
      );
    });

    it("should clear state cookie on successful state validation", async () => {
      mockReq.query = { state: "state1", code: "code1" };
      mockReq.cookies = { twitch_auth_state: "state1" };
      (AuthService.handleStreamerTwitchCallback as jest.Mock).mockResolvedValue({
        accessToken: "at",
        refreshToken: "rt",
      });

      await controller.twitchCallback(mockReq as Request, mockRes as Response);

      expect(clearCookieMock).toHaveBeenCalledWith("twitch_auth_state");
    });
  });

  // ============================================================
  // exchange (BFF endpoint)
  // ============================================================
  describe("exchange", () => {
    it("should return accessToken and refreshToken on success", async () => {
      mockReq.body = { code: "auth_code" };
      mockReq.cookies = {};

      (AuthService.handleStreamerTwitchCallback as jest.Mock).mockResolvedValue({
        accessToken: "at",
        refreshToken: "rt",
      });

      await controller.exchange(mockReq as Request, mockRes as Response);

      expect(jsonMock).toHaveBeenCalledWith({ accessToken: "at", refreshToken: "rt" });
    });

    it("should return 400 when code is missing", async () => {
      mockReq.body = {};
      mockReq.cookies = {};

      await controller.exchange(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({ message: "Authorization code missing" });
    });

    it("should return 403 when state cookie exists but state param is missing", async () => {
      mockReq.body = { code: "auth_code" };
      mockReq.cookies = { twitch_auth_state: "stored_state" };

      await controller.exchange(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(403);
      expect(jsonMock).toHaveBeenCalledWith({
        message: "Invalid state parameter (CSRF detected)",
      });
    });

    it("should return 403 when state param does not match stored state", async () => {
      mockReq.body = { code: "auth_code", state: "wrong_state" };
      mockReq.cookies = { twitch_auth_state: "correct_state" };

      await controller.exchange(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(403);
    });

    it("should clear state cookie on valid state match", async () => {
      mockReq.body = { code: "auth_code", state: "same_state" };
      mockReq.cookies = { twitch_auth_state: "same_state" };

      (AuthService.handleStreamerTwitchCallback as jest.Mock).mockResolvedValue({
        accessToken: "at",
        refreshToken: "rt",
      });

      await controller.exchange(mockReq as Request, mockRes as Response);

      expect(clearCookieMock).toHaveBeenCalledWith("twitch_auth_state");
    });

    it("should return 400 when redirectUri is not in allowed list", async () => {
      mockReq.body = { code: "auth_code", redirectUri: "https://evil.example.com/callback" };
      mockReq.cookies = {};

      await controller.exchange(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({ message: "Invalid redirectUri" });
    });

    it("should pass redirectUri to handleStreamerTwitchCallback when valid", async () => {
      const allowedUri = process.env.TWITCH_REDIRECT_URI || "http://localhost:3001/auth/callback";
      mockReq.body = { code: "auth_code", redirectUri: allowedUri };
      mockReq.cookies = {};

      (AuthService.handleStreamerTwitchCallback as jest.Mock).mockResolvedValue({
        accessToken: "at",
        refreshToken: "rt",
      });

      await controller.exchange(mockReq as Request, mockRes as Response);

      expect(AuthService.handleStreamerTwitchCallback).toHaveBeenCalledWith(
        "auth_code",
        expect.any(String)
      );
    });

    it("should return 500 on generic service error", async () => {
      mockReq.body = { code: "auth_code" };
      mockReq.cookies = {};

      (AuthService.handleStreamerTwitchCallback as jest.Mock).mockRejectedValue(
        new Error("Service error")
      );
      (axios.isAxiosError as unknown as jest.Mock).mockReturnValue(false);

      await controller.exchange(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(500);
      expect(jsonMock).toHaveBeenCalledWith({ message: "Token exchange failed" });
    });

    it("should return 504 on timeout axios error", async () => {
      mockReq.body = { code: "auth_code" };
      mockReq.cookies = {};

      const timeoutError = {
        message: "timeout of 5000ms exceeded",
        code: "ECONNABORTED",
        isAxiosError: true,
        response: undefined,
      };
      (AuthService.handleStreamerTwitchCallback as jest.Mock).mockRejectedValue(timeoutError);
      (axios.isAxiosError as unknown as jest.Mock).mockReturnValue(true);

      await controller.exchange(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(504);
      expect(jsonMock).toHaveBeenCalledWith({
        message: "Token exchange timeout, please retry",
      });
    });

    it("should return 504 on ECONNABORTED axios error", async () => {
      mockReq.body = { code: "auth_code" };
      mockReq.cookies = {};

      const connAbortedError = {
        message: "connection aborted",
        code: "ECONNABORTED",
        isAxiosError: true,
        response: undefined,
      };
      (AuthService.handleStreamerTwitchCallback as jest.Mock).mockRejectedValue(connAbortedError);
      (axios.isAxiosError as unknown as jest.Mock).mockReturnValue(true);

      await controller.exchange(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(504);
    });

    it("should proceed without state check when no state cookie exists", async () => {
      mockReq.body = { code: "auth_code", state: "some_state" };
      mockReq.cookies = {};

      (AuthService.handleStreamerTwitchCallback as jest.Mock).mockResolvedValue({
        accessToken: "at",
        refreshToken: "rt",
      });

      await controller.exchange(mockReq as Request, mockRes as Response);

      expect(jsonMock).toHaveBeenCalledWith({ accessToken: "at", refreshToken: "rt" });
    });
  });

  // ============================================================
  // refresh
  // ============================================================
  describe("refresh", () => {
    it("should issue new tokens when refresh token is valid", async () => {
      mockReq.cookies = { refresh_token: "old_rt" };
      (JwtUtils.verifyRefreshToken as jest.Mock).mockReturnValue({
        userId: "u1",
        tokenType: "refresh",
      });
      (JwtUtils.signAccessToken as jest.Mock).mockReturnValue("at2");
      (JwtUtils.signRefreshToken as jest.Mock).mockReturnValue("rt2");

      await controller.refresh(mockReq as Request, mockRes as Response);

      expect(cookieMock).toHaveBeenCalledWith("auth_token", "at2", expect.any(Object));
      expect(jsonMock).toHaveBeenCalledWith({ message: "refreshed" });
    });

    it("should return 401 when refresh token is missing", async () => {
      mockReq.cookies = {};
      await controller.refresh(mockReq as Request, mockRes as Response);
      expect(statusMock).toHaveBeenCalledWith(401);
      expect(jsonMock).toHaveBeenCalledWith({ error: "Missing refresh token" });
    });

    it("should return 401 when refresh token is invalid", async () => {
      mockReq.cookies = { refresh_token: "bad_token" };
      (JwtUtils.verifyRefreshToken as jest.Mock).mockReturnValue(null);
      await controller.refresh(mockReq as Request, mockRes as Response);
      expect(statusMock).toHaveBeenCalledWith(401);
      expect(jsonMock).toHaveBeenCalledWith({ error: "Invalid refresh token" });
    });

    it("should return 401 when viewer not found in DB", async () => {
      mockReq.cookies = { refresh_token: "valid_rt" };
      (JwtUtils.verifyRefreshToken as jest.Mock).mockReturnValue({
        viewerId: "viewer-missing",
        tokenVersion: 1,
        tokenType: "refresh",
      });
      (ViewerAuthSnapshotService.getViewerAuthSnapshotById as jest.Mock).mockResolvedValue(null);

      await controller.refresh(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(401);
      expect(jsonMock).toHaveBeenCalledWith({ error: "User not found" });
    });

    it("should return 401 and clear cookies when tokenVersion is mismatched (invalidated token)", async () => {
      mockReq.cookies = { refresh_token: "old_rt" };
      (JwtUtils.verifyRefreshToken as jest.Mock).mockReturnValue({
        viewerId: "viewer-1",
        tokenVersion: 0, // stale version
        tokenType: "refresh",
      });
      (ViewerAuthSnapshotService.getViewerAuthSnapshotById as jest.Mock).mockResolvedValue({
        id: "viewer-1",
        twitchUserId: "twitch-1",
        tokenVersion: 1, // DB has newer version
        consentedAt: null,
        consentVersion: 1,
        isAnonymized: false,
      });

      await controller.refresh(mockReq as Request, mockRes as Response);

      expect(ViewerAuthSnapshotService.invalidateViewerAuthSnapshot).toHaveBeenCalledWith(
        "viewer-1",
        "twitch-1"
      );
      expect(statusMock).toHaveBeenCalledWith(401);
      expect(jsonMock).toHaveBeenCalledWith({ error: "Token has been invalidated" });
      // Cookies should be cleared
      expect(cookieMock).toHaveBeenCalledWith("auth_token", "deleted", expect.any(Object));
      expect(cookieMock).toHaveBeenCalledWith("refresh_token", "deleted", expect.any(Object));
    });

    it("should skip tokenVersion check when viewerId is absent from payload", async () => {
      mockReq.cookies = { refresh_token: "old_rt" };
      (JwtUtils.verifyRefreshToken as jest.Mock).mockReturnValue({
        // no viewerId in payload
        streamerId: "s1",
        tokenType: "refresh",
      });
      (JwtUtils.signAccessToken as jest.Mock).mockReturnValue("new_at");
      (JwtUtils.signRefreshToken as jest.Mock).mockReturnValue("new_rt");

      await controller.refresh(mockReq as Request, mockRes as Response);

      expect(ViewerAuthSnapshotService.getViewerAuthSnapshotById).not.toHaveBeenCalled();
      expect(jsonMock).toHaveBeenCalledWith({ message: "refreshed" });
    });

    it("should strip tokenType from payload before signing new tokens", async () => {
      mockReq.cookies = { refresh_token: "old_rt" };
      (JwtUtils.verifyRefreshToken as jest.Mock).mockReturnValue({
        userId: "u1",
        tokenType: "refresh",
        someOtherField: "value",
      });
      (JwtUtils.signAccessToken as jest.Mock).mockReturnValue("at2");
      (JwtUtils.signRefreshToken as jest.Mock).mockReturnValue("rt2");

      await controller.refresh(mockReq as Request, mockRes as Response);

      // signAccessToken should NOT have tokenType in its argument
      const signAccessArgs = (JwtUtils.signAccessToken as jest.Mock).mock.calls[0][0];
      expect(signAccessArgs).not.toHaveProperty("tokenType");
    });
  });

  // ============================================================
  // clearAuthCookies (exported standalone function)
  // ============================================================
  describe("clearAuthCookies", () => {
    it("should set both cookies to deleted with maxAge -1", () => {
      clearAuthCookies(mockRes as Response);

      expect(cookieMock).toHaveBeenCalledWith(
        "auth_token",
        "deleted",
        expect.objectContaining({ maxAge: -1 })
      );
      expect(cookieMock).toHaveBeenCalledWith(
        "refresh_token",
        "deleted",
        expect.objectContaining({ maxAge: -1 })
      );
    });
  });

  // ============================================================
  // AUTH_COOKIE_OPTIONS (exported constant)
  // ============================================================
  describe("AUTH_COOKIE_OPTIONS", () => {
    it("should have expected base properties", () => {
      expect(AUTH_COOKIE_OPTIONS).toMatchObject({
        httpOnly: true,
        sameSite: "lax",
        path: "/",
      });
    });
  });
});
