import type { Request, Response, NextFunction } from "express";
import { requireAuth, type AuthRequest } from "../auth.middleware";
import { signToken } from "../jwt.utils";

// Mock environment variables
process.env.APP_JWT_SECRET = "test-secret-key-for-middleware-testing";

describe("requireAuth Middleware", () => {
  let mockRequest: Partial<AuthRequest>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    mockRequest = {
      cookies: {},
    };
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    mockNext = jest.fn();
  });

  describe("when token is missing", () => {
    it("should return 401 with error message", () => {
      requireAuth(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: "Unauthorized: No token provided",
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it("should return 401 when cookies object is undefined", () => {
      mockRequest.cookies = undefined;
      requireAuth(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: "Unauthorized: No token provided",
      });
    });
  });

  describe("when token is invalid", () => {
    it("should return 401 for invalid token", () => {
      mockRequest.cookies = { auth_token: "invalid.token.here" };
      requireAuth(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: "Unauthorized: Invalid token",
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it("should return 401 for tampered token", () => {
      const validToken = signToken({
        streamerId: "streamer_123",
        twitchUserId: "twitch_456",
        displayName: "Test",
        avatarUrl: "https://example.com/avatar.jpg",
        channelUrl: "https://www.twitch.tv/test",
      });
      mockRequest.cookies = { auth_token: validToken.slice(0, -5) + "xxxxx" };
      requireAuth(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: "Unauthorized: Invalid token",
      });
    });
  });

  describe("when token is valid", () => {
    it("should call next() and attach user to request", () => {
      const payload = {
        streamerId: "streamer_123",
        twitchUserId: "twitch_456",
        displayName: "Test Streamer",
        avatarUrl: "https://example.com/avatar.jpg",
        channelUrl: "https://www.twitch.tv/teststreamer",
      };
      const token = signToken(payload);
      mockRequest.cookies = { auth_token: token };

      requireAuth(
        mockRequest as AuthRequest,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalled();
      expect(mockRequest.user).toMatchObject(payload);
      expect(mockResponse.status).not.toHaveBeenCalled();
      expect(mockResponse.json).not.toHaveBeenCalled();
    });
  });
});

