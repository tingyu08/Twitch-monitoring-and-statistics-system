/**
 * Story 3.4: Security & Access Control - Integration Tests
 * Tests for auth middleware, JWT validation, and security headers
 */
import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import cors from "cors";
import { requireAuth } from "../../modules/auth/auth.middleware";
import { signAccessToken } from "../../modules/auth/jwt.utils";

// Create test app with security middleware
const app = express();
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({ origin: "http://localhost:3000", credentials: true }));
app.use(express.json());
app.use(cookieParser());

// Test routes
app.get("/public", (req, res) => res.json({ message: "public" }));

app.get(
  "/protected",
  (req, res, next) => requireAuth(req, res, next, []),
  (req, res) => res.json({ message: "protected", user: (req as any).user })
);

app.get(
  "/streamer-only",
  (req, res, next) => requireAuth(req, res, next, ["streamer"]),
  (req, res) => res.json({ message: "streamer area" })
);

app.get(
  "/viewer-only",
  (req, res, next) => requireAuth(req, res, next, ["viewer"]),
  (req, res) => res.json({ message: "viewer area" })
);

describe("Story 3.4: Security & Access Control", () => {
  describe("Security Headers (Helmet)", () => {
    it("should include X-Content-Type-Options header", async () => {
      const res = await request(app).get("/public");
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
    });

    it("should include X-Frame-Options header", async () => {
      const res = await request(app).get("/public");
      expect(res.headers["x-frame-options"]).toBe("SAMEORIGIN");
    });

    it("should include Content-Security-Policy header", async () => {
      const res = await request(app).get("/public");
      expect(res.headers["content-security-policy"]).toBeDefined();
    });
  });

  describe("CORS Configuration", () => {
    it("should allow requests from configured origin", async () => {
      const res = await request(app).get("/public").set("Origin", "http://localhost:3000");
      expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    });

    it("should allow credentials", async () => {
      const res = await request(app).get("/public").set("Origin", "http://localhost:3000");
      expect(res.headers["access-control-allow-credentials"]).toBe("true");
    });
  });

  describe("JWT Authentication Middleware", () => {
    it("should return 401 when no token provided", async () => {
      const res = await request(app).get("/protected");
      expect(res.status).toBe(401);
      expect(res.body.error).toBe("Unauthorized");
    });

    it("should return 401 when invalid token provided", async () => {
      const res = await request(app).get("/protected").set("Cookie", "auth_token=invalid_token");
      expect(res.status).toBe(401);
    });

    it("should return 200 when valid streamer token provided", async () => {
      const token = signAccessToken({
        twitchUserId: "test123",
        displayName: "TestUser",
        role: "streamer",
        streamerId: "1",
      });
      const res = await request(app).get("/protected").set("Cookie", `auth_token=${token}`);
      expect(res.status).toBe(200);
      expect(res.body.user.twitchUserId).toBe("test123");
    });

    it("should return 200 when valid viewer token provided", async () => {
      const token = signAccessToken({
        twitchUserId: "viewer456",
        displayName: "ViewerUser",
        role: "viewer",
        viewerId: "2",
      });
      const res = await request(app).get("/protected").set("Cookie", `auth_token=${token}`);
      expect(res.status).toBe(200);
      expect(res.body.user.role).toBe("viewer");
    });
  });

  describe("Role-Based Access Control (RBAC)", () => {
    it("should allow streamer to access streamer-only route", async () => {
      const token = signAccessToken({
        twitchUserId: "streamer1",
        displayName: "Streamer",
        role: "streamer",
        streamerId: "1",
      });
      const res = await request(app).get("/streamer-only").set("Cookie", `auth_token=${token}`);
      expect(res.status).toBe(200);
    });

    it("should deny viewer from streamer-only route", async () => {
      const token = signAccessToken({
        twitchUserId: "viewer1",
        displayName: "Viewer",
        role: "viewer",
        viewerId: "1",
      });
      const res = await request(app).get("/streamer-only").set("Cookie", `auth_token=${token}`);
      expect(res.status).toBe(403);
    });

    it("should allow streamer to access viewer-only route (super role)", async () => {
      const token = signAccessToken({
        twitchUserId: "streamer1",
        displayName: "Streamer",
        role: "streamer",
        streamerId: "1",
      });
      const res = await request(app).get("/viewer-only").set("Cookie", `auth_token=${token}`);
      expect(res.status).toBe(200);
    });

    it("should allow viewer to access viewer-only route", async () => {
      const token = signAccessToken({
        twitchUserId: "viewer1",
        displayName: "Viewer",
        role: "viewer",
        viewerId: "1",
      });
      const res = await request(app).get("/viewer-only").set("Cookie", `auth_token=${token}`);
      expect(res.status).toBe(200);
    });
  });
});
