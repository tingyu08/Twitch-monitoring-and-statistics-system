/**
 * streamer-stats.controller.ts 單元測試
 */

jest.mock("../../../db/prisma", () => ({
  prisma: {
    viewerChannelVideo: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: "v1", twitchVideoId: "tv1", title: "Video 1",
          url: "https://twitch.tv/v/1", thumbnailUrl: null,
          viewCount: 100, duration: 3600, publishedAt: new Date().toISOString(),
        },
      ]),
    },
    viewerChannelClip: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: "c1", twitchClipId: "tc1", creatorName: "creator",
          title: "Clip 1", url: "https://clips.twitch.tv/1",
          thumbnailUrl: null, viewCount: 50, duration: 30, createdAt: new Date().toISOString(),
        },
      ]),
    },
    channel: {
      findUnique: jest.fn().mockResolvedValue({ id: "ch1" }),
    },
    streamSession: {
      findMany: jest.fn().mockResolvedValue([
        {
          startedAt: new Date(), title: "Stream", category: "Gaming",
          avgViewers: 100, peakViewers: 150, durationSeconds: 3600,
        },
      ]),
      findFirst: jest.fn().mockResolvedValue(null),
    },
  },
}));

jest.mock("../streamer.service", () => ({
  getStreamerGameStats: jest.fn().mockResolvedValue([{ game: "Minecraft", hours: 10 }]),
  getChannelGameStats: jest.fn().mockResolvedValue([{ game: "Fortnite", hours: 5 }]),
  getStreamerVideos: jest.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 20, totalPages: 0 }),
  getStreamerClips: jest.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 20, totalPages: 0 }),
}));

jest.mock("../../../utils/logger", () => ({
  streamerLogger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock("../../../utils/cache-manager", () => ({
  cacheManager: {
    getOrSetWithTags: jest.fn().mockImplementation((_key, fn) => fn()),
    getStats: jest.fn().mockReturnValue({}),
  },
  CacheTTL: { MEDIUM: 300, VERY_LONG: 1800 },
  getAdaptiveTTL: jest.fn().mockReturnValue(300),
}));

jest.mock("../../../constants", () => ({
  CacheTags: {
    STREAMER_PUBLIC_GAME_STATS: "streamer:public:game_stats",
    STREAMER_PUBLIC_VIEWER_TRENDS: "streamer:public:viewer_trends",
    STREAMER_PUBLIC_STREAM_HOURLY: "streamer:public:stream_hourly",
  },
}));

jest.mock("../../../utils/request-values", () => ({
  getSingleStringValue: jest.fn((v) => (v !== undefined && v !== null ? String(v) : null)),
  getStringWithDefault: jest.fn((v, def) => (v !== undefined && v !== null ? String(v) : def)),
}));

import type { Request, Response } from "express";
import type { AuthRequest } from "../../auth/auth.middleware";
import {
  getGameStatsHandler,
  getPublicGameStatsHandler,
  getVideosHandler,
  getClipsHandler,
  getPublicVideosHandler,
  getPublicClipsHandler,
  getPublicViewerTrendsHandler,
  getPublicStreamHourlyHandler,
} from "../streamer-stats.controller";
import { prisma } from "../../../db/prisma";
import { cacheManager } from "../../../utils/cache-manager";
import { getStreamerGameStats, getStreamerVideos, getStreamerClips } from "../streamer.service";
import { streamerLogger } from "../../../utils/logger";
import { getSingleStringValue, getStringWithDefault } from "../../../utils/request-values";

function mockRes() {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

function mockAuthReq(overrides: Partial<AuthRequest> = {}): AuthRequest {
  return {
    user: { streamerId: "streamer-1", id: "user-1", twitchId: "tid-1", role: "streamer" },
    params: {},
    query: {},
    body: {},
    ...overrides,
  } as unknown as AuthRequest;
}

describe("streamer-stats.controller", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Restore mock implementations that may have been overridden
    (getStringWithDefault as jest.Mock).mockImplementation((v: unknown, def: string) =>
      v !== undefined && v !== null ? String(v) : def
    );
    (getSingleStringValue as jest.Mock).mockImplementation((v: unknown) =>
      v !== undefined && v !== null ? String(v) : null
    );
    // Restore cacheManager default (calls factory function)
    (cacheManager.getOrSetWithTags as jest.Mock).mockImplementation(
      (_key: string, fn: () => unknown) => fn()
    );
    // Restore prisma session default
    (prisma.streamSession.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.channel.findUnique as jest.Mock).mockResolvedValue({ id: "ch1" });
    (prisma.streamSession.findMany as jest.Mock).mockResolvedValue([
      {
        startedAt: new Date(), title: "Stream", category: "Gaming",
        avgViewers: 100, peakViewers: 150, durationSeconds: 3600,
      },
    ]);
  });

  // ====================================================
  // getGameStatsHandler
  // ====================================================
  describe("getGameStatsHandler", () => {
    it("returns game stats for valid streamer", async () => {
      const req = mockAuthReq({ query: { range: "30d" } });
      (getStringWithDefault as jest.Mock).mockReturnValue("30d");
      const res = mockRes();
      await getGameStatsHandler(req, res);
      expect(res.json).toHaveBeenCalled();
      expect(getStreamerGameStats).toHaveBeenCalledWith("streamer-1", "30d");
    });

    it("returns 401 when no streamerId", async () => {
      const req = mockAuthReq({ user: undefined });
      const res = mockRes();
      await getGameStatsHandler(req, res);
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it("returns 400 for invalid range", async () => {
      const req = mockAuthReq({ query: { range: "99d" } });
      (getStringWithDefault as jest.Mock).mockReturnValue("99d");
      const res = mockRes();
      await getGameStatsHandler(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("returns 500 on error", async () => {
      (getStreamerGameStats as jest.Mock).mockRejectedValue(new Error("fail"));
      const req = mockAuthReq({ query: { range: "7d" } });
      (getStringWithDefault as jest.Mock).mockReturnValue("7d");
      const res = mockRes();
      await getGameStatsHandler(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  // ====================================================
  // getPublicGameStatsHandler
  // ====================================================
  describe("getPublicGameStatsHandler", () => {
    it("returns public game stats", async () => {
      const req = {
        params: { streamerId: "ch1" },
        query: { range: "30d" },
      } as unknown as Request;
      (getSingleStringValue as jest.Mock).mockReturnValue("ch1");
      (getStringWithDefault as jest.Mock).mockReturnValue("30d");
      const res = mockRes();
      await getPublicGameStatsHandler(req, res);
      expect(res.json).toHaveBeenCalled();
    });

    it("returns 400 when channelId missing", async () => {
      const req = { params: { streamerId: undefined }, query: {} } as unknown as Request;
      (getSingleStringValue as jest.Mock).mockReturnValue(null);
      const res = mockRes();
      await getPublicGameStatsHandler(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("returns 400 for invalid range", async () => {
      const req = { params: { streamerId: "ch1" }, query: { range: "invalid" } } as unknown as Request;
      (getSingleStringValue as jest.Mock).mockReturnValue("ch1");
      (getStringWithDefault as jest.Mock).mockReturnValue("invalid");
      const res = mockRes();
      await getPublicGameStatsHandler(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("returns 500 on error", async () => {
      const req = { params: { streamerId: "ch1" }, query: { range: "7d" } } as unknown as Request;
      (getSingleStringValue as jest.Mock).mockReturnValue("ch1");
      (getStringWithDefault as jest.Mock).mockReturnValue("7d");
      (cacheManager.getOrSetWithTags as jest.Mock).mockRejectedValue(new Error("fail"));
      const res = mockRes();
      await getPublicGameStatsHandler(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  // ====================================================
  // getVideosHandler
  // ====================================================
  describe("getVideosHandler", () => {
    it("returns videos for valid streamer", async () => {
      const req = mockAuthReq({ query: { page: "1", limit: "20" } });
      (getStringWithDefault as jest.Mock).mockReturnValueOnce("1").mockReturnValueOnce("20");
      const res = mockRes();
      await getVideosHandler(req, res);
      expect(res.json).toHaveBeenCalled();
      expect(getStreamerVideos).toHaveBeenCalledWith("streamer-1", 20, 1);
    });

    it("caps limit at 100", async () => {
      const req = mockAuthReq({ query: { page: "1", limit: "200" } });
      (getStringWithDefault as jest.Mock).mockReturnValueOnce("1").mockReturnValueOnce("200");
      const res = mockRes();
      await getVideosHandler(req, res);
      expect(getStreamerVideos).toHaveBeenCalledWith("streamer-1", 100, 1);
    });

    it("returns 401 when no streamerId", async () => {
      const req = mockAuthReq({ user: undefined });
      const res = mockRes();
      await getVideosHandler(req, res);
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it("returns 500 on error", async () => {
      (getStreamerVideos as jest.Mock).mockRejectedValue(new Error("fail"));
      const req = mockAuthReq({ query: { page: "1", limit: "20" } });
      (getStringWithDefault as jest.Mock).mockReturnValueOnce("1").mockReturnValueOnce("20");
      const res = mockRes();
      await getVideosHandler(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
    });

    it("falls back to page 1 and limit 20 when query is not numeric", async () => {
      const req = mockAuthReq({ query: { page: "abc", limit: "def" } });
      (getStringWithDefault as jest.Mock).mockReturnValueOnce("abc").mockReturnValueOnce("def");
      const res = mockRes();
      await getVideosHandler(req, res);
      expect(getStreamerVideos).toHaveBeenCalledWith("streamer-1", 20, 1);
    });
  });

  // ====================================================
  // getClipsHandler
  // ====================================================
  describe("getClipsHandler", () => {
    it("returns clips for valid streamer", async () => {
      const req = mockAuthReq({ query: { page: "1", limit: "10" } });
      (getStringWithDefault as jest.Mock).mockReturnValueOnce("1").mockReturnValueOnce("10");
      const res = mockRes();
      await getClipsHandler(req, res);
      expect(res.json).toHaveBeenCalled();
      expect(getStreamerClips).toHaveBeenCalledWith("streamer-1", 10, 1);
    });

    it("returns 401 when no streamerId", async () => {
      const req = mockAuthReq({ user: undefined });
      const res = mockRes();
      await getClipsHandler(req, res);
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it("returns 500 on error", async () => {
      (getStreamerClips as jest.Mock).mockRejectedValue(new Error("fail"));
      const req = mockAuthReq({ query: { page: "1", limit: "10" } });
      (getStringWithDefault as jest.Mock).mockReturnValueOnce("1").mockReturnValueOnce("10");
      const res = mockRes();
      await getClipsHandler(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
    });

    it("falls back to page 1 and limit 20 when query is not numeric", async () => {
      const req = mockAuthReq({ query: { page: "abc", limit: "def" } });
      (getStringWithDefault as jest.Mock).mockReturnValueOnce("abc").mockReturnValueOnce("def");
      const res = mockRes();
      await getClipsHandler(req, res);
      expect(getStreamerClips).toHaveBeenCalledWith("streamer-1", 20, 1);
    });
  });

  // ====================================================
  // getPublicVideosHandler
  // ====================================================
  describe("getPublicVideosHandler", () => {
    it("returns public videos", async () => {
      const req = { params: { streamerId: "ch1" } } as unknown as Request;
      (getSingleStringValue as jest.Mock).mockReturnValue("ch1");
      const res = mockRes();
      await getPublicVideosHandler(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ total: 1 }));
    });

    it("returns 400 when channelId missing", async () => {
      const req = { params: {} } as unknown as Request;
      (getSingleStringValue as jest.Mock).mockReturnValue(null);
      const res = mockRes();
      await getPublicVideosHandler(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("returns 500 on error", async () => {
      (prisma.viewerChannelVideo.findMany as jest.Mock).mockRejectedValue(new Error("fail"));
      const req = { params: { streamerId: "ch1" } } as unknown as Request;
      (getSingleStringValue as jest.Mock).mockReturnValue("ch1");
      const res = mockRes();
      await getPublicVideosHandler(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  // ====================================================
  // getPublicClipsHandler
  // ====================================================
  describe("getPublicClipsHandler", () => {
    it("returns public clips", async () => {
      const req = { params: { streamerId: "ch1" } } as unknown as Request;
      (getSingleStringValue as jest.Mock).mockReturnValue("ch1");
      const res = mockRes();
      await getPublicClipsHandler(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ total: 1 }));
    });

    it("returns 400 when channelId missing", async () => {
      const req = { params: {} } as unknown as Request;
      (getSingleStringValue as jest.Mock).mockReturnValue(null);
      const res = mockRes();
      await getPublicClipsHandler(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("returns 500 on error", async () => {
      (prisma.viewerChannelClip.findMany as jest.Mock).mockRejectedValue(new Error("fail"));
      const req = { params: { streamerId: "ch1" } } as unknown as Request;
      (getSingleStringValue as jest.Mock).mockReturnValue("ch1");
      const res = mockRes();
      await getPublicClipsHandler(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  // ====================================================
  // getPublicViewerTrendsHandler
  // ====================================================
  describe("getPublicViewerTrendsHandler", () => {
    it("returns viewer trends", async () => {
      const req = { params: { streamerId: "ch1" }, query: { range: "30d" } } as unknown as Request;
      (getSingleStringValue as jest.Mock).mockReturnValue("ch1");
      (getStringWithDefault as jest.Mock).mockReturnValue("30d");
      const res = mockRes();
      await getPublicViewerTrendsHandler(req, res);
      expect(res.json).toHaveBeenCalled();
    });

    it("returns viewer trends for 7d range", async () => {
      const req = { params: { streamerId: "ch1" }, query: { range: "7d" } } as unknown as Request;
      (getSingleStringValue as jest.Mock).mockReturnValue("ch1");
      (getStringWithDefault as jest.Mock).mockReturnValue("7d");
      const res = mockRes();
      await getPublicViewerTrendsHandler(req, res);
      expect(res.json).toHaveBeenCalled();
    });

    it("returns viewer trends for 90d range", async () => {
      const req = { params: { streamerId: "ch1" }, query: { range: "90d" } } as unknown as Request;
      (getSingleStringValue as jest.Mock).mockReturnValue("ch1");
      (getStringWithDefault as jest.Mock).mockReturnValue("90d");
      const res = mockRes();
      await getPublicViewerTrendsHandler(req, res);
      expect(res.json).toHaveBeenCalled();
    });

    it("returns 400 when channelId missing", async () => {
      const req = { params: {}, query: {} } as unknown as Request;
      (getSingleStringValue as jest.Mock).mockReturnValue(null);
      const res = mockRes();
      await getPublicViewerTrendsHandler(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("throws Channel not found when channel does not exist", async () => {
      (prisma.channel.findUnique as jest.Mock).mockResolvedValue(null);
      const req = { params: { streamerId: "notexist" }, query: { range: "30d" } } as unknown as Request;
      (getSingleStringValue as jest.Mock).mockReturnValue("notexist");
      (getStringWithDefault as jest.Mock).mockReturnValue("30d");
      const res = mockRes();
      await getPublicViewerTrendsHandler(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(streamerLogger.error).toHaveBeenCalled();
    });

    it("returns 500 on unexpected error", async () => {
      (prisma.channel.findUnique as jest.Mock).mockRejectedValue(new Error("fail"));
      const req = { params: { streamerId: "ch1" }, query: { range: "30d" } } as unknown as Request;
      (getSingleStringValue as jest.Mock).mockReturnValue("ch1");
      (getStringWithDefault as jest.Mock).mockReturnValue("30d");
      const res = mockRes();
      await getPublicViewerTrendsHandler(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
    });

    it("uses fallback values for null title/category/viewer fields", async () => {
      (prisma.streamSession.findMany as jest.Mock).mockResolvedValue([
        {
          startedAt: new Date("2026-01-02T10:00:00Z"),
          title: null,
          category: null,
          avgViewers: null,
          peakViewers: null,
          durationSeconds: null,
        },
      ]);
      const req = { params: { streamerId: "ch1" }, query: { range: "30d" } } as unknown as Request;
      (getSingleStringValue as jest.Mock).mockReturnValue("ch1");
      (getStringWithDefault as jest.Mock).mockReturnValue("30d");
      const res = mockRes();
      await getPublicViewerTrendsHandler(req, res);
      const data = (res.json as jest.Mock).mock.calls[0][0] as Array<{
        title: string;
        category: string;
        avgViewers: number;
        peakViewers: number;
        durationHours: number;
      }>;
      expect(data[0]).toMatchObject({
        title: "Untitled",
        category: "Just Chatting",
        avgViewers: 0,
        peakViewers: 0,
        durationHours: 0,
      });
    });
  });

  // ====================================================
  // getPublicStreamHourlyHandler
  // ====================================================
  describe("getPublicStreamHourlyHandler", () => {
    it("returns 400 when channelId or date missing", async () => {
      const req = { params: {}, query: {} } as unknown as Request;
      (getSingleStringValue as jest.Mock).mockReturnValue(null);
      const res = mockRes();
      await getPublicStreamHourlyHandler(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("returns empty array when no session found", async () => {
      (prisma.streamSession.findFirst as jest.Mock).mockResolvedValue(null);
      const req = {
        params: { streamerId: "ch1" },
        query: { date: "2026-01-01" },
      } as unknown as Request;
      (getSingleStringValue as jest.Mock)
        .mockReturnValueOnce("ch1")
        .mockReturnValueOnce("2026-01-01");
      const res = mockRes();
      await getPublicStreamHourlyHandler(req, res);
      expect(res.json).toHaveBeenCalledWith([]);
    });

    it("returns real metrics when session has metrics", async () => {
      (prisma.streamSession.findFirst as jest.Mock).mockResolvedValue({
        id: "s1",
        startedAt: new Date("2026-01-01T10:00:00Z"),
        durationSeconds: 3600,
        avgViewers: 100,
        peakViewers: 150,
        metrics: [
          { timestamp: new Date("2026-01-01T10:00:00Z"), viewerCount: 100 },
          { timestamp: new Date("2026-01-01T10:30:00Z"), viewerCount: 120 },
        ],
      });
      const req = {
        params: { streamerId: "ch1" },
        query: { date: "2026-01-01" },
      } as unknown as Request;
      (getSingleStringValue as jest.Mock)
        .mockReturnValueOnce("ch1")
        .mockReturnValueOnce("2026-01-01");
      const res = mockRes();
      await getPublicStreamHourlyHandler(req, res);
      expect(res.json).toHaveBeenCalled();
      const data = (res.json as jest.Mock).mock.calls[0][0] as Array<{ viewers: number }>;
      expect(data.length).toBe(2);
    });

    it("uses fallback simulation when no metrics but has duration/avg", async () => {
      (prisma.streamSession.findFirst as jest.Mock).mockResolvedValue({
        id: "s1",
        startedAt: new Date("2026-01-01T10:00:00Z"),
        durationSeconds: 7200,
        avgViewers: 100,
        peakViewers: 150,
        metrics: [],
      });
      const req = {
        params: { streamerId: "ch1" },
        query: { date: "2026-01-01" },
      } as unknown as Request;
      (getSingleStringValue as jest.Mock)
        .mockReturnValueOnce("ch1")
        .mockReturnValueOnce("2026-01-01");
      const res = mockRes();
      await getPublicStreamHourlyHandler(req, res);
      expect(res.json).toHaveBeenCalled();
      const data = (res.json as jest.Mock).mock.calls[0][0] as Array<{ viewers: number }>;
      expect(data.length).toBeGreaterThan(0);
    });

    it("uses avg * 1.2 as peak fallback when peakViewers is null", async () => {
      (prisma.streamSession.findFirst as jest.Mock).mockResolvedValue({
        id: "s1",
        startedAt: new Date("2026-01-01T10:00:00Z"),
        durationSeconds: 3600,
        avgViewers: 100,
        peakViewers: null,
        metrics: [],
      });
      const req = {
        params: { streamerId: "ch1" },
        query: { date: "2026-01-01" },
      } as unknown as Request;
      (getSingleStringValue as jest.Mock)
        .mockReturnValueOnce("ch1")
        .mockReturnValueOnce("2026-01-01");
      const res = mockRes();
      await getPublicStreamHourlyHandler(req, res);
      const data = (res.json as jest.Mock).mock.calls[0][0] as Array<{ viewers: number }>;
      expect(data.length).toBe(1);
      expect(data[0].viewers).toBeGreaterThan(0);
    });

    it("returns empty array when session has no durationSeconds", async () => {
      (prisma.streamSession.findFirst as jest.Mock).mockResolvedValue({
        id: "s1",
        startedAt: new Date("2026-01-01T10:00:00Z"),
        durationSeconds: null,
        avgViewers: null,
        peakViewers: null,
        metrics: [],
      });
      const req = {
        params: { streamerId: "ch1" },
        query: { date: "2026-01-01" },
      } as unknown as Request;
      (getSingleStringValue as jest.Mock)
        .mockReturnValueOnce("ch1")
        .mockReturnValueOnce("2026-01-01");
      const res = mockRes();
      await getPublicStreamHourlyHandler(req, res);
      expect(res.json).toHaveBeenCalledWith([]);
    });

    it("returns 500 on error", async () => {
      (prisma.streamSession.findFirst as jest.Mock).mockRejectedValue(new Error("fail"));
      const req = {
        params: { streamerId: "ch1" },
        query: { date: "2026-01-01" },
      } as unknown as Request;
      (getSingleStringValue as jest.Mock)
        .mockReturnValueOnce("ch1")
        .mockReturnValueOnce("2026-01-01");
      const res = mockRes();
      await getPublicStreamHourlyHandler(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });
});
