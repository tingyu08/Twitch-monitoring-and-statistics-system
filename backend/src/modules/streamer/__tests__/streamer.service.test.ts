import {
  getStreamerSummary,
  getStreamerTimeSeries,
  getStreamerHeatmap,
} from "../streamer.service";
import { prisma } from "../../../db/prisma";

jest.mock("../../../db/prisma", () => ({
  prisma: {
    channel: {
      findFirst: jest.fn(),
    },
    streamSession: {
      findMany: jest.fn(),
    },
  },
}));

describe("StreamerService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("getStreamerSummary", () => {
    it("should return empty zeros if channel not found", async () => {
      (prisma.channel.findFirst as jest.Mock).mockResolvedValue(null);
      const res = await getStreamerSummary("s1", "7d");
      expect(res).toEqual(
        expect.objectContaining({ totalStreamSessions: 0, range: "7d" })
      );
    });

    it("should calc stats correctly", async () => {
      (prisma.channel.findFirst as jest.Mock).mockResolvedValue({ id: "c1" });
      (prisma.streamSession.findMany as jest.Mock).mockResolvedValue([
        { durationSeconds: 3600, startedAt: new Date() },
        { durationSeconds: 7200, startedAt: new Date() },
      ]);

      const res = await getStreamerSummary("s1", "30d");
      expect(res.totalStreamSessions).toBe(2);
      expect(res.totalStreamHours).toBeCloseTo(3);
      expect(res.avgStreamDurationMinutes).toBe(90);
    });

    it("should handle 90d range", async () => {
      (prisma.channel.findFirst as jest.Mock).mockResolvedValue({ id: "c1" });
      (prisma.streamSession.findMany as jest.Mock).mockResolvedValue([]);
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
      (prisma.streamSession.findMany as jest.Mock).mockResolvedValue([
        { durationSeconds: 3600, startedAt: today },
      ]);

      const res = await getStreamerTimeSeries("s1", "7d", "day");
      expect(res.data.length).toBeGreaterThan(0);
    });

    it("should aggregate data by week", async () => {
      (prisma.channel.findFirst as jest.Mock).mockResolvedValue({ id: "c1" });
      const now = new Date();
      (prisma.streamSession.findMany as jest.Mock).mockResolvedValue([
        { durationSeconds: 3600, startedAt: now },
      ]);

      const res = await getStreamerTimeSeries("s1", "90d", "week");
      expect(res.granularity).toBe("week");
      expect(res.data.length).toBeGreaterThan(0);
    });

    it("should handle custom ranges", async () => {
      (prisma.channel.findFirst as jest.Mock).mockResolvedValue({ id: "c1" });
      (prisma.streamSession.findMany as jest.Mock).mockResolvedValue([]);
      const res = await getStreamerTimeSeries("s1", "all");
      expect(res.range).toBe("all");
    });
  });

  describe("getStreamerHeatmap", () => {
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
      (prisma.streamSession.findMany as jest.Mock).mockResolvedValue([
        { durationSeconds: 3600, startedAt: sundayMorning },
      ]);

      const res = await getStreamerHeatmap("s1", "30d");
      expect(res.data).toHaveLength(7 * 24);
      expect(res.maxValue).toBeGreaterThan(0);
    });
  });
});
