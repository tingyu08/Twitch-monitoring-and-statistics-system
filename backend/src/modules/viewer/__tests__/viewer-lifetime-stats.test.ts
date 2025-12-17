import request from "supertest";
import express from "express";
import { viewerApiRoutes } from "../viewer.routes";
import { viewerLifetimeStatsService } from "../viewer-lifetime-stats.service";

// Mock dependencies
jest.mock("../viewer-lifetime-stats.service");
jest.mock("../../auth/auth.middleware", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    req.user = { viewerId: "v1", role: "viewer" };
    next();
  },
}));

const app = express();
app.use(express.json());
app.use("/api/viewer", viewerApiRoutes);

describe("ViewerLifetimeStatsController", () => {
  const mockStats = {
    channelId: "c1",
    channelName: "Test Channel",
    lifetimeStats: {
      watchTime: { totalMinutes: 100 },
      messages: { totalMessages: 50 },
      loyalty: { trackingDays: 10 },
      activity: { activeDaysLast30: 5 },
      rankings: { watchTimePercentile: 90, messagePercentile: 80 },
    },
    badges: [],
    radarScores: {},
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("GET /:viewerId/channels/:channelId/lifetime-stats", () => {
    it("should return stats successfully", async () => {
      (viewerLifetimeStatsService.getStats as jest.Mock).mockResolvedValue(
        mockStats
      );

      const res = await request(app).get(
        "/api/viewer/v1/channels/c1/lifetime-stats"
      );

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockStats);
      expect(viewerLifetimeStatsService.getStats).toHaveBeenCalledWith(
        "v1",
        "c1"
      );
    });

    it("should return empty structure when service returns null", async () => {
      (viewerLifetimeStatsService.getStats as jest.Mock).mockResolvedValue(
        null
      );

      const res = await request(app).get(
        "/api/viewer/v1/channels/c1/lifetime-stats"
      );

      expect(res.status).toBe(200);
      expect(res.body.lifetimeStats.watchTime.totalMinutes).toBe(0);
    });

    it("should handle service errors", async () => {
      (viewerLifetimeStatsService.getStats as jest.Mock).mockRejectedValue(
        new Error("DB Error")
      );

      const res = await request(app).get(
        "/api/viewer/v1/channels/c1/lifetime-stats"
      );

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "Internal server error" });
    });
  });
});
