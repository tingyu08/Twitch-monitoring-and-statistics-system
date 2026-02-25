import {
  signAccessToken,
  verifyAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  signExtensionToken,
  verifyExtensionToken,
} from "../jwt.utils";
import * as jwt from "jsonwebtoken";

// Mock environment variables
process.env.APP_JWT_SECRET = "test-secret-key-for-jwt-testing";

describe("JWT Utils", () => {
  // mockPayload without tokenType - functions add it automatically
  const mockPayload = {
    streamerId: "streamer_123",
    twitchUserId: "twitch_456",
    displayName: "Test Streamer",
    avatarUrl: "https://example.com/avatar.jpg",
    channelUrl: "https://www.twitch.tv/teststreamer",
    role: "streamer" as const,
  };

  describe("signAccessToken / verifyAccessToken", () => {
    it("should sign a valid JWT token", () => {
      const token = signAccessToken(mockPayload);
      expect(token).toBeDefined();
      expect(typeof token).toBe("string");
      expect(token.split(".")).toHaveLength(3); // JWT has 3 parts
    });

    it("should create different tokens for different payloads", () => {
      const token1 = signAccessToken(mockPayload);
      const payload2 = { ...mockPayload, displayName: "Different Name" };
      const token2 = signAccessToken(payload2);
      expect(token1).not.toBe(token2);
    });

    it("should verify a valid token and return payload", () => {
      const token = signAccessToken(mockPayload);
      const decoded = verifyAccessToken(token);
      expect(decoded).not.toBeNull();
      expect(decoded?.tokenType).toBe("access");
      expect(decoded).toMatchObject({
        streamerId: mockPayload.streamerId,
        role: "streamer",
      });
    });

    it("should return null for invalid token", () => {
      const invalidToken = "invalid.token.here";
      const decoded = verifyAccessToken(invalidToken);
      expect(decoded).toBeNull();
    });

    it("should return null for tampered token", () => {
      const token = signAccessToken(mockPayload);
      const tamperedToken = token.slice(0, -5) + "xxxxx";
      const decoded = verifyAccessToken(tamperedToken);
      expect(decoded).toBeNull();
    });
  });

  describe("extension tokens", () => {
    it("should sign and verify extension token", () => {
      const token = signExtensionToken("viewer_789", 1);
      const decoded = verifyExtensionToken(token);
      expect(decoded).not.toBeNull();
      expect(decoded?.tokenType).toBe("extension");
      expect(decoded?.viewerId).toBe("viewer_789");
      expect(decoded?.tokenVersion).toBe(1);
    });

    it("should return null for access token verified as extension token", () => {
      const token = signAccessToken(mockPayload);
      const decoded = verifyExtensionToken(token);
      expect(decoded).toBeNull();
    });

    it("should return null for invalid extension token", () => {
      const decoded = verifyExtensionToken("invalid.token.here");
      expect(decoded).toBeNull();
    });

    it("should create different extension tokens for different viewers", () => {
      const token1 = signExtensionToken("viewer_1", 1);
      const token2 = signExtensionToken("viewer_2", 1);
      expect(token1).not.toBe(token2);
    });

    it("should include tokenVersion in extension token", () => {
      const token = signExtensionToken("viewer_123", 5);
      const decoded = verifyExtensionToken(token);
      expect(decoded?.tokenVersion).toBe(5);
    });
  });

  describe("refresh tokens", () => {
    it("should sign and verify refresh token", () => {
      const token = signRefreshToken(mockPayload);
      const decoded = verifyRefreshToken(token);
      expect(decoded?.tokenType).toBe("refresh");
      expect(decoded?.role).toBe("streamer");
    });

    it("should fail verification when token type mismatches", () => {
      const token = signAccessToken(mockPayload);
      const decoded = verifyRefreshToken(token);
      expect(decoded).toBeNull();
    });

    it("should return null for token signed with different secret", () => {
      const originalSecret = process.env.APP_JWT_SECRET;
      process.env.APP_JWT_SECRET = "different-secret";

      const wrongToken = jwt.sign({ ...mockPayload, tokenType: "refresh" }, "different-secret", {
        expiresIn: "7d",
      });

      process.env.APP_JWT_SECRET = originalSecret;

      const decoded = verifyRefreshToken(wrongToken);
      expect(decoded).toBeNull();
    });
  });
});
