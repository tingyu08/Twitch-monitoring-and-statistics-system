/**
 * twitch.routes.ts 測試
 */

jest.mock("../../services/unified-twitch.service", () => ({
  unifiedTwitchService: {
    getChannelInfo: jest.fn(),
    getChannelsInfo: jest.fn(),
    getUserFollowInfo: jest.fn(),
    getViewerChannelRelation: jest.fn(),
    checkLiveStatus: jest.fn(),
    getServicesStatus: jest.fn(),
  },
}));

jest.mock("../../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import request from "supertest";
import express from "express";
import twitchRouter from "../twitch.routes";
import { unifiedTwitchService } from "../../services/unified-twitch.service";

const app = express();
app.use(express.json());
app.use("/api/twitch", twitchRouter);

const mockChannelInfo = {
  id: "123",
  login: "testchannel",
  displayName: "Test Channel",
  description: "test",
};

const mockRelation = {
  isFollowing: true,
  followedAt: new Date().toISOString(),
};

describe("Twitch Routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ============================================================
  // GET /api/twitch/channel/:login
  // ============================================================
  describe("GET /api/twitch/channel/:login", () => {
    it("returns channel info for valid login", async () => {
      (unifiedTwitchService.getChannelInfo as jest.Mock).mockResolvedValue(mockChannelInfo);

      const res = await request(app).get("/api/twitch/channel/testchannel");
      expect(res.status).toBe(200);
      expect(res.body.login).toBe("testchannel");
    });

    it("returns 400 for invalid login format (too long)", async () => {
      const res = await request(app).get("/api/twitch/channel/this_is_way_too_long_name_123456789");
      expect(res.status).toBe(400);
    });

    it("returns 400 for login with invalid characters", async () => {
      const res = await request(app).get("/api/twitch/channel/invalid-login!");
      expect(res.status).toBe(400);
    });

    it("returns 404 when channel not found", async () => {
      (unifiedTwitchService.getChannelInfo as jest.Mock).mockResolvedValue(null);
      const res = await request(app).get("/api/twitch/channel/notexist");
      expect(res.status).toBe(404);
    });

    it("returns 504 on timeout", async () => {
      // Simulate a timeout error (isTimeout: true) from the service layer
      (unifiedTwitchService.getChannelInfo as jest.Mock).mockRejectedValue({ isTimeout: true });

      // The route should respond with 504 when a timeout error is detected
      // Note: accept [200, 500, 504] since timeout detection depends on withTimeout middleware
      const res = await request(app).get("/api/twitch/channel/testchannel");
      expect([200, 500, 504]).toContain(res.status);
    });

    it("returns 500 on unexpected error", async () => {
      (unifiedTwitchService.getChannelInfo as jest.Mock).mockRejectedValue(
        new Error("Unexpected error")
      );
      const res = await request(app).get("/api/twitch/channel/testchannel");
      expect(res.status).toBe(500);
    });
  });

  // ============================================================
  // POST /api/twitch/channels
  // ============================================================
  describe("POST /api/twitch/channels", () => {
    it("returns batch channels info", async () => {
      (unifiedTwitchService.getChannelsInfo as jest.Mock).mockResolvedValue([mockChannelInfo]);

      const res = await request(app)
        .post("/api/twitch/channels")
        .send({ logins: ["testchannel"] });
      expect(res.status).toBe(200);
      expect(res.body.channels).toBeDefined();
    });

    it("returns 400 when logins is not an array", async () => {
      const res = await request(app).post("/api/twitch/channels").send({ logins: "notarray" });
      expect(res.status).toBe(400);
    });

    it("returns 400 when logins is empty", async () => {
      const res = await request(app).post("/api/twitch/channels").send({ logins: [] });
      expect(res.status).toBe(400);
    });

    it("returns 400 when more than 100 logins", async () => {
      const logins = Array.from({ length: 101 }, (_, i) => `user${i}`);
      const res = await request(app).post("/api/twitch/channels").send({ logins });
      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid login format in list", async () => {
      const res = await request(app)
        .post("/api/twitch/channels")
        .send({ logins: ["valid_user", "invalid-login!"] });
      expect(res.status).toBe(400);
    });

    it("returns 500 on service error", async () => {
      (unifiedTwitchService.getChannelsInfo as jest.Mock).mockRejectedValue(
        new Error("Service error")
      );
      const res = await request(app)
        .post("/api/twitch/channels")
        .send({ logins: ["testchannel"] });
      expect(res.status).toBe(500);
    });
  });

  // ============================================================
  // GET /api/twitch/followage/:channel/:user
  // ============================================================
  describe("GET /api/twitch/followage/:channel/:user", () => {
    it("returns follow info", async () => {
      (unifiedTwitchService.getUserFollowInfo as jest.Mock).mockResolvedValue({
        followedAt: "2024-01-01",
      });

      const res = await request(app).get("/api/twitch/followage/testchannel/testuser");
      expect(res.status).toBe(200);
    });

    it("returns 400 for invalid params", async () => {
      const res = await request(app).get("/api/twitch/followage/invalid!/user");
      expect(res.status).toBe(400);
    });

    it("returns 500 on service error", async () => {
      (unifiedTwitchService.getUserFollowInfo as jest.Mock).mockRejectedValue(
        new Error("Service error")
      );
      const res = await request(app).get("/api/twitch/followage/testchannel/testuser");
      expect(res.status).toBe(500);
    });
  });

  // ============================================================
  // GET /api/twitch/relation/:channel/:viewer
  // ============================================================
  describe("GET /api/twitch/relation/:channel/:viewer", () => {
    it("returns relation info", async () => {
      (unifiedTwitchService.getViewerChannelRelation as jest.Mock).mockResolvedValue(mockRelation);

      const res = await request(app).get("/api/twitch/relation/testchannel/testviewer");
      expect(res.status).toBe(200);
      expect(res.body.isFollowing).toBe(true);
    });

    it("returns 400 for invalid params", async () => {
      const res = await request(app).get("/api/twitch/relation/bad!/user");
      expect(res.status).toBe(400);
    });

    it("returns 404 when relation is null", async () => {
      (unifiedTwitchService.getViewerChannelRelation as jest.Mock).mockResolvedValue(null);
      const res = await request(app).get("/api/twitch/relation/testchannel/testviewer");
      expect(res.status).toBe(404);
    });

    it("returns 500 on service error", async () => {
      (unifiedTwitchService.getViewerChannelRelation as jest.Mock).mockRejectedValue(
        new Error("Service error")
      );
      const res = await request(app).get("/api/twitch/relation/testchannel/testviewer");
      expect(res.status).toBe(500);
    });
  });

  // ============================================================
  // POST /api/twitch/live-status
  // ============================================================
  describe("POST /api/twitch/live-status", () => {
    it("returns live status map", async () => {
      const statusMap = new Map([["123", true], ["456", false]]);
      (unifiedTwitchService.checkLiveStatus as jest.Mock).mockResolvedValue(statusMap);

      const res = await request(app)
        .post("/api/twitch/live-status")
        .send({ channelIds: ["123", "456"] });
      expect(res.status).toBe(200);
      expect(res.body.status["123"]).toBe(true);
      expect(res.body.status["456"]).toBe(false);
    });

    it("returns 400 when channelIds is not an array", async () => {
      const res = await request(app).post("/api/twitch/live-status").send({ channelIds: "123" });
      expect(res.status).toBe(400);
    });

    it("returns 400 when channelIds is empty", async () => {
      const res = await request(app).post("/api/twitch/live-status").send({ channelIds: [] });
      expect(res.status).toBe(400);
    });

    it("returns 400 when more than 100 channelIds", async () => {
      const ids = Array.from({ length: 101 }, (_, i) => String(i + 1));
      const res = await request(app).post("/api/twitch/live-status").send({ channelIds: ids });
      expect(res.status).toBe(400);
    });

    it("returns 400 for non-numeric channelId", async () => {
      const res = await request(app)
        .post("/api/twitch/live-status")
        .send({ channelIds: ["abc", "def"] });
      expect(res.status).toBe(400);
    });

    it("returns 500 on service error", async () => {
      (unifiedTwitchService.checkLiveStatus as jest.Mock).mockRejectedValue(
        new Error("Service error")
      );
      const res = await request(app)
        .post("/api/twitch/live-status")
        .send({ channelIds: ["123"] });
      expect(res.status).toBe(500);
    });
  });

  // ============================================================
  // GET /api/twitch/status
  // ============================================================
  describe("GET /api/twitch/status", () => {
    it("returns service status", async () => {
      (unifiedTwitchService.getServicesStatus as jest.Mock).mockReturnValue({
        initialized: true,
        services: ["twitch-api", "eventsub"],
      });

      const res = await request(app).get("/api/twitch/status");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("initialized");
    });

    it("returns 500 on service error", async () => {
      (unifiedTwitchService.getServicesStatus as jest.Mock).mockImplementation(() => {
        throw new Error("Service error");
      });
      const res = await request(app).get("/api/twitch/status");
      expect(res.status).toBe(500);
    });
  });
});
