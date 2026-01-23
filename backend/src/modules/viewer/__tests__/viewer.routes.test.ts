import request from "supertest";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import { viewerApiRoutes } from "../viewer.routes";
import { getFollowedChannels } from "../viewer.service";

// Mock service
jest.mock("../viewer.service", () => ({
  getFollowedChannels: jest.fn(),
  seedChannelStats: jest.fn(),
}));

// Mock middleware (Auth) - 正確匹配 requireAuth(req, res, next, roles) 簽名
jest.mock("../../auth/auth.middleware", () => ({
  requireAuth: (
    req: Request & { user?: { viewerId: string; role: "viewer" } },
    _res: Response,
    next: NextFunction,
    _roles: unknown
  ) => {
    // Simulate authenticated user
    req.user = { viewerId: "viewer_test_1", role: "viewer" };
    next();
  },
}));

const app = express();
app.use(express.json());
app.use("/api/viewer", viewerApiRoutes);

describe("Viewer Routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("GET /channels", () => {
    it("should return list of followed channels", async () => {
      const mockChannels = [
        {
          id: "ch_1",
          channelName: "shroud",
          displayName: "Shroud",
          avatarUrl: "http://example.com/live.jpg",
          isLive: true,
          totalWatchMinutes: 120,
          messageCount: 5,
        },
      ];
      (getFollowedChannels as jest.Mock).mockResolvedValue(mockChannels);

      const res = await request(app).get("/api/viewer/channels");
      if (res.status !== 200) console.log("ERROR:", res.status, res.text);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].channelName).toBe("shroud");
      // Check if hotfix logic (ui-avatars) was applied or not?
      // Since we mock getFollowedChannels, the controller logic runs.
      // Controller has a Hotfix mapping to ui-avatars.
      // Tests should reflect that if the logic is in controller.
    });

    it("should handle empty list", async () => {
      // Mock empty return - 控制器直接返回空陣列，沒有自動種子資料邏輯
      (getFollowedChannels as jest.Mock).mockResolvedValue([]);

      const res = await request(app).get("/api/viewer/channels");

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(0);
    });
  });
});
