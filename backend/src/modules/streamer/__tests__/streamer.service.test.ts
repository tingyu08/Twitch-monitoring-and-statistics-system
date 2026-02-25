import {
  getStreamerSummary,
  getStreamerTimeSeries,
  getStreamerHeatmap,
  getStreamerGameStats,
  getChannelGameStats,
  getChannelViewerTrends,
  getChannelGameStatsAndViewerTrends,
  getStreamerVideos,
  getStreamerClips,
} from "../streamer.service";
import { prisma } from "../../../db/prisma";
import { cacheManager } from "../../../utils/cache-manager";

// Mock @prisma/client so Prisma.sql tagged template literal works without a real DB
jest.mock("@prisma/client", () => {
  const sqlTag = (strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
    __prismaRawQuery: true,
  });
  sqlTag.join = (parts: unknown[], _sep: unknown) => parts;
  return {
    Prisma: {
      sql: sqlTag,
      join: sqlTag.join,
      empty: { __prismaRawQuery: true, strings: [], values: [] },
      raw: (s: string) => s,
    },
    PrismaClient: jest.fn().mockImplementation(() => ({})),
  };
});

jest.mock("../../../db/prisma", () => ({
  prisma: {
    channel: {
      findFirst: jest.fn(),
    },
    streamSession: {
      findMany: jest.fn(),
    },
    video: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
    clip: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
  },
}));

describe("StreamerService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cacheManager.clear(); // Prevent test-to-test cache pollution
  });

  // ============================================================
  // getStreamerSummary
  // ============================================================
  describe("getStreamerSummary", () => {
    it("should return empty zeros when channel not found", async () => {
      (prisma.channel.findFirst as jest.Mock).mockResolvedValue(null);
      const res = await getStreamerSummary("s1", "7d");
      expect(res).toEqual(
        expect.objectContaining({ totalStreamSessions: 0, range: "7d", totalStreamHours: 0 })
      );
    });

    it("should calculate stats correctly for 30d range", async () => {
      (prisma.channel.findFirst as jest.Mock).mockResolvedValue({ id: "c1" });
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([
        { totalSeconds: 10800, sessionCount: 2 },
      ]);

      const res = await getStreamerSummary("s1", "30d");
      expect(res.totalStreamSessions).toBe(2);
      expect(res.totalStreamHours).toBeCloseTo(3);
      expect(res.avgStreamDurationMinutes).toBe(90);
    });

    it("should handle 90d range", async () => {
      (prisma.channel.findFirst as jest.Mock).mockResolvedValue({ id: "c1" });
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([
        { totalSeconds: 0, sessionCount: 0 },
      ]);
      const res = await getStreamerSummary("s1", "90d");
      expect(res.range).toBe("90d");
    });

    it("should handle 7d range with correct cutoff", async () => {
      (prisma.channel.findFirst as jest.Mock).mockResolvedValue({ id: "c1" });
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([
        { totalSeconds: 3600, sessionCount: 1 },
      ]);
      const res = await getStreamerSummary("s1", "7d");
      expect(res.range).toBe("7d");
      expect(res.totalStreamHours).toBeCloseTo(1);
    });

    it("should default to 30d when range is not provided", async () => {
      (prisma.channel.findFirst as jest.Mock).mockResolvedValue({ id: "c1" });
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([
        { totalSeconds: 0, sessionCount: 0 },
      ]);
      const res = await getStreamerSummary("s1");
      expect(res.range).toBe("30d");
    });

    it("should return avgStreamDurationMinutes as 0 when sessions is 0", async () => {
      (prisma.channel.findFirst as jest.Mock).mockResolvedValue({ id: "c1" });
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([
        { totalSeconds: 0, sessionCount: 0 },
      ]);
      const res = await getStreamerSummary("s1", "30d");
      expect(res.avgStreamDurationMinutes).toBe(0);
    });

    it("should handle bigint values from raw query", async () => {
      (prisma.channel.findFirst as jest.Mock).mockResolvedValue({ id: "c1" });
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([
        { totalSeconds: BigInt(7200), sessionCount: BigInt(2) },
      ]);
      const res = await getStreamerSummary("s1", "30d");
      expect(res.totalStreamHours).toBeCloseTo(2);
    });

    it("should return from cache on second call (cache hit)", async () => {
      (prisma.channel.findFirst as jest.Mock).mockResolvedValue({ id: "c1" });
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([
        { totalSeconds: 3600, sessionCount: 1 },
      ]);

      await getStreamerSummary("s_cache1", "30d");
      await getStreamerSummary("s_cache1", "30d");

      // DB should only be queried once (second call served from cache)
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it("should treat unknown range as 30d", async () => {
      (prisma.channel.findFirst as jest.Mock).mockResolvedValue({ id: "c1" });
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([
        { totalSeconds: 0, sessionCount: 0 },
      ]);
      const res = await getStreamerSummary("s1", "all");
      expect(res.range).toBe("all");
    });
  });

  // ============================================================
  // getStreamerTimeSeries
  // ============================================================
  describe("getStreamerTimeSeries", () => {
    it("should return empty data array when no channel found", async () => {
      (prisma.channel.findFirst as jest.Mock).mockResolvedValue(null);
      const res = await getStreamerTimeSeries("s1", "30d");
      expect(res.data).toHaveLength(0);
      expect(res.granularity).toBe("day");
    });

    it("should aggregate data by day for 7d range", async () => {
      (prisma.channel.findFirst as jest.Mock).mockResolvedValue({ id: "c1" });
      const today = new Date();
      const dateKey = today.toISOString().split("T")[0];
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([
        { bucketDate: dateKey, totalSeconds: 3600, sessionCount: 1 },
      ]);

      const res = await getStreamerTimeSeries("s1", "7d", "day");
      expect(res.data.length).toBeGreaterThan(0);
      expect(res.granularity).toBe("day");
    });

    it("should aggregate data by week for 90d range", async () => {
      (prisma.channel.findFirst as jest.Mock).mockResolvedValue({ id: "c1" });
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([]);

      const res = await getStreamerTimeSeries("s1", "90d", "week");
      expect(res.granularity).toBe("week");
    });

    it("should default to day granularity when not specified", async () => {
      (prisma.channel.findFirst as jest.Mock).mockResolvedValue({ id: "c1" });
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([]);

      const res = await getStreamerTimeSeries("s1", "30d");
      expect(res.granularity).toBe("day");
    });

    it("should handle unknown range gracefully (treated as 30d)", async () => {
      (prisma.channel.findFirst as jest.Mock).mockResolvedValue({ id: "c1" });
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([]);
      const res = await getStreamerTimeSeries("s1", "all");
      expect(res.range).toBe("all");
    });

    it("should fill in zero data points for dates with no sessions", async () => {
      (prisma.channel.findFirst as jest.Mock).mockResolvedValue({ id: "c1" });
      // No matching rows for any date
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([]);

      const res = await getStreamerTimeSeries("s1", "7d", "day");
      // 7-day range should have ~7 data points
      expect(res.data.length).toBeGreaterThanOrEqual(7);
      res.data.forEach((point) => {
        expect(point.totalHours).toBe(0);
        expect(point.sessionCount).toBe(0);
      });
    });

    it("should correctly compute totalHours from totalSeconds", async () => {
      (prisma.channel.findFirst as jest.Mock).mockResolvedValue({ id: "c1" });
      // Use a date from 2 days ago to ensure it falls within the 7d range
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      const dateKey = twoDaysAgo.toISOString().split("T")[0];
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([
        { bucketDate: dateKey, totalSeconds: 7200, sessionCount: 2 },
      ]);

      const res = await getStreamerTimeSeries("s1_hours", "7d", "day");
      const matchingPoint = res.data.find((d) => d.date === dateKey);
      // The matching point should have totalHours = 2 (7200/3600)
      expect(matchingPoint).toBeDefined();
      if (matchingPoint) {
        expect(matchingPoint.totalHours).toBeCloseTo(2);
      }
    });

    it("should return weekly time series with correct structure", async () => {
      (prisma.channel.findFirst as jest.Mock).mockResolvedValue({ id: "c1" });
      const now = new Date();
      const weekKey = now.toISOString().split("T")[0];
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([
        { bucketDate: weekKey, totalSeconds: 3600, sessionCount: 1 },
      ]);

      const res = await getStreamerTimeSeries("s1", "90d", "week");
      expect(res.granularity).toBe("week");
      expect(res.data.length).toBeGreaterThan(0);
      res.data.forEach((point) => {
        expect(point).toHaveProperty("date");
        expect(point).toHaveProperty("totalHours");
        expect(point).toHaveProperty("sessionCount");
      });
    });

    it("should serve from cache on second call", async () => {
      (prisma.channel.findFirst as jest.Mock).mockResolvedValue({ id: "c1" });
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([]);

      await getStreamerTimeSeries("s_ts_cache", "7d", "day");
      await getStreamerTimeSeries("s_ts_cache", "7d", "day");

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    });
  });

  // ============================================================
  // getStreamerHeatmap
  // ============================================================
  describe("getStreamerHeatmap", () => {
    beforeEach(() => {
      // loadHeatmapAggregate uses $queryRaw: return empty array to force recalculation
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([]);
      (prisma.$executeRaw as jest.Mock).mockResolvedValue(0);
    });

    it("should return empty data when channel not found", async () => {
      (prisma.channel.findFirst as jest.Mock).mockResolvedValue(null);
      const res = await getStreamerHeatmap("s1", "30d");
      expect(res.data).toHaveLength(0);
      expect(res.maxValue).toBe(0);
      expect(res.minValue).toBe(0);
    });

    it("should generate 7*24 heatmap matrix with zero data", async () => {
      (prisma.channel.findFirst as jest.Mock).mockResolvedValue({ id: "c1" });
      (prisma.streamSession.findMany as jest.Mock).mockResolvedValue([]);

      const res = await getStreamerHeatmap("s1", "30d");
      expect(res.data).toHaveLength(7 * 24);
      expect(res.minValue).toBe(0);
      expect(res.maxValue).toBe(0);
    });

    it("should build heatmap matrix with session data (fallback path)", async () => {
      (prisma.channel.findFirst as jest.Mock).mockResolvedValue({ id: "c1" });
      const sundayMorning = new Date("2025-12-14T10:00:00Z");

      // First $queryRaw: loadHeatmapAggregate -> []
      // Second $queryRaw: buildHeatmapFromSessionsSql -> throws, triggers fallback
      (prisma.$queryRaw as jest.Mock)
        .mockResolvedValueOnce([])
        .mockRejectedValueOnce(new Error("SQL failed"));

      (prisma.streamSession.findMany as jest.Mock).mockResolvedValue([
        { durationSeconds: 3600, startedAt: sundayMorning },
      ]);

      const res = await getStreamerHeatmap("s1", "30d");
      expect(res.data).toHaveLength(7 * 24);
      expect(res.maxValue).toBeGreaterThan(0);
    });

    it("should use 7d range correctly", async () => {
      (prisma.channel.findFirst as jest.Mock).mockResolvedValue({ id: "c1" });
      (prisma.streamSession.findMany as jest.Mock).mockResolvedValue([]);

      const res = await getStreamerHeatmap("s1", "7d");
      expect(res.range).toBe("7d");
    });

    it("should use 90d range correctly", async () => {
      (prisma.channel.findFirst as jest.Mock).mockResolvedValue({ id: "c1" });
      (prisma.streamSession.findMany as jest.Mock).mockResolvedValue([]);

      const res = await getStreamerHeatmap("s1", "90d");
      expect(res.range).toBe("90d");
    });

    it("should default to 30d range when not provided", async () => {
      (prisma.channel.findFirst as jest.Mock).mockResolvedValue({ id: "c1" });
      (prisma.streamSession.findMany as jest.Mock).mockResolvedValue([]);

      const res = await getStreamerHeatmap("s1");
      expect(res.range).toBe("30d");
    });

    it("should return aggregate cache when it has complete 168 rows within TTL", async () => {
      (prisma.channel.findFirst as jest.Mock).mockResolvedValue({ id: "c1" });

      const now = Date.now();
      const recentDate = new Date(now - 5 * 60 * 1000); // 5 minutes ago (within 10min TTL)

      // Build 168 rows (7 days * 24 hours)
      const aggregateRows = [];
      for (let day = 0; day < 7; day++) {
        for (let hour = 0; hour < 24; hour++) {
          aggregateRows.push({
            dayOfWeek: day,
            hour,
            totalHours: 1.5,
            updatedAt: recentDate,
          });
        }
      }

      (prisma.$queryRaw as jest.Mock).mockResolvedValueOnce(aggregateRows);

      const res = await getStreamerHeatmap("s1_agg", "30d");
      // loadHeatmapAggregate returned valid data -> should be used directly
      expect(res.data).toHaveLength(7 * 24);
      // session findMany should NOT have been called since we hit the aggregate
      expect(prisma.streamSession.findMany).not.toHaveBeenCalled();
    });

    it("should fallback to SQL query when aggregate is stale (old updatedAt)", async () => {
      (prisma.channel.findFirst as jest.Mock).mockResolvedValue({ id: "c1" });

      const staleDate = new Date(Date.now() - 20 * 60 * 1000); // 20 minutes ago (stale)

      const staleRows = [];
      for (let day = 0; day < 7; day++) {
        for (let hour = 0; hour < 24; hour++) {
          staleRows.push({
            dayOfWeek: day,
            hour,
            totalHours: 1.0,
            updatedAt: staleDate,
          });
        }
      }

      // First call: loadHeatmapAggregate returns stale rows -> null
      // Second call: buildHeatmapFromSessionsSql returns data
      (prisma.$queryRaw as jest.Mock)
        .mockResolvedValueOnce(staleRows)
        .mockResolvedValueOnce([]); // SQL heatmap returns empty

      const res = await getStreamerHeatmap("s1_stale", "30d");
      expect(res.data).toHaveLength(7 * 24);
    });
  });

  // ============================================================
  // getStreamerGameStats
  // ============================================================
  describe("getStreamerGameStats", () => {
    beforeEach(() => {
      cacheManager.clear();
    });

    it("should return empty array when channel not found", async () => {
      (prisma.channel.findFirst as jest.Mock).mockResolvedValue(null);
      const res = await getStreamerGameStats("s1", "30d");
      expect(res).toEqual([]);
    });

    it("should return game stats with correct calculations for 30d", async () => {
      (prisma.channel.findFirst as jest.Mock).mockResolvedValue({ id: "c1" });
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([
        {
          gameName: "Minecraft",
          totalSeconds: 7200,
          weightedViewersSum: 14400,
          peakViewers: 500,
          streamCount: 2,
        },
      ]);

      const res = await getStreamerGameStats("s1", "30d");
      expect(res).toHaveLength(1);
      expect(res[0].gameName).toBe("Minecraft");
      expect(res[0].totalHours).toBeCloseTo(2);
      expect(res[0].avgViewers).toBe(2); // 14400/7200
      expect(res[0].peakViewers).toBe(500);
      expect(res[0].streamCount).toBe(2);
      expect(res[0].percentage).toBe(100);
    });

    it("should handle 7d range", async () => {
      (prisma.channel.findFirst as jest.Mock).mockResolvedValue({ id: "c1" });
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([]);

      const res = await getStreamerGameStats("s1", "7d");
      expect(res).toEqual([]);
    });

    it("should handle 90d range", async () => {
      (prisma.channel.findFirst as jest.Mock).mockResolvedValue({ id: "c1" });
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([]);

      const res = await getStreamerGameStats("s1", "90d");
      expect(res).toEqual([]);
    });

    it("should return multiple games sorted by totalHours descending", async () => {
      (prisma.channel.findFirst as jest.Mock).mockResolvedValue({ id: "c1" });
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([
        {
          gameName: "GameA",
          totalSeconds: 3600,
          weightedViewersSum: 1800,
          peakViewers: 100,
          streamCount: 1,
        },
        {
          gameName: "GameB",
          totalSeconds: 7200,
          weightedViewersSum: 3600,
          peakViewers: 200,
          streamCount: 2,
        },
      ]);

      const res = await getStreamerGameStats("s1_multi", "30d");
      expect(res[0].gameName).toBe("GameB"); // higher hours first
      expect(res[1].gameName).toBe("GameA");
    });

    it("should calculate percentage correctly across multiple games", async () => {
      (prisma.channel.findFirst as jest.Mock).mockResolvedValue({ id: "c1" });
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([
        {
          gameName: "GameA",
          totalSeconds: 3600,
          weightedViewersSum: 0,
          peakViewers: 0,
          streamCount: 1,
        },
        {
          gameName: "GameB",
          totalSeconds: 3600,
          weightedViewersSum: 0,
          peakViewers: 0,
          streamCount: 1,
        },
      ]);

      const res = await getStreamerGameStats("s1_pct", "30d");
      expect(res[0].percentage).toBeCloseTo(50);
      expect(res[1].percentage).toBeCloseTo(50);
    });

    it("should serve from cache on second call", async () => {
      (prisma.channel.findFirst as jest.Mock).mockResolvedValue({ id: "c1" });
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([]);

      await getStreamerGameStats("s_game_cache", "30d");
      await getStreamerGameStats("s_game_cache", "30d");

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it("should handle avgViewers as 0 when totalSeconds is 0", async () => {
      (prisma.channel.findFirst as jest.Mock).mockResolvedValue({ id: "c1" });
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([
        {
          gameName: "NoStream",
          totalSeconds: 0,
          weightedViewersSum: 0,
          peakViewers: 0,
          streamCount: 1,
        },
      ]);

      const res = await getStreamerGameStats("s1_zero", "30d");
      expect(res[0].avgViewers).toBe(0);
    });
  });

  // ============================================================
  // getChannelGameStats
  // ============================================================
  describe("getChannelGameStats", () => {
    beforeEach(() => {
      cacheManager.clear();
    });

    it("should return empty array when no data", async () => {
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([]);
      const res = await getChannelGameStats("ch1", "30d");
      expect(res).toEqual([]);
    });

    it("should return game stats for a channel", async () => {
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([
        {
          gameName: "Fortnite",
          totalSeconds: 3600,
          weightedViewersSum: 1800,
          peakViewers: 300,
          streamCount: 1,
        },
      ]);

      const res = await getChannelGameStats("ch1_game", "7d");
      expect(res).toHaveLength(1);
      expect(res[0].gameName).toBe("Fortnite");
    });

    it("should handle 7d range", async () => {
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([]);
      const res = await getChannelGameStats("ch1", "7d");
      expect(res).toEqual([]);
    });

    it("should handle 90d range", async () => {
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([]);
      const res = await getChannelGameStats("ch1", "90d");
      expect(res).toEqual([]);
    });
  });

  // ============================================================
  // getChannelViewerTrends
  // ============================================================
  describe("getChannelViewerTrends", () => {
    beforeEach(() => {
      cacheManager.clear();
    });

    it("should return empty array when no sessions", async () => {
      (prisma.streamSession.findMany as jest.Mock).mockResolvedValue([]);
      const res = await getChannelViewerTrends("ch1", "30d");
      expect(res).toEqual([]);
    });

    it("should return viewer trend points with correct shape", async () => {
      const sessionDate = new Date("2025-01-15T20:00:00Z");
      (prisma.streamSession.findMany as jest.Mock).mockResolvedValue([
        {
          startedAt: sessionDate,
          title: "My Stream",
          avgViewers: 150,
          peakViewers: 300,
          durationSeconds: 7200,
          category: "Valorant",
        },
      ]);

      const res = await getChannelViewerTrends("ch1_trends", "30d");
      expect(res).toHaveLength(1);
      expect(res[0].title).toBe("My Stream");
      expect(res[0].avgViewers).toBe(150);
      expect(res[0].peakViewers).toBe(300);
      expect(res[0].durationHours).toBeCloseTo(2);
      expect(res[0].category).toBe("Valorant");
    });

    it("should handle null title and category with defaults", async () => {
      const sessionDate = new Date("2025-01-15T20:00:00Z");
      (prisma.streamSession.findMany as jest.Mock).mockResolvedValue([
        {
          startedAt: sessionDate,
          title: null,
          avgViewers: null,
          peakViewers: null,
          durationSeconds: null,
          category: null,
        },
      ]);

      const res = await getChannelViewerTrends("ch1_null", "7d");
      expect(res[0].title).toBe("Untitled");
      expect(res[0].avgViewers).toBe(0);
      expect(res[0].peakViewers).toBe(0);
      expect(res[0].durationHours).toBe(0);
      expect(res[0].category).toBe("Uncategorized");
    });

    it("should handle 7d range", async () => {
      (prisma.streamSession.findMany as jest.Mock).mockResolvedValue([]);
      const res = await getChannelViewerTrends("ch1", "7d");
      expect(res).toEqual([]);
    });

    it("should handle 90d range", async () => {
      (prisma.streamSession.findMany as jest.Mock).mockResolvedValue([]);
      const res = await getChannelViewerTrends("ch1", "90d");
      expect(res).toEqual([]);
    });
  });

  // ============================================================
  // getChannelGameStatsAndViewerTrends
  // ============================================================
  describe("getChannelGameStatsAndViewerTrends", () => {
    beforeEach(() => {
      cacheManager.clear();
    });

    it("should return both gameStats and viewerTrends", async () => {
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([]);
      (prisma.streamSession.findMany as jest.Mock).mockResolvedValue([]);

      const res = await getChannelGameStatsAndViewerTrends("ch1", "30d");
      expect(res).toHaveProperty("gameStats");
      expect(res).toHaveProperty("viewerTrends");
      expect(Array.isArray(res.gameStats)).toBe(true);
      expect(Array.isArray(res.viewerTrends)).toBe(true);
    });

    it("should aggregate game stats and session data together", async () => {
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([
        {
          gameName: "Chess",
          totalSeconds: 3600,
          weightedViewersSum: 1800,
          peakViewers: 50,
          streamCount: 1,
        },
      ]);
      const sessionDate = new Date("2025-01-15T20:00:00Z");
      (prisma.streamSession.findMany as jest.Mock).mockResolvedValue([
        {
          startedAt: sessionDate,
          title: "Chess Session",
          avgViewers: 50,
          peakViewers: 50,
          durationSeconds: 3600,
          category: "Chess",
        },
      ]);

      const res = await getChannelGameStatsAndViewerTrends("ch1_both", "7d");
      expect(res.gameStats).toHaveLength(1);
      expect(res.viewerTrends).toHaveLength(1);
      expect(res.gameStats[0].gameName).toBe("Chess");
    });

    it("should serve from cache on second call", async () => {
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([]);
      (prisma.streamSession.findMany as jest.Mock).mockResolvedValue([]);

      await getChannelGameStatsAndViewerTrends("ch_combined_cache", "30d");
      await getChannelGameStatsAndViewerTrends("ch_combined_cache", "30d");

      // streamSession.findMany should only be called once
      expect(prisma.streamSession.findMany).toHaveBeenCalledTimes(1);
    });
  });

  // ============================================================
  // getStreamerVideos
  // ============================================================
  describe("getStreamerVideos", () => {
    it("should return paginated video list", async () => {
      const mockVideos = [
        {
          id: "v1",
          twitchVideoId: "tw1",
          title: "Stream VOD",
          description: "desc",
          url: "http://twitch.tv/v1",
          thumbnailUrl: null,
          viewCount: 100,
          duration: "1h",
          language: "zh",
          type: "archive",
          createdAt: new Date(),
          publishedAt: new Date(),
        },
      ];
      (prisma.video.findMany as jest.Mock).mockResolvedValue(mockVideos);
      (prisma.video.count as jest.Mock).mockResolvedValue(1);

      const res = await getStreamerVideos("s1");
      expect(res.data).toHaveLength(1);
      expect(res.total).toBe(1);
      expect(res.page).toBe(1);
      expect(res.totalPages).toBe(1);
    });

    it("should handle page 2 with limit 10", async () => {
      (prisma.video.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.video.count as jest.Mock).mockResolvedValue(25);

      const res = await getStreamerVideos("s1", 10, 2);
      expect(res.page).toBe(2);
      expect(res.totalPages).toBe(3); // ceil(25/10)
    });

    it("should return empty list when no videos", async () => {
      (prisma.video.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.video.count as jest.Mock).mockResolvedValue(0);

      const res = await getStreamerVideos("s1");
      expect(res.data).toHaveLength(0);
      expect(res.total).toBe(0);
      expect(res.totalPages).toBe(0);
    });

    it("should default to limit=20 page=1", async () => {
      (prisma.video.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.video.count as jest.Mock).mockResolvedValue(0);

      await getStreamerVideos("s1");

      expect(prisma.video.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 20, skip: 0 })
      );
    });
  });

  // ============================================================
  // getStreamerClips
  // ============================================================
  describe("getStreamerClips", () => {
    it("should return paginated clip list", async () => {
      const mockClips = [
        {
          id: "cl1",
          twitchClipId: "twcl1",
          creatorName: "ClipCreator",
          title: "Epic Clip",
          url: "http://clips.twitch.tv/cl1",
          embedUrl: "http://clips.twitch.tv/embed/cl1",
          thumbnailUrl: null,
          viewCount: 500,
          duration: 30,
          createdAt: new Date(),
        },
      ];
      (prisma.clip.findMany as jest.Mock).mockResolvedValue(mockClips);
      (prisma.clip.count as jest.Mock).mockResolvedValue(1);

      const res = await getStreamerClips("s1");
      expect(res.data).toHaveLength(1);
      expect(res.total).toBe(1);
      expect(res.page).toBe(1);
      expect(res.totalPages).toBe(1);
    });

    it("should handle page 3 with limit 5", async () => {
      (prisma.clip.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.clip.count as jest.Mock).mockResolvedValue(15);

      const res = await getStreamerClips("s1", 5, 3);
      expect(res.page).toBe(3);
      expect(res.totalPages).toBe(3);
    });

    it("should return empty list when no clips", async () => {
      (prisma.clip.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.clip.count as jest.Mock).mockResolvedValue(0);

      const res = await getStreamerClips("s1");
      expect(res.data).toHaveLength(0);
      expect(res.totalPages).toBe(0);
    });

    it("should default to limit=20 page=1", async () => {
      (prisma.clip.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.clip.count as jest.Mock).mockResolvedValue(0);

      await getStreamerClips("s1");

      expect(prisma.clip.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 20, skip: 0 })
      );
    });
  });
});
