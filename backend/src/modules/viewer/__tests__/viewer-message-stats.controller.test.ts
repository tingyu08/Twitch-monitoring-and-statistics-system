// Mock 需在 import 前聲明
jest.mock("../viewer-message-stats.service");

jest.mock("../../auth/auth.middleware", () => ({
  requireAuth: () => (req: any, _res: any, next: any) => {
    req.user = { viewerId: "viewer1", role: "viewer" };
    next();
  },
}));

// 讓 cache-control middleware 直接 pass-through
jest.mock("../../../middlewares/cache-control.middleware", () => ({
  semiStaticCache: (_req: any, _res: any, next: any) => next(),
  dynamicCache: (_req: any, _res: any, next: any) => next(),
  noCache: (_req: any, _res: any, next: any) => next(),
}));

jest.mock("../../../utils/logger", () => ({
  logger: { debug: jest.fn(), info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

import request from "supertest";
import express from "express";
import { viewerApiRoutes } from "../viewer.routes";
import { getViewerMessageStats } from "../viewer-message-stats.service";

const app = express();
app.use(express.json());
app.use("/api/viewer", viewerApiRoutes);

const mockResult = {
  channelId: "channel1",
  timeRange: { startDate: "2026-01-01", endDate: "2026-01-31" },
  summary: {
    totalMessages: 100,
    avgMessagesPerStream: 10,
    mostActiveDate: "2026-01-15",
    mostActiveDateCount: 25,
    lastMessageAt: "2026-01-31",
  },
  interactionBreakdown: {
    chatMessages: 80,
    subscriptions: 5,
    cheers: 10,
    giftSubs: 3,
    raids: 2,
    totalBits: 500,
  },
  dailyBreakdown: [],
};

describe("ViewerMessageStatsController", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("GET /:viewerId/channels/:channelId/message-stats", () => {
    it("應回傳 200 與訊息統計資料", async () => {
      (getViewerMessageStats as jest.Mock).mockResolvedValue(mockResult);

      const res = await request(app).get(
        "/api/viewer/viewer1/channels/channel1/message-stats"
      );

      expect(res.status).toBe(200);
      expect(res.body.channelId).toBe("channel1");
      expect(res.body.summary.totalMessages).toBe(100);
      expect(getViewerMessageStats).toHaveBeenCalledWith(
        "viewer1",
        "channel1",
        undefined,
        undefined
      );
    });

    it("應將 startDate 與 endDate query params 傳給 service", async () => {
      (getViewerMessageStats as jest.Mock).mockResolvedValue(mockResult);

      await request(app).get(
        "/api/viewer/viewer1/channels/channel1/message-stats?startDate=2026-01-01&endDate=2026-01-31"
      );

      expect(getViewerMessageStats).toHaveBeenCalledWith(
        "viewer1",
        "channel1",
        "2026-01-01",
        "2026-01-31"
      );
    });

    it("viewer 存取其他 viewer 資料時應回傳 403", async () => {
      // auth middleware 注入 viewerId: "viewer1"，但路徑使用 other-viewer
      const res = await request(app).get(
        "/api/viewer/other-viewer/channels/channel1/message-stats"
      );

      expect(res.status).toBe(403);
      expect(res.body.error).toBe("Forbidden");
      expect(getViewerMessageStats).not.toHaveBeenCalled();
    });

    it("service 拋出例外時應回傳 500", async () => {
      (getViewerMessageStats as jest.Mock).mockRejectedValue(new Error("DB Error"));

      const res = await request(app).get(
        "/api/viewer/viewer1/channels/channel1/message-stats"
      );

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Internal Server Error");
    });

    it("回傳資料應包含完整的 interactionBreakdown 欄位", async () => {
      (getViewerMessageStats as jest.Mock).mockResolvedValue(mockResult);

      const res = await request(app).get(
        "/api/viewer/viewer1/channels/channel1/message-stats"
      );

      expect(res.body.interactionBreakdown).toMatchObject({
        chatMessages: expect.any(Number),
        subscriptions: expect.any(Number),
        cheers: expect.any(Number),
        giftSubs: expect.any(Number),
        raids: expect.any(Number),
        totalBits: expect.any(Number),
      });
    });
  });
});
