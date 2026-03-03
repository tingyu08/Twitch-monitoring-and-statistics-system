import type { Response } from "express";

import type { AuthRequest } from "../../auth/auth.middleware";
import { logger } from "../../../utils/logger";
import { viewerLifetimeStatsService } from "../viewer-lifetime-stats.service";
import { ViewerLifetimeStatsController } from "../viewer-lifetime-stats.controller";

jest.mock("../viewer-lifetime-stats.service", () => ({
  viewerLifetimeStatsService: {
    getStats: jest.fn(),
  },
}));

jest.mock("../../../utils/logger", () => ({
  logger: {
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

type MockResponse = Response & {
  status: jest.Mock;
  json: jest.Mock;
};

function makeRes(): MockResponse {
  const res = {
    status: jest.fn(),
    json: jest.fn(),
  } as unknown as MockResponse;

  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

function makeReq(overrides: Partial<AuthRequest> = {}): AuthRequest {
  return {
    params: {},
    query: {},
    body: {},
    ...overrides,
  } as AuthRequest;
}

const mockedViewerLifetimeStatsService = viewerLifetimeStatsService as jest.Mocked<
  typeof viewerLifetimeStatsService
>;
const mockedLogger = logger as jest.Mocked<typeof logger>;

describe("ViewerLifetimeStatsController", () => {
  let controller: ViewerLifetimeStatsController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new ViewerLifetimeStatsController();
  });

  describe("getLifetimeStats", () => {
    it("returns 401 when viewerId is missing", async () => {
      const req = makeReq({ params: { channelId: "channel-1" }, user: undefined });
      const res = makeRes();

      await controller.getLifetimeStats(req, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: "Unauthorized" });
      expect(mockedViewerLifetimeStatsService.getStats).not.toHaveBeenCalled();
    });

    it("returns service result when data exists", async () => {
      const mockResult = {
        channelId: "channel-1",
        channelName: "channel-name",
        channelDisplayName: "Channel Name",
        lifetimeStats: {
          watchTime: {
            totalMinutes: 100,
            totalHours: 2,
            avgSessionMinutes: 10,
            firstWatchedAt: null,
            lastWatchedAt: null,
          },
          messages: {
            totalMessages: 30,
            chatMessages: 20,
            subscriptions: 5,
            cheers: 2,
            totalBits: 100,
          },
          loyalty: {
            trackingDays: 30,
            longestStreakDays: 5,
            currentStreakDays: 2,
          },
          activity: {
            activeDaysLast30: 15,
            activeDaysLast90: 25,
            mostActiveMonth: "2026-01",
            mostActiveMonthCount: 10,
          },
          rankings: { watchTimePercentile: 80, messagePercentile: 70 },
        },
        badges: [],
        radarScores: {
          watchTime: 60,
          interaction: 50,
          loyalty: 40,
          activity: 30,
          contribution: 20,
          community: 10,
        },
      };
      mockedViewerLifetimeStatsService.getStats.mockResolvedValue(
        mockResult as Awaited<ReturnType<typeof viewerLifetimeStatsService.getStats>>
      );

      const req = makeReq({
        params: { channelId: "channel-1" },
        user: { viewerId: "viewer-1" } as AuthRequest["user"],
      });
      const res = makeRes();

      await controller.getLifetimeStats(req, res);

      expect(mockedViewerLifetimeStatsService.getStats).toHaveBeenCalledWith("viewer-1", "channel-1");
      expect(res.json).toHaveBeenCalledWith(mockResult);
    });

    it("returns default empty structure when service result is null", async () => {
      mockedViewerLifetimeStatsService.getStats.mockResolvedValue(null);

      const req = makeReq({
        params: { channelId: "channel-1" },
        user: { viewerId: "viewer-1" } as AuthRequest["user"],
      });
      const res = makeRes();

      await controller.getLifetimeStats(req, res);

      expect(res.json).toHaveBeenCalledWith({
        channelId: "channel-1",
        channelName: "",
        channelDisplayName: "",
        lifetimeStats: {
          watchTime: {
            totalMinutes: 0,
            totalHours: 0,
            avgSessionMinutes: 0,
            firstWatchedAt: null,
            lastWatchedAt: null,
          },
          messages: {
            totalMessages: 0,
            chatMessages: 0,
            subscriptions: 0,
            cheers: 0,
            totalBits: 0,
          },
          loyalty: {
            trackingDays: 0,
            longestStreakDays: 0,
            currentStreakDays: 0,
          },
          activity: {
            activeDaysLast30: 0,
            activeDaysLast90: 0,
            mostActiveMonth: null,
            mostActiveMonthCount: 0,
          },
          rankings: { watchTimePercentile: 0, messagePercentile: 0 },
        },
        badges: [],
        radarScores: {
          watchTime: 0,
          interaction: 0,
          loyalty: 0,
          activity: 0,
          contribution: 0,
          community: 0,
        },
      });
    });

    it("logs and returns 500 when service throws", async () => {
      mockedViewerLifetimeStatsService.getStats.mockRejectedValue(new Error("boom"));

      const req = makeReq({
        params: { channelId: "channel-1" },
        user: { viewerId: "viewer-1" } as AuthRequest["user"],
      });
      const res = makeRes();

      await controller.getLifetimeStats(req, res);

      expect(mockedLogger.error).toHaveBeenCalledWith(
        "ViewerLifetimeStats",
        "Error getting lifetime stats",
        expect.any(Error)
      );
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: "Internal server error" });
    });
  });
});
