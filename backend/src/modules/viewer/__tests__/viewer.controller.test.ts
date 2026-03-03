import type { Response } from "express";

import type { AuthRequest } from "../../auth/auth.middleware";
import { CacheTags } from "../../../constants";
import { ViewerController } from "../viewer.controller";
import { getChannelGameStatsAndViewerTrends } from "../../streamer/streamer.service";
import { getAdaptiveTTL, cacheManager, CacheTTL } from "../../../utils/cache-manager";
import { logger } from "../../../utils/logger";
import { getViewerMessageStats } from "../viewer-message-stats.service";
import {
  getChannelStats,
  getFollowedChannels,
  recordConsent,
} from "../viewer.service";

jest.mock("../viewer.service", () => ({
  recordConsent: jest.fn(),
  getChannelStats: jest.fn(),
  getFollowedChannels: jest.fn(),
}));

jest.mock("../viewer-message-stats.service", () => ({
  getViewerMessageStats: jest.fn(),
}));

jest.mock("../../streamer/streamer.service", () => ({
  getChannelGameStatsAndViewerTrends: jest.fn(),
}));

jest.mock("../../../utils/cache-manager", () => ({
  cacheManager: {
    getOrSetWithTags: jest.fn(),
  },
  CacheTTL: {
    MEDIUM: 180,
  },
  getAdaptiveTTL: jest.fn(),
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

const mockedRecordConsent = recordConsent as jest.MockedFunction<typeof recordConsent>;
const mockedGetChannelStats = getChannelStats as jest.MockedFunction<typeof getChannelStats>;
const mockedGetFollowedChannels = getFollowedChannels as jest.MockedFunction<typeof getFollowedChannels>;
const mockedGetViewerMessageStats = getViewerMessageStats as jest.MockedFunction<
  typeof getViewerMessageStats
>;
const mockedGetChannelGameStatsAndViewerTrends =
  getChannelGameStatsAndViewerTrends as jest.MockedFunction<
    typeof getChannelGameStatsAndViewerTrends
  >;
const mockedGetAdaptiveTTL = getAdaptiveTTL as jest.MockedFunction<typeof getAdaptiveTTL>;
const mockedCacheManager = cacheManager as jest.Mocked<typeof cacheManager>;
const mockedLogger = logger as jest.Mocked<typeof logger>;

describe("ViewerController", () => {
  let controller: ViewerController;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetAdaptiveTTL.mockReturnValue(120);
    mockedCacheManager.getOrSetWithTags.mockImplementation(
      async (_key, factory) => await factory()
    );
    controller = new ViewerController();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe("consent", () => {
    it("returns 403 when user is missing or invalid", async () => {
      const req = makeReq({ user: undefined });
      const res = makeRes();

      await controller.consent(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: "Forbidden" });
      expect(mockedRecordConsent).not.toHaveBeenCalled();
    });

    it("returns 403 when user role is not viewer", async () => {
      const req = makeReq({
        user: { viewerId: "viewer-1", role: "streamer" } as AuthRequest["user"],
      });
      const res = makeRes();

      await controller.consent(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: "Forbidden" });
      expect(mockedRecordConsent).not.toHaveBeenCalled();
    });

    it("returns 403 when viewerId is missing", async () => {
      const req = makeReq({
        user: { role: "viewer" } as AuthRequest["user"],
      });
      const res = makeRes();

      await controller.consent(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: "Forbidden" });
      expect(mockedRecordConsent).not.toHaveBeenCalled();
    });

    it("returns 400 when consent is not provided", async () => {
      const req = makeReq({
        user: { viewerId: "viewer-1", role: "viewer" } as AuthRequest["user"],
        body: { consented: false },
      });
      const res = makeRes();

      await controller.consent(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: "consent is required" });
      expect(mockedRecordConsent).not.toHaveBeenCalled();
    });

    it("returns 400 when request body is undefined", async () => {
      const req = makeReq({
        user: { viewerId: "viewer-1", role: "viewer" } as AuthRequest["user"],
        body: undefined,
      });
      const res = makeRes();

      await controller.consent(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: "consent is required" });
      expect(mockedRecordConsent).not.toHaveBeenCalled();
    });

    it("records consent with default version and returns payload", async () => {
      mockedRecordConsent.mockResolvedValue({
        id: "viewer-1",
        consentedAt: new Date("2026-01-01T00:00:00.000Z"),
        consentVersion: 1,
      } as Awaited<ReturnType<typeof recordConsent>>);

      const req = makeReq({
        user: { viewerId: "viewer-1", role: "viewer" } as AuthRequest["user"],
        body: { consented: true },
      });
      const res = makeRes();

      await controller.consent(req, res);

      expect(mockedRecordConsent).toHaveBeenCalledWith("viewer-1", 1);
      expect(res.json).toHaveBeenCalledWith({
        viewerId: "viewer-1",
        consentedAt: new Date("2026-01-01T00:00:00.000Z"),
        consentVersion: 1,
      });
    });

    it("records consent with explicit consent version", async () => {
      mockedRecordConsent.mockResolvedValue({
        id: "viewer-1",
        consentedAt: new Date("2026-02-01T00:00:00.000Z"),
        consentVersion: 2,
      } as Awaited<ReturnType<typeof recordConsent>>);

      const req = makeReq({
        user: { viewerId: "viewer-1", role: "viewer" } as AuthRequest["user"],
        body: { consented: true, consentVersion: 2 },
      });
      const res = makeRes();

      await controller.consent(req, res);

      expect(mockedRecordConsent).toHaveBeenCalledWith("viewer-1", 2);
      expect(res.json).toHaveBeenCalledWith({
        viewerId: "viewer-1",
        consentedAt: new Date("2026-02-01T00:00:00.000Z"),
        consentVersion: 2,
      });
    });

    it("propagates service errors", async () => {
      mockedRecordConsent.mockRejectedValue(new Error("DB failed"));

      const req = makeReq({
        user: { viewerId: "viewer-1", role: "viewer" } as AuthRequest["user"],
        body: { consented: true, consentVersion: 2 },
      });
      const res = makeRes();

      await expect(controller.consent(req, res)).rejects.toThrow("DB failed");
    });
  });

  describe("getChannelStats", () => {
    it("returns 403 when viewer profile is missing", async () => {
      const req = makeReq({ user: undefined, params: { channelId: "channel-1" } });
      const res = makeRes();

      await controller.getChannelStats(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: "Forbidden: No viewer profile" });
      expect(mockedGetChannelStats).not.toHaveBeenCalled();
    });

    it("returns 400 when channelId is missing", async () => {
      const req = makeReq({ user: { viewerId: "viewer-1" } as AuthRequest["user"], params: {} });
      const res = makeRes();

      await controller.getChannelStats(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: "Channel ID is required" });
    });

    it("returns 400 for invalid date format", async () => {
      const req = makeReq({
        user: { viewerId: "viewer-1" } as AuthRequest["user"],
        params: { channelId: "channel-1" },
        query: { startDate: "2026-99-01", endDate: "2026-01-02" },
      });
      const res = makeRes();

      await controller.getChannelStats(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: "Invalid date format. Use YYYY-MM-DD" });
    });

    it("returns 400 when startDate is after endDate", async () => {
      const req = makeReq({
        user: { viewerId: "viewer-1" } as AuthRequest["user"],
        params: { channelId: "channel-1" },
        query: { startDate: "2026-02-01", endDate: "2026-01-01" },
      });
      const res = makeRes();

      await controller.getChannelStats(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: "startDate must be before endDate" });
    });

    it("returns 400 for invalid days", async () => {
      const req = makeReq({
        user: { viewerId: "viewer-1" } as AuthRequest["user"],
        params: { channelId: "channel-1" },
        query: { days: "0" },
      });
      const res = makeRes();

      await controller.getChannelStats(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: "days must be between 1 and 365" });
    });

    it("returns stats for days-based query", async () => {
      mockedGetChannelStats.mockResolvedValue({
        dailyStats: [],
        timeRange: { startDate: "2026-01-01", endDate: "2026-01-31", days: 30 },
      });

      const req = makeReq({
        user: { viewerId: "viewer-1" } as AuthRequest["user"],
        params: { channelId: "channel-1" },
        query: { days: "30" },
      });
      const res = makeRes();

      await controller.getChannelStats(req, res);

      expect(mockedGetChannelStats).toHaveBeenCalledWith("viewer-1", "channel-1", 30, undefined, undefined);
      expect(res.json).toHaveBeenCalledWith({
        dailyStats: [],
        timeRange: { startDate: "2026-01-01", endDate: "2026-01-31", days: 30 },
      });
    });

    it("returns stats for date-range query", async () => {
      mockedGetChannelStats.mockResolvedValue({
        dailyStats: [],
        timeRange: { startDate: "2026-01-01", endDate: "2026-01-31", days: 30 },
      });

      const req = makeReq({
        user: { viewerId: "viewer-1" } as AuthRequest["user"],
        params: { channelId: "channel-1" },
        query: { startDate: "2026-01-01", endDate: "2026-01-31" },
      });
      const res = makeRes();

      await controller.getChannelStats(req, res);

      expect(mockedGetChannelStats).toHaveBeenCalledTimes(1);
      expect(mockedGetChannelStats.mock.calls[0][0]).toBe("viewer-1");
      expect(mockedGetChannelStats.mock.calls[0][1]).toBe("channel-1");
      expect(mockedGetChannelStats.mock.calls[0][2]).toBeUndefined();
      expect(mockedGetChannelStats.mock.calls[0][3]).toBeInstanceOf(Date);
      expect(mockedGetChannelStats.mock.calls[0][4]).toBeInstanceOf(Date);
    });

    it("logs warning for slow queries", async () => {
      const nowSpy = jest
        .spyOn(Date, "now")
        .mockReturnValueOnce(1000)
        .mockReturnValueOnce(1251);
      mockedGetChannelStats.mockResolvedValue({
        dailyStats: [],
        timeRange: { startDate: "2026-01-01", endDate: "2026-01-31", days: 30 },
      });

      const req = makeReq({
        user: { viewerId: "viewer-1" } as AuthRequest["user"],
        params: { channelId: "channel-1" },
      });
      const res = makeRes();

      await controller.getChannelStats(req, res);

      expect(mockedLogger.warn).toHaveBeenCalledWith(
        "ViewerAPI",
        "Slow query: 251ms for channel channel-1"
      );
      nowSpy.mockRestore();
    });

    it("returns 500 when service throws", async () => {
      mockedGetChannelStats.mockRejectedValue(new Error("query failed"));

      const req = makeReq({
        user: { viewerId: "viewer-1" } as AuthRequest["user"],
        params: { channelId: "channel-1" },
      });
      const res = makeRes();

      await controller.getChannelStats(req, res);

      expect(mockedLogger.error).toHaveBeenCalledWith(
        "ViewerAPI",
        "Error getting viewer stats:",
        expect.any(Error)
      );
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: "Internal Server Error" });
    });
  });

  describe("getChannels", () => {
    it("returns 403 when viewer profile is missing", async () => {
      const req = makeReq({ user: undefined });
      const res = makeRes();

      await controller.getChannels(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: "Forbidden" });
      expect(mockedGetFollowedChannels).not.toHaveBeenCalled();
    });

    it("returns followed channels", async () => {
      mockedGetFollowedChannels.mockResolvedValue([
        {
          id: "channel-1",
          channelName: "test-channel",
          displayName: "Test Channel",
          avatarUrl: "https://example.com/avatar.jpg",
          category: "Just Chatting",
          isLive: false,
          viewerCount: 0,
          streamStartedAt: null,
          followedAt: null,
          tags: [],
          lastWatched: null,
          totalWatchMinutes: 0,
          messageCount: 0,
          isExternal: false,
        },
      ]);

      const req = makeReq({ user: { viewerId: "viewer-1" } as AuthRequest["user"] });
      const res = makeRes();

      await controller.getChannels(req, res);

      expect(mockedGetFollowedChannels).toHaveBeenCalledWith("viewer-1");
      expect(res.json).toHaveBeenCalledWith([
        expect.objectContaining({ id: "channel-1", channelName: "test-channel" }),
      ]);
    });

    it("returns 500 when service throws", async () => {
      mockedGetFollowedChannels.mockRejectedValue(new Error("failed"));

      const req = makeReq({ user: { viewerId: "viewer-1" } as AuthRequest["user"] });
      const res = makeRes();

      await controller.getChannels(req, res);

      expect(mockedLogger.error).toHaveBeenCalledWith(
        "ViewerAPI",
        "Error getting viewer channels:",
        expect.any(Error)
      );
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: "Internal Server Error" });
    });
  });

  describe("getChannelDetailAll", () => {
    it("returns 403 when viewer profile is missing", async () => {
      const req = makeReq({ user: undefined, params: { channelId: "channel-1" } });
      const res = makeRes();

      await controller.getChannelDetailAll(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: "Forbidden: No viewer profile" });
    });

    it("returns 400 when channelId is missing", async () => {
      const req = makeReq({ user: { viewerId: "viewer-1" } as AuthRequest["user"], params: {} });
      const res = makeRes();

      await controller.getChannelDetailAll(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: "Channel ID is required" });
    });

    it("returns 400 for invalid days", async () => {
      const req = makeReq({
        user: { viewerId: "viewer-1" } as AuthRequest["user"],
        params: { channelId: "channel-1" },
        query: { days: "366" },
      });
      const res = makeRes();

      await controller.getChannelDetailAll(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: "days must be between 1 and 365" });
      expect(mockedCacheManager.getOrSetWithTags).not.toHaveBeenCalled();
    });

    it("returns aggregated payload on success and uses cache tags", async () => {
      mockedGetChannelStats.mockResolvedValue({
        dailyStats: [{ date: "2026-01-01", watchHours: 1, messageCount: 2, emoteCount: 3 }],
        timeRange: { startDate: "2026-01-01", endDate: "2026-01-31", days: 30 },
      });
      mockedGetViewerMessageStats.mockResolvedValue({
        channelId: "channel-1",
        summary: { totalMessages: 10 },
      } as Awaited<ReturnType<typeof getViewerMessageStats>>);
      mockedGetChannelGameStatsAndViewerTrends.mockResolvedValue({
        gameStats: [
          {
            gameName: "A",
            totalHours: 1,
            percentage: 100,
            streamCount: 1,
            avgViewers: 10,
            peakViewers: 20,
          },
        ],
        viewerTrends: [],
      });

      const req = makeReq({
        user: { viewerId: "viewer-1" } as AuthRequest["user"],
        params: { channelId: "channel-1" },
        query: { days: "30" },
      });
      const res = makeRes();

      await controller.getChannelDetailAll(req, res);

      expect(mockedGetAdaptiveTTL).toHaveBeenCalledWith(CacheTTL.MEDIUM, cacheManager);
      expect(mockedCacheManager.getOrSetWithTags).toHaveBeenCalledWith(
        "channel-detail-all:viewer-1:channel-1:30d",
        expect.any(Function),
        120,
        ["viewer:viewer-1", "channel:channel-1", CacheTags.VIEWER_BFF]
      );
      expect(mockedGetChannelStats).toHaveBeenCalledWith("viewer-1", "channel-1", 30);
      expect(mockedGetChannelGameStatsAndViewerTrends).toHaveBeenCalledWith("channel-1", "30d");
      expect(res.json).toHaveBeenCalledWith({
        channelStats: expect.any(Object),
        messageStats: expect.any(Object),
        gameStats: expect.any(Array),
        viewerTrends: expect.any(Array),
      });
    });

    it("returns partial payload and logs warnings when some sources fail", async () => {
      mockedGetChannelStats.mockRejectedValue(new Error("stats-fail"));
      mockedGetViewerMessageStats.mockResolvedValue({
        channelId: "channel-1",
        summary: { totalMessages: 10 },
      } as Awaited<ReturnType<typeof getViewerMessageStats>>);
      mockedGetChannelGameStatsAndViewerTrends.mockRejectedValue(new Error("analytics-fail"));

      const req = makeReq({
        user: { viewerId: "viewer-1" } as AuthRequest["user"],
        params: { channelId: "channel-1" },
      });
      const res = makeRes();

      await controller.getChannelDetailAll(req, res);

      expect(res.json).toHaveBeenCalledWith({
        channelStats: null,
        messageStats: expect.any(Object),
        gameStats: null,
        viewerTrends: null,
      });
      expect(mockedLogger.warn).toHaveBeenCalledWith(
        "BFF",
        "channelStats failed:",
        expect.any(Error)
      );
      expect(mockedLogger.warn).toHaveBeenCalledWith(
        "BFF",
        "channel analytics failed:",
        expect.any(Error)
      );
    });

    it("logs warning and returns null messageStats when message stats source fails", async () => {
      mockedGetChannelStats.mockResolvedValue({
        dailyStats: [],
        timeRange: { startDate: "2026-01-01", endDate: "2026-01-31", days: 30 },
      });
      mockedGetViewerMessageStats.mockRejectedValue(new Error("messages-fail"));
      mockedGetChannelGameStatsAndViewerTrends.mockResolvedValue({
        gameStats: [],
        viewerTrends: [],
      });

      const req = makeReq({
        user: { viewerId: "viewer-1" } as AuthRequest["user"],
        params: { channelId: "channel-1" },
      });
      const res = makeRes();

      await controller.getChannelDetailAll(req, res);

      expect(res.json).toHaveBeenCalledWith({
        channelStats: expect.any(Object),
        messageStats: null,
        gameStats: expect.any(Array),
        viewerTrends: expect.any(Array),
      });
      expect(mockedLogger.warn).toHaveBeenCalledWith(
        "BFF",
        "messageStats failed:",
        expect.any(Error)
      );
    });

    it("maps days=7 to rangeKey 7d", async () => {
      mockedGetChannelStats.mockResolvedValue({
        dailyStats: [],
        timeRange: { startDate: "2026-01-01", endDate: "2026-01-07", days: 7 },
      });
      mockedGetViewerMessageStats.mockResolvedValue({
        channelId: "channel-1",
        summary: { totalMessages: 1 },
      } as Awaited<ReturnType<typeof getViewerMessageStats>>);
      mockedGetChannelGameStatsAndViewerTrends.mockResolvedValue({
        gameStats: [],
        viewerTrends: [],
      });

      const req = makeReq({
        user: { viewerId: "viewer-1" } as AuthRequest["user"],
        params: { channelId: "channel-1" },
        query: { days: "7" },
      });
      const res = makeRes();

      await controller.getChannelDetailAll(req, res);

      expect(mockedGetChannelGameStatsAndViewerTrends).toHaveBeenCalledWith("channel-1", "7d");
    });

    it("maps days=90 to rangeKey 90d", async () => {
      mockedGetChannelStats.mockResolvedValue({
        dailyStats: [],
        timeRange: { startDate: "2026-01-01", endDate: "2026-03-31", days: 90 },
      });
      mockedGetViewerMessageStats.mockResolvedValue({
        channelId: "channel-1",
        summary: { totalMessages: 1 },
      } as Awaited<ReturnType<typeof getViewerMessageStats>>);
      mockedGetChannelGameStatsAndViewerTrends.mockResolvedValue({
        gameStats: [],
        viewerTrends: [],
      });

      const req = makeReq({
        user: { viewerId: "viewer-1" } as AuthRequest["user"],
        params: { channelId: "channel-1" },
        query: { days: "90" },
      });
      const res = makeRes();

      await controller.getChannelDetailAll(req, res);

      expect(mockedGetChannelGameStatsAndViewerTrends).toHaveBeenCalledWith("channel-1", "90d");
    });

    it("returns 504 when BFF request times out", async () => {
      jest.useFakeTimers();
      mockedGetChannelStats.mockImplementation(
        async () => await new Promise(() => undefined)
      );
      mockedGetViewerMessageStats.mockImplementation(
        async () => await new Promise(() => undefined)
      );
      mockedGetChannelGameStatsAndViewerTrends.mockImplementation(
        async () => await new Promise(() => undefined)
      );

      const req = makeReq({
        user: { viewerId: "viewer-1" } as AuthRequest["user"],
        params: { channelId: "channel-1" },
      });
      const res = makeRes();

      const pending = controller.getChannelDetailAll(req, res);
      await jest.advanceTimersByTimeAsync(10001);
      await pending;

      expect(mockedLogger.error).toHaveBeenCalledWith(
        "BFF",
        "BFF timeout (10000ms): channel channel-1"
      );
      expect(res.status).toHaveBeenCalledWith(504);
      expect(res.json).toHaveBeenCalledWith({ error: "Gateway Timeout" });
    });

    it("returns 500 when cache layer throws unexpected error", async () => {
      mockedCacheManager.getOrSetWithTags.mockRejectedValue(new Error("cache failed"));

      const req = makeReq({
        user: { viewerId: "viewer-1" } as AuthRequest["user"],
        params: { channelId: "channel-1" },
      });
      const res = makeRes();

      await controller.getChannelDetailAll(req, res);

      expect(mockedLogger.error).toHaveBeenCalledWith(
        "BFF",
        "Error in getChannelDetailAll:",
        expect.any(Error)
      );
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: "Internal Server Error" });
    });

    it("logs warning for slow BFF query", async () => {
      const nowSpy = jest
        .spyOn(Date, "now")
        .mockReturnValueOnce(2000)
        .mockReturnValueOnce(2601);

      mockedGetChannelStats.mockResolvedValue({
        dailyStats: [],
        timeRange: { startDate: "2026-01-01", endDate: "2026-01-31", days: 30 },
      });
      mockedGetViewerMessageStats.mockResolvedValue({
        channelId: "channel-1",
        summary: { totalMessages: 10 },
      } as Awaited<ReturnType<typeof getViewerMessageStats>>);
      mockedGetChannelGameStatsAndViewerTrends.mockResolvedValue({
        gameStats: [],
        viewerTrends: [],
      });

      const req = makeReq({
        user: { viewerId: "viewer-1" } as AuthRequest["user"],
        params: { channelId: "channel-1" },
      });
      const res = makeRes();

      await controller.getChannelDetailAll(req, res);

      expect(mockedLogger.warn).toHaveBeenCalledWith(
        "BFF",
        "Slow BFF query: 601ms for channel channel-1"
      );
      nowSpy.mockRestore();
    });
  });
});
