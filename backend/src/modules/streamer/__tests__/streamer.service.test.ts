import { getStreamerSummary, getStreamerTimeSeries, getStreamerHeatmap } from "../streamer.service";
import { prisma } from "../../../db/prisma";
import { cacheManager } from "../../../utils/cache-manager";

jest.mock("../../../db/prisma", () => ({
  prisma: {
    channel: {
      findFirst: jest.fn(),
    },
    streamSession: {
      findMany: jest.fn(),
    },
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
  },
}));

describe("StreamerService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cacheManager.clear(); // 清除快取，防止測試間狀態污染
    cacheManager.clear();
  });

  describe("getStreamerSummary", () => {
    it("should return empty zeros if channel not found", async () => {
      (prisma.channel.findFirst as jest.Mock).mockResolvedValue(null);
      const res = await getStreamerSummary("s1", "7d");
      expect(res).toEqual(expect.objectContaining({ totalStreamSessions: 0, range: "7d" }));
    });

    it("should calc stats correctly", async () => {
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
  });

  describe("getStreamerTimeSeries", () => {
    it("should return default empty if no channel", async () => {
      (prisma.channel.findFirst as jest.Mock).mockResolvedValue(null);
      const res = await getStreamerTimeSeries("s1", "30d");
      expect(res.data).toHaveLength(0);
    });

    it("should aggregate data by day", async () => {
      (prisma.channel.findFirst as jest.Mock).mockResolvedValue({ id: "c1" });
      const today = new Date();
      const dateKey = today.toISOString().split("T")[0];
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([
        { bucketDate: dateKey, totalSeconds: 3600, sessionCount: 1 },
      ]);

      const res = await getStreamerTimeSeries("s1", "7d", "day");
      expect(res.data.length).toBeGreaterThan(0);
    });

    it("should aggregate data by week", async () => {
      (prisma.channel.findFirst as jest.Mock).mockResolvedValue({ id: "c1" });
      const now = new Date();
      const weekKey = now.toISOString().split("T")[0];
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([
        { bucketDate: weekKey, totalSeconds: 3600, sessionCount: 1 },
      ]);

      const res = await getStreamerTimeSeries("s1", "90d", "week");
      expect(res.granularity).toBe("week");
      expect(res.data.length).toBeGreaterThan(0);
    });

    it("should handle custom ranges", async () => {
      (prisma.channel.findFirst as jest.Mock).mockResolvedValue({ id: "c1" });
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([]);
      const res = await getStreamerTimeSeries("s1", "all");
      expect(res.range).toBe("all");
    });
  });

  describe("getStreamerHeatmap", () => {
    beforeEach(() => {
      // loadHeatmapAggregate 使用 $queryRaw：回傳空陣列使其 fallback 到 SQL 重算
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([]);
      // persistHeatmapAggregate 使用 $executeRaw
      (prisma.$executeRaw as jest.Mock).mockResolvedValue(0);
    });

    it("should return zeros if no channel", async () => {
      (prisma.channel.findFirst as jest.Mock).mockResolvedValue(null);
      const res = await getStreamerHeatmap("s1", "30d");
      expect(res.data).toHaveLength(0);
    });

    it("should generate heatmap matrix and handle zero data", async () => {
      (prisma.channel.findFirst as jest.Mock).mockResolvedValue({ id: "c1" });
      (prisma.streamSession.findMany as jest.Mock).mockResolvedValue([]);

      const res = await getStreamerHeatmap("s1", "30d");
      expect(res.data).toHaveLength(7 * 24);
      expect(res.minValue).toBe(0);
      expect(res.maxValue).toBe(0);
    });

    it("should generate heatmap matrix with data", async () => {
      (prisma.channel.findFirst as jest.Mock).mockResolvedValue({ id: "c1" });
      const sundayMorning = new Date("2025-12-14T10:00:00Z");

      // 第 1 次 $queryRaw: loadHeatmapAggregate -> []
      // 第 2 次 $queryRaw: buildHeatmapFromSessionsSql -> throw，觸發 fallback
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
  });
});
