import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";
import { signToken } from "../jwt.utils";
import { requireAuth, getMeHandler } from "../auth.routes";
import type { AuthRequest } from "../auth.middleware";

// Mock environment variables
process.env.APP_JWT_SECRET = "test-secret-key-for-integration-testing";
process.env.FRONTEND_URL = "http://localhost:3000";

describe("Auth Integration Tests", () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.get("/api/auth/me", requireAuth, getMeHandler);
  });

  describe("GET /api/auth/me", () => {
    it("should return 401 when no token is provided", async () => {
      const response = await request(app).get("/api/auth/me");

      expect(response.status).toBe(401);
      expect(response.body).toMatchObject({
        error: "Unauthorized: No token provided",
      });
    });

    it("should return 401 when token is invalid", async () => {
      const response = await request(app)
        .get("/api/auth/me")
        .set("Cookie", "auth_token=invalid.token.here");

      expect(response.status).toBe(401);
      expect(response.body).toMatchObject({
        error: "Unauthorized: Invalid token",
      });
    });

    it("should return user info when token is valid", async () => {
      const payload = {
        streamerId: "streamer_123",
        twitchUserId: "twitch_456",
        displayName: "Test Streamer",
        avatarUrl: "https://example.com/avatar.jpg",
        channelUrl: "https://www.twitch.tv/teststreamer",
      };
      const token = signToken(payload);

      const response = await request(app)
        .get("/api/auth/me")
        .set("Cookie", `auth_token=${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        streamerId: payload.streamerId,
        twitchUserId: payload.twitchUserId,
        displayName: payload.displayName,
        avatarUrl: payload.avatarUrl,
        channelUrl: payload.channelUrl,
      });
    });
  });
});

