import {
  getStreamerSummary,
  getStreamerTimeSeries,
  getStreamerHeatmap,
  getStreamerSubscriptionTrend,
  syncSubscriptions,
  getStreamerGameStats,
  getStreamerVideos,
  getStreamerClips,
} from "../streamer";
import { httpClient } from "../httpClient";

// Mock httpClient
jest.mock("../httpClient");
const mockHttpClient = httpClient as jest.MockedFunction<typeof httpClient>;

describe("streamer.ts", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("getStreamerSummary", () => {
    it("should fetch summary with default range", async () => {
      const mockSummary = {
        range: "30d" as const,
        totalStreamHours: 120,
        totalStreamSessions: 30,
        avgStreamDurationMinutes: 240,
        isEstimated: false,
      };

      mockHttpClient.mockResolvedValueOnce(mockSummary);

      const result = await getStreamerSummary();

      expect(mockHttpClient).toHaveBeenCalledWith("/api/streamer/me/summary?range=30d");
      expect(result).toEqual(mockSummary);
    });

    it("should fetch summary with custom range", async () => {
      const mockSummary = {
        range: "7d" as const,
        totalStreamHours: 30,
        totalStreamSessions: 7,
        avgStreamDurationMinutes: 257,
        isEstimated: false,
      };

      mockHttpClient.mockResolvedValueOnce(mockSummary);

      const result = await getStreamerSummary("7d");

      expect(mockHttpClient).toHaveBeenCalledWith("/api/streamer/me/summary?range=7d");
      expect(result).toEqual(mockSummary);
    });

    it("should propagate errors from httpClient", async () => {
      const error = new Error("API error");
      mockHttpClient.mockRejectedValueOnce(error);

      await expect(getStreamerSummary()).rejects.toThrow("API error");
    });
  });

  describe("getStreamerTimeSeries", () => {
    it("should fetch time series with default parameters", async () => {
      const mockResponse = {
        range: "30d",
        granularity: "day" as const,
        data: [
          { date: "2025-01-01", totalHours: 4, sessionCount: 1 },
          { date: "2025-01-02", totalHours: 6, sessionCount: 2 },
        ],
        isEstimated: false,
      };

      mockHttpClient.mockResolvedValueOnce(mockResponse);

      const result = await getStreamerTimeSeries();

      expect(mockHttpClient).toHaveBeenCalledWith(
        "/api/streamer/me/time-series?range=30d&granularity=day"
      );
      expect(result).toEqual(mockResponse);
    });

    it("should fetch time series with custom parameters", async () => {
      const mockResponse = {
        range: "90d",
        granularity: "week" as const,
        data: [{ date: "2025-01-01", totalHours: 28, sessionCount: 7 }],
        isEstimated: true,
      };

      mockHttpClient.mockResolvedValueOnce(mockResponse);

      const result = await getStreamerTimeSeries("90d", "week");

      expect(mockHttpClient).toHaveBeenCalledWith(
        "/api/streamer/me/time-series?range=90d&granularity=week"
      );
      expect(result).toEqual(mockResponse);
    });

    it("should propagate errors from httpClient", async () => {
      const error = new Error("Fetch failed");
      mockHttpClient.mockRejectedValueOnce(error);

      await expect(getStreamerTimeSeries()).rejects.toThrow("Fetch failed");
    });
  });

  describe("getStreamerHeatmap", () => {
    it("should fetch heatmap with default range", async () => {
      const mockResponse = {
        range: "30d",
        data: [
          { dayOfWeek: 0, hour: 14, value: 3.5 },
          { dayOfWeek: 1, hour: 15, value: 4.0 },
        ],
        maxValue: 8.5,
        minValue: 0,
        isEstimated: false,
      };

      mockHttpClient.mockResolvedValueOnce(mockResponse);

      const result = await getStreamerHeatmap();

      expect(mockHttpClient).toHaveBeenCalledWith("/api/streamer/me/heatmap?range=30d");
      expect(result).toEqual(mockResponse);
    });

    it("should fetch heatmap with custom range", async () => {
      const mockResponse = {
        range: "7d",
        data: [{ dayOfWeek: 5, hour: 20, value: 2.5 }],
        maxValue: 6.0,
        minValue: 0,
        isEstimated: false,
      };

      mockHttpClient.mockResolvedValueOnce(mockResponse);

      const result = await getStreamerHeatmap("7d");

      expect(mockHttpClient).toHaveBeenCalledWith("/api/streamer/me/heatmap?range=7d");
      expect(result).toEqual(mockResponse);
    });

    it("should propagate errors from httpClient", async () => {
      const error = new Error("Heatmap error");
      mockHttpClient.mockRejectedValueOnce(error);

      await expect(getStreamerHeatmap()).rejects.toThrow("Heatmap error");
    });
  });

  describe("getStreamerSubscriptionTrend", () => {
    it("should fetch subscription trend with default range", async () => {
      const mockResponse = {
        range: "30d" as const,
        data: [
          { date: "2025-01-01", subsTotal: 100, subsDelta: null },
          { date: "2025-01-02", subsTotal: 102, subsDelta: 2 },
        ],
        hasExactData: false,
        isEstimated: true,
        estimateSource: "daily_snapshot",
        minDataDays: 7,
        currentDataDays: 30,
      };

      mockHttpClient.mockResolvedValueOnce(mockResponse);

      const result = await getStreamerSubscriptionTrend();

      expect(mockHttpClient).toHaveBeenCalledWith(
        "/api/streamer/me/subscription-trend?range=30d"
      );
      expect(result).toEqual(mockResponse);
    });

    it("should fetch subscription trend with custom range", async () => {
      const mockResponse = {
        range: "90d" as const,
        data: [{ date: "2025-01-01", subsTotal: null, subsDelta: null }],
        hasExactData: false,
        isEstimated: true,
        estimateSource: "daily_snapshot",
        minDataDays: 7,
        currentDataDays: 90,
      };

      mockHttpClient.mockResolvedValueOnce(mockResponse);

      const result = await getStreamerSubscriptionTrend("90d");

      expect(mockHttpClient).toHaveBeenCalledWith(
        "/api/streamer/me/subscription-trend?range=90d"
      );
      expect(result).toEqual(mockResponse);
    });

    it("should propagate errors from httpClient", async () => {
      const error = new Error("Subscription trend error");
      mockHttpClient.mockRejectedValueOnce(error);

      await expect(getStreamerSubscriptionTrend()).rejects.toThrow("Subscription trend error");
    });
  });

  describe("syncSubscriptions", () => {
    it("should send post request and return sync message", async () => {
      const mockResponse = { message: "Sync completed" };

      mockHttpClient.mockResolvedValueOnce(mockResponse);

      const result = await syncSubscriptions();

      expect(mockHttpClient).toHaveBeenCalledWith("/api/streamer/me/sync-subscriptions", {
        method: "POST",
      });
      expect(result).toEqual(mockResponse);
    });

    it("should propagate errors from httpClient", async () => {
      const error = new Error("Sync failed");
      mockHttpClient.mockRejectedValueOnce(error);

      await expect(syncSubscriptions()).rejects.toThrow("Sync failed");
    });
  });

  describe("getStreamerGameStats", () => {
    it("should fetch game stats with default range", async () => {
      const mockResponse = [
        {
          gameName: "Game A",
          totalHours: 12,
          avgViewers: 100,
          peakViewers: 200,
          streamCount: 4,
          percentage: 60,
        },
      ];

      mockHttpClient.mockResolvedValueOnce(mockResponse);

      const result = await getStreamerGameStats();

      expect(mockHttpClient).toHaveBeenCalledWith("/api/streamer/me/game-stats?range=30d");
      expect(result).toEqual(mockResponse);
    });

    it("should fetch game stats with custom range", async () => {
      const mockResponse = [
        {
          gameName: "Game B",
          totalHours: 5,
          avgViewers: 50,
          peakViewers: 80,
          streamCount: 2,
          percentage: 100,
        },
      ];

      mockHttpClient.mockResolvedValueOnce(mockResponse);

      const result = await getStreamerGameStats("7d");

      expect(mockHttpClient).toHaveBeenCalledWith("/api/streamer/me/game-stats?range=7d");
      expect(result).toEqual(mockResponse);
    });

    it("should propagate errors from httpClient", async () => {
      const error = new Error("Game stats error");
      mockHttpClient.mockRejectedValueOnce(error);

      await expect(getStreamerGameStats()).rejects.toThrow("Game stats error");
    });
  });

  describe("getStreamerVideos", () => {
    it("should fetch videos with default pagination", async () => {
      const mockResponse = {
        data: [
          {
            twitchVideoId: "v1",
            title: "Video 1",
            url: "https://example.com/video/1",
            thumbnailUrl: null,
            viewCount: 100,
            duration: "2h",
            type: "archive",
            createdAt: "2025-01-01T00:00:00Z",
            publishedAt: "2025-01-01T00:00:00Z",
          },
        ],
        total: 1,
        page: 1,
        totalPages: 1,
      };

      mockHttpClient.mockResolvedValueOnce(mockResponse);

      const result = await getStreamerVideos();

      expect(mockHttpClient).toHaveBeenCalledWith("/api/streamer/me/videos?page=1&limit=20");
      expect(result).toEqual(mockResponse);
    });

    it("should fetch videos with custom pagination", async () => {
      const mockResponse = {
        data: [],
        total: 0,
        page: 3,
        totalPages: 0,
      };

      mockHttpClient.mockResolvedValueOnce(mockResponse);

      const result = await getStreamerVideos(3, 50);

      expect(mockHttpClient).toHaveBeenCalledWith("/api/streamer/me/videos?page=3&limit=50");
      expect(result).toEqual(mockResponse);
    });

    it("should propagate errors from httpClient", async () => {
      const error = new Error("Videos fetch failed");
      mockHttpClient.mockRejectedValueOnce(error);

      await expect(getStreamerVideos()).rejects.toThrow("Videos fetch failed");
    });
  });

  describe("getStreamerClips", () => {
    it("should fetch clips with default pagination", async () => {
      const mockResponse = {
        data: [
          {
            twitchClipId: "c1",
            title: "Clip 1",
            url: "https://example.com/clip/1",
            embedUrl: null,
            thumbnailUrl: null,
            viewCount: 42,
            duration: 30,
            createdAt: "2025-01-01T00:00:00Z",
            gameId: null,
            creatorName: null,
          },
        ],
        total: 1,
        page: 1,
        totalPages: 1,
      };

      mockHttpClient.mockResolvedValueOnce(mockResponse);

      const result = await getStreamerClips();

      expect(mockHttpClient).toHaveBeenCalledWith("/api/streamer/me/clips?page=1&limit=20");
      expect(result).toEqual(mockResponse);
    });

    it("should fetch clips with custom pagination", async () => {
      const mockResponse = {
        data: [],
        total: 0,
        page: 2,
        totalPages: 0,
      };

      mockHttpClient.mockResolvedValueOnce(mockResponse);

      const result = await getStreamerClips(2, 10);

      expect(mockHttpClient).toHaveBeenCalledWith("/api/streamer/me/clips?page=2&limit=10");
      expect(result).toEqual(mockResponse);
    });

    it("should propagate errors from httpClient", async () => {
      const error = new Error("Clips fetch failed");
      mockHttpClient.mockRejectedValueOnce(error);

      await expect(getStreamerClips()).rejects.toThrow("Clips fetch failed");
    });
  });
});
