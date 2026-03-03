import type { Response } from "express";
import type { AuthRequest } from "../../auth/auth.middleware";

// --- Mocks must be declared before imports ---
jest.mock("../revenue.service", () => ({
  revenueService: {
    getRevenueOverview: jest.fn(),
    getSubscriptionStats: jest.fn(),
    getBitsStats: jest.fn(),
    getTopSupporters: jest.fn(),
    syncTwitchSubscriptions: jest.fn(),
    syncSubscriptionSnapshot: jest.fn(),
    prewarmRevenueCache: jest.fn(),
  },
}));

jest.mock("pdfkit", () => {
  const ctor = jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    pipe: jest.fn(),
    fontSize: jest.fn().mockReturnThis(),
    font: jest.fn().mockReturnThis(),
    text: jest.fn().mockReturnThis(),
    addPage: jest.fn().mockReturnThis(),
    end: jest.fn(),
    moveDown: jest.fn().mockReturnThis(),
    moveTo: jest.fn().mockReturnThis(),
    lineTo: jest.fn().mockReturnThis(),
    stroke: jest.fn().mockReturnThis(),
    y: 100,
  }));

  return {
    __esModule: true,
    default: ctor,
  };
});

jest.mock("../../../utils/cache-manager", () => ({
  cacheManager: {
    delete: jest.fn(),
    get: jest.fn(),
    set: jest.fn(),
    deleteRevenueCache: jest.fn(),
    getOrSetWithTags: jest.fn(),
  },
}));

jest.mock("../../../db/prisma", () => ({
  prisma: {
    twitchToken: { findFirst: jest.fn() },
    twitchEventSub: { findMany: jest.fn() },
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
  },
}));

jest.mock("../../../config/revenue.config", () => ({
  SYNC_TIMEOUT_MS: 30000,
  PDF_EXPORT: {
    FONT_SIZE: { TITLE: 18, HEADER: 14, BODY: 12 },
    MAX_DAYS: 90,
    MAX_RECORDS_PER_TABLE: 10,
  },
  QUERY_LIMITS: {
    DEFAULT_DAYS: 30,
    MIN_DAYS: 7,
    MAX_DAYS: 365,
    DEFAULT_LIMIT: 10,
    MIN_LIMIT: 1,
    MAX_LIMIT: 100,
  },
  BITS_TO_USD_RATE: 0.01,
}));

jest.mock("../../../utils/logger", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// Import after mocks are set up
import { revenueController } from "../revenue.controller";
import { revenueService } from "../revenue.service";
import { cacheManager } from "../../../utils/cache-manager";
import { prisma } from "../../../db/prisma";
import { logger } from "../../../utils/logger";
import PDFDocument from "pdfkit";

// --- Helpers ---
function makeReq(overrides: Partial<AuthRequest> = {}): AuthRequest {
  return {
    user: { streamerId: "streamer1", viewerId: "v1", role: "streamer" },
    query: {},
    body: {},
    cookies: {},
    ...overrides,
  } as unknown as AuthRequest;
}

function makeRes() {
  const res = {
    status: jest.fn(),
    json: jest.fn(),
    setHeader: jest.fn(),
    send: jest.fn(),
    write: jest.fn(),
    end: jest.fn(),
  } as unknown as Response;
  (res.status as jest.Mock).mockReturnValue(res);
  return res;
}

// --- Tests ---
describe("RevenueController", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  describe("getOverview", () => {
    it("returns service result on success", async () => {
      const mockData = {
        subscriptions: { current: 10, estimatedMonthlyRevenue: 50, tier1: 8, tier2: 2, tier3: 0 },
        bits: { totalBits: 1000, estimatedRevenue: 10, eventCount: 5 },
        totalEstimatedRevenue: 60,
      };
      (revenueService.getRevenueOverview as jest.Mock).mockResolvedValue(mockData);

      const req = makeReq();
      const res = makeRes();
      await revenueController.getOverview(req, res);

      expect(revenueService.getRevenueOverview).toHaveBeenCalledWith("streamer1");
      expect(res.json).toHaveBeenCalledWith(mockData);
    });

    it("returns 500 on service error", async () => {
      (revenueService.getRevenueOverview as jest.Mock).mockRejectedValue(new Error("DB error"));

      const req = makeReq();
      const res = makeRes();
      await revenueController.getOverview(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: "Failed to get revenue overview" })
      );
    });

    it("returns timeout fallback object with _timeout: true when service takes too long", async () => {
      jest.useFakeTimers();
      (revenueService.getRevenueOverview as jest.Mock).mockImplementation(
        () => new Promise(() => {}) // never resolves
      );

      const req = makeReq();
      const res = makeRes();
      const p = revenueController.getOverview(req, res);

      jest.advanceTimersByTime(26000);
      await jest.runAllTimersAsync();
      await p;
      jest.useRealTimers();

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ _timeout: true }));
    });

    it("returns 500 when streamerId is missing from req.user", async () => {
      const req = makeReq({ user: undefined });
      const res = makeRes();
      await revenueController.getOverview(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: "Failed to get revenue overview" })
      );
    });
  });

  // -------------------------------------------------------------------------
  describe("getSubscriptionStats", () => {
    it("returns service result with default days=30", async () => {
      const mockStats = [{ date: "2025-01-01", tier1Count: 5, tier2Count: 1, tier3Count: 0, totalSubscribers: 6, estimatedRevenue: 30 }];
      (revenueService.getSubscriptionStats as jest.Mock).mockResolvedValue(mockStats);

      const req = makeReq();
      const res = makeRes();
      await revenueController.getSubscriptionStats(req, res);

      expect(revenueService.getSubscriptionStats).toHaveBeenCalledWith("streamer1", 30);
      expect(res.json).toHaveBeenCalledWith(mockStats);
    });

    it("returns service result with custom days from query param", async () => {
      const mockStats = [{ date: "2025-01-01", tier1Count: 3, tier2Count: 0, tier3Count: 0, totalSubscribers: 3, estimatedRevenue: 15 }];
      (revenueService.getSubscriptionStats as jest.Mock).mockResolvedValue(mockStats);

      const req = makeReq({ query: { days: "60" } });
      const res = makeRes();
      await revenueController.getSubscriptionStats(req, res);

      expect(revenueService.getSubscriptionStats).toHaveBeenCalledWith("streamer1", 60);
      expect(res.json).toHaveBeenCalledWith(mockStats);
    });

    it("returns timeout fallback [] on timeout", async () => {
      jest.useFakeTimers();
      (revenueService.getSubscriptionStats as jest.Mock).mockImplementation(
        () => new Promise(() => {}) // never resolves
      );

      const req = makeReq();
      const res = makeRes();
      const p = revenueController.getSubscriptionStats(req, res);

      jest.advanceTimersByTime(26000);
      await jest.runAllTimersAsync();
      await p;
      jest.useRealTimers();

      expect(res.json).toHaveBeenCalledWith([]);
    });

    it("returns 500 on service error", async () => {
      (revenueService.getSubscriptionStats as jest.Mock).mockRejectedValue(new Error("DB error"));

      const req = makeReq();
      const res = makeRes();
      await revenueController.getSubscriptionStats(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: "Failed to get subscription stats" })
      );
    });
  });

  // -------------------------------------------------------------------------
  describe("getBitsStats", () => {
    it("returns service result", async () => {
      const mockStats = [{ date: "2025-01-01", totalBits: 500, estimatedRevenue: 5, eventCount: 3 }];
      (revenueService.getBitsStats as jest.Mock).mockResolvedValue(mockStats);

      const req = makeReq();
      const res = makeRes();
      await revenueController.getBitsStats(req, res);

      expect(revenueService.getBitsStats).toHaveBeenCalledWith("streamer1", 30);
      expect(res.json).toHaveBeenCalledWith(mockStats);
    });

    it("returns timeout fallback [] on timeout", async () => {
      jest.useFakeTimers();
      (revenueService.getBitsStats as jest.Mock).mockImplementation(
        () => new Promise(() => {}) // never resolves
      );

      const req = makeReq();
      const res = makeRes();
      const p = revenueController.getBitsStats(req, res);

      jest.advanceTimersByTime(26000);
      await jest.runAllTimersAsync();
      await p;
      jest.useRealTimers();

      expect(res.json).toHaveBeenCalledWith([]);
    });

    it("returns 500 on service error", async () => {
      (revenueService.getBitsStats as jest.Mock).mockRejectedValue(new Error("DB error"));

      const req = makeReq();
      const res = makeRes();
      await revenueController.getBitsStats(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: "Failed to get bits stats" })
      );
    });
  });

  // -------------------------------------------------------------------------
  describe("getTopSupporters", () => {
    it("returns service result with default limit", async () => {
      const mockSupporters = [{ userName: "user1", totalBits: 1000, eventCount: 5 }];
      (revenueService.getTopSupporters as jest.Mock).mockResolvedValue(mockSupporters);

      const req = makeReq();
      const res = makeRes();
      await revenueController.getTopSupporters(req, res);

      expect(revenueService.getTopSupporters).toHaveBeenCalledWith("streamer1", 10);
      expect(res.json).toHaveBeenCalledWith(mockSupporters);
    });

    it("returns service result with custom limit query param", async () => {
      const mockSupporters = [
        { userName: "user1", totalBits: 1000, eventCount: 5 },
        { userName: "user2", totalBits: 800, eventCount: 3 },
        { userName: "user3", totalBits: 600, eventCount: 2 },
      ];
      (revenueService.getTopSupporters as jest.Mock).mockResolvedValue(mockSupporters);

      const req = makeReq({ query: { limit: "3" } });
      const res = makeRes();
      await revenueController.getTopSupporters(req, res);

      expect(revenueService.getTopSupporters).toHaveBeenCalledWith("streamer1", 3);
      expect(res.json).toHaveBeenCalledWith(mockSupporters);
    });

    it("returns 500 on service error", async () => {
      (revenueService.getTopSupporters as jest.Mock).mockRejectedValue(new Error("DB error"));

      const req = makeReq();
      const res = makeRes();
      await revenueController.getTopSupporters(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: "Failed to get top supporters" })
      );
    });
  });

  // -------------------------------------------------------------------------
  describe("syncSubscriptions", () => {
    it("returns success response and clears cache", async () => {
      (revenueService.syncSubscriptionSnapshot as jest.Mock).mockResolvedValue(undefined);

      const req = makeReq();
      const res = makeRes();
      await revenueController.syncSubscriptions(req, res);

      expect(revenueService.syncSubscriptionSnapshot).toHaveBeenCalledWith("streamer1");
      expect(cacheManager.deleteRevenueCache).toHaveBeenCalledWith("streamer1");
      expect(revenueService.prewarmRevenueCache).toHaveBeenCalledWith("streamer1");
      expect(res.json).toHaveBeenCalledWith({ success: true, message: "Subscription data synced" });
    });

    it("returns 504 when sync times out", async () => {
      jest.useFakeTimers();
      (revenueService.syncSubscriptionSnapshot as jest.Mock).mockImplementation(() => new Promise(() => {}));

      const req = makeReq();
      const res = makeRes();
      const pending = revenueController.syncSubscriptions(req, res);

      jest.advanceTimersByTime(31_000);
      await jest.runAllTimersAsync();
      await pending;
      jest.useRealTimers();

      expect(res.status).toHaveBeenCalledWith(504);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: "Sync timeout - try again later" })
      );
    });

    it("returns 401 when token is invalid", async () => {
      (revenueService.syncSubscriptionSnapshot as jest.Mock).mockRejectedValue(
        new Error("no valid token")
      );

      const req = makeReq();
      const res = makeRes();
      await revenueController.syncSubscriptions(req, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: "Token expired - please re-login" })
      );
    });

    it("returns 403 when permission is denied", async () => {
      (revenueService.syncSubscriptionSnapshot as jest.Mock).mockRejectedValue(new Error("403"));

      const req = makeReq();
      const res = makeRes();
      await revenueController.syncSubscriptions(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: "Permission denied" }));
    });

    it("returns 507 for subscription limit errors", async () => {
      (revenueService.syncSubscriptionSnapshot as jest.Mock).mockRejectedValue(
        new Error("SUBSCRIPTION_LIMIT_EXCEEDED: hard limit")
      );

      const req = makeReq();
      const res = makeRes();
      await revenueController.syncSubscriptions(req, res);

      expect(res.status).toHaveBeenCalledWith(507);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: "Subscription limit exceeded", details: "hard limit" })
      );
    });

    it("returns generic 500 with details in development on unexpected error", async () => {
      const prevNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "development";
      (revenueService.syncSubscriptionSnapshot as jest.Mock).mockRejectedValue(new Error("boom"));

      const req = makeReq();
      const res = makeRes();
      await revenueController.syncSubscriptions(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: "Failed to sync subscriptions", details: "boom" })
      );
      process.env.NODE_ENV = prevNodeEnv;
    });

    it("returns generic 500 without details outside development", async () => {
      const prevNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "test";
      (revenueService.syncSubscriptionSnapshot as jest.Mock).mockRejectedValue(new Error("boom"));

      const req = makeReq();
      const res = makeRes();
      await revenueController.syncSubscriptions(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: "Failed to sync subscriptions", details: undefined })
      );
      process.env.NODE_ENV = prevNodeEnv;
    });

    it("handles undefined timer id in finally branch", async () => {
      const setTimeoutSpy = jest
        .spyOn(global, "setTimeout")
        .mockReturnValue(undefined as unknown as NodeJS.Timeout);
      (revenueService.syncSubscriptionSnapshot as jest.Mock).mockResolvedValue(undefined);

      const req = makeReq();
      const res = makeRes();
      await revenueController.syncSubscriptions(req, res);

      expect(res.json).toHaveBeenCalledWith({ success: true, message: "Subscription data synced" });
      setTimeoutSpy.mockRestore();
    });
  });

  // -------------------------------------------------------------------------
  describe("exportReport", () => {
    it("returns 400 for unsupported format", async () => {
      const req = makeReq({ query: { format: "xlsx" } });
      const res = makeRes();

      await revenueController.exportReport(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: "Only CSV and PDF formats are supported" })
      );
    });

    it("returns 400 when pdf days exceed max", async () => {
      const req = makeReq({ query: { format: "pdf", days: "100" } });
      const res = makeRes();

      await revenueController.exportReport(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining("PDF export is limited") })
      );
    });

    it("streams csv export when format=csv", async () => {
      const csvSpy = jest
        .spyOn(revenueController as any, "streamCsvExport")
        .mockResolvedValue(undefined);
      const req = makeReq({ query: { format: "csv", days: "14" } });
      const res = makeRes();

      await revenueController.exportReport(req, res);

      expect(csvSpy).toHaveBeenCalledWith(res, "streamer1", 14);
    });

    it("uses default csv format when format is omitted", async () => {
      const csvSpy = jest
        .spyOn(revenueController as any, "streamCsvExport")
        .mockResolvedValue(undefined);
      const req = makeReq({ query: { days: "20" } });
      const res = makeRes();

      await revenueController.exportReport(req, res);

      expect(csvSpy).toHaveBeenCalledWith(res, "streamer1", 20);
    });

    it("streams pdf export when format=pdf", async () => {
      (revenueService.getSubscriptionStats as jest.Mock).mockResolvedValue([]);
      (revenueService.getBitsStats as jest.Mock).mockResolvedValue([]);
      (revenueService.getRevenueOverview as jest.Mock).mockResolvedValue({
        subscriptions: {
          current: 0,
          estimatedMonthlyRevenue: 0,
          tier1: 0,
          tier2: 0,
          tier3: 0,
        },
        bits: { totalBits: 0, estimatedRevenue: 0, eventCount: 0 },
        totalEstimatedRevenue: 0,
      });
      const pdfSpy = jest
        .spyOn(revenueController as any, "streamPdfExport")
        .mockImplementation(() => undefined);
      const req = makeReq({ query: { format: "pdf", days: "30" } });
      const res = makeRes();

      await revenueController.exportReport(req, res);

      expect(pdfSpy).toHaveBeenCalled();
    });

    it("returns 500 with suggestion when pdf generation fails", async () => {
      (revenueService.getSubscriptionStats as jest.Mock).mockRejectedValue(new Error("pdf failed"));
      const req = makeReq({ query: { format: "pdf", days: "30" } });
      const res = makeRes();

      await revenueController.exportReport(req, res);

      expect(logger.error).toHaveBeenCalledWith(
        "RevenueController",
        "PDF generation failed:",
        expect.any(Error)
      );
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: "PDF generation failed" })
      );
    });

    it("includes pdf error details in development", async () => {
      const prevNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "development";
      (revenueService.getSubscriptionStats as jest.Mock).mockRejectedValue(new Error("pdf dev failed"));

      const req = makeReq({ query: { format: "pdf", days: "30" } });
      const res = makeRes();
      await revenueController.exportReport(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: "PDF generation failed", details: "pdf dev failed" })
      );
      process.env.NODE_ENV = prevNodeEnv;
    });

    it("returns outer 500 when streamer id is missing", async () => {
      const req = makeReq({ user: undefined });
      const res = makeRes();

      await revenueController.exportReport(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: "Failed to export report" });
    });
  });

  // -------------------------------------------------------------------------
  describe("streamCsvExport", () => {
    it("writes csv header and merged rows from subscriptions and bits", async () => {
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([
        {
          date: "2025-01-01",
          totalBits: BigInt(250),
          eventCount: BigInt(2),
        },
        {
          date: "2025-01-03",
          totalBits: BigInt(100),
          eventCount: BigInt(1),
        },
      ]);
      (prisma as any).subscriptionSnapshot = {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([
            {
              snapshotDate: new Date("2025-01-01T00:00:00.000Z"),
              tier1Count: 3,
              tier2Count: 1,
              tier3Count: 0,
              totalSubscribers: 4,
              estimatedRevenue: 20,
            },
          ])
          .mockResolvedValueOnce([]),
      };

      const res = makeRes();
      await (revenueController as any).streamCsvExport(res, "streamer1", 30);

      expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "text/csv; charset=utf-8");
      expect(res.write).toHaveBeenCalledWith("\ufeff");
      expect(res.write).toHaveBeenCalledWith(
        "Date,Tier1,Tier2,Tier3,Total,SubRevenue,Bits,BitsRevenue\n"
      );
      expect(res.write).toHaveBeenCalledWith(expect.stringContaining("2025-01-01,3,1,0,4,20.00,250,2.50"));
      expect(res.write).toHaveBeenCalledWith(expect.stringContaining("2025-01-03,0,0,0,0,0.00,100,1.00"));
      expect(res.end).toHaveBeenCalledTimes(1);
    });

    it("handles Date bits rows and subscription rows without bits", async () => {
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([
        {
          date: new Date("2025-01-02T00:00:00.000Z"),
          totalBits: BigInt(0),
          eventCount: BigInt(0),
        },
      ]);
      (prisma as any).subscriptionSnapshot = {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([
            {
              snapshotDate: new Date("2025-01-04T00:00:00.000Z"),
              tier1Count: 1,
              tier2Count: 0,
              tier3Count: 0,
              totalSubscribers: 1,
              estimatedRevenue: 0,
            },
          ])
          .mockResolvedValueOnce([]),
      };

      const res = makeRes();
      await (revenueController as any).streamCsvExport(res, "streamer1", 7);

      expect(res.write).toHaveBeenCalledWith(expect.stringContaining("2025-01-04,1,0,0,1,0.00,0,0.00"));
      expect(res.write).toHaveBeenCalledWith(expect.stringContaining("2025-01-02,0,0,0,0,0.00,0,0.00"));
      expect(res.end).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  describe("streamPdfExport", () => {
    it("sets pdf headers and ends document", () => {
      const res = makeRes();

      (revenueController as any).streamPdfExport(
        res,
        {
          subscriptions: {
            current: 1,
            estimatedMonthlyRevenue: 4.99,
            tier1: 1,
            tier2: 0,
            tier3: 0,
          },
          bits: { totalBits: 100, estimatedRevenue: 1, eventCount: 1 },
          totalEstimatedRevenue: 5.99,
        },
        [
          {
            date: "2025-01-01",
            tier1Count: 1,
            tier2Count: 0,
            tier3Count: 0,
            totalSubscribers: 1,
            estimatedRevenue: 4.99,
          },
        ],
        [{ date: "2025-01-01", totalBits: 100, estimatedRevenue: 1, eventCount: 1 }],
        30
      );

      expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "application/pdf");
      expect(PDFDocument).toHaveBeenCalledTimes(1);
    });

    it("handles empty subscription and bits arrays", () => {
      const res = makeRes();

      (revenueController as any).streamPdfExport(
        res,
        {
          subscriptions: {
            current: 0,
            estimatedMonthlyRevenue: 0,
            tier1: 0,
            tier2: 0,
            tier3: 0,
          },
          bits: { totalBits: 0, estimatedRevenue: 0, eventCount: 0 },
          totalEstimatedRevenue: 0,
        },
        [],
        [],
        7
      );

      expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "application/pdf");
    });
  });
});
