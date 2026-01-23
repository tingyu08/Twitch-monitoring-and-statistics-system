import { AuthController } from "../auth.controller";
import { Request, Response } from "express";
import { TwitchOAuthClient } from "../twitch-oauth.client";
import * as AuthService from "../auth.service";
import * as JwtUtils from "../jwt.utils";
import crypto from "crypto";

jest.mock("../auth.service");
jest.mock("../jwt.utils");
jest.mock("crypto");

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
    // Create a mock client
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
  });

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

    it("should handle errors", async () => {
      (crypto.randomBytes as jest.Mock).mockImplementation(() => {
        throw new Error("Crypto Error");
      });

      await controller.login(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(500);
      expect(jsonMock).toHaveBeenCalledWith({
        message: "Internal Server Error",
      });
    });
  });

  describe("twitchCallback", () => {
    it("should handle state mismatch", async () => {
      mockReq.query = { state: "state1", code: "code1" };
      mockReq.cookies = { twitch_auth_state: "state2" };

      await controller.twitchCallback(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(403);
      expect(jsonMock).toHaveBeenCalledWith({
        message: "Invalid state parameter (CSRF detected)",
      });
    });

    it("should handle missing code", async () => {
      mockReq.query = { state: "state1" };
      mockReq.cookies = { twitch_auth_state: "state1" };

      await controller.twitchCallback(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        message: "Authorization code missing",
      });
    });

    it("should success login and set cookies", async () => {
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

    it("should redirect to error on service failure", async () => {
      mockReq.query = { state: "state1", code: "code1" };
      mockReq.cookies = { twitch_auth_state: "state1" };
      (AuthService.handleStreamerTwitchCallback as jest.Mock).mockRejectedValue(new Error("Fail"));

      await controller.twitchCallback(mockReq as Request, mockRes as Response);

      expect(redirectMock).toHaveBeenCalledWith(
        expect.stringContaining("/auth/error?reason=internal_error")
      );
    });

    it("should handle error query param from twitch", async () => {
      mockReq.query = {
        error: "access_denied",
        error_description: "User denied",
      };
      await controller.twitchCallback(mockReq as Request, mockRes as Response);
      expect(redirectMock).toHaveBeenCalledWith(
        expect.stringContaining("/auth/error?reason=access_denied")
      );
    });
  });

  describe("me", () => {
    it("should return user info", async () => {
      const user = { userId: "u1" };
      mockReq.user = user;
      await controller.me(mockReq as Request, mockRes as Response);
      expect(jsonMock).toHaveBeenCalledWith({ user });
    });

    it("should return 401 if no user", async () => {
      mockReq.user = undefined;
      await controller.me(mockReq as Request, mockRes as Response);
      expect(statusMock).toHaveBeenCalledWith(401);
    });
  });

  describe("logout", () => {
    it("should clear cookies", async () => {
      await controller.logout(mockReq as Request, mockRes as Response);
      // The controller uses res.cookie with maxAge: -1 to clear cookies
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

  describe("refresh", () => {
    it("should issue new tokens", async () => {
      mockReq.cookies = { refresh_token: "old_rt" };
      (JwtUtils.verifyRefreshToken as jest.Mock).mockReturnValue({
        userId: "u1",
      });
      (JwtUtils.signAccessToken as jest.Mock).mockReturnValue("at2");
      (JwtUtils.signRefreshToken as jest.Mock).mockReturnValue("rt2");

      await controller.refresh(mockReq as Request, mockRes as Response);

      expect(cookieMock).toHaveBeenCalledWith("auth_token", "at2", expect.any(Object));
      expect(jsonMock).toHaveBeenCalledWith({ message: "refreshed" });
    });

    it("should return 401 if refresh token missing", async () => {
      mockReq.cookies = {};
      await controller.refresh(mockReq as Request, mockRes as Response);
      expect(statusMock).toHaveBeenCalledWith(401);
    });

    it("should return 401 if token invalid", async () => {
      mockReq.cookies = { refresh_token: "bad" };
      (JwtUtils.verifyRefreshToken as jest.Mock).mockReturnValue(null);
      await controller.refresh(mockReq as Request, mockRes as Response);
      expect(statusMock).toHaveBeenCalledWith(401);
    });
  });
});
