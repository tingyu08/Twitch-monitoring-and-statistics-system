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

jest.mock("pdfkit", () => ({
  default: jest.fn().mockImplementation(() => ({
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
  })),
}));

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
  } as unknown as Response;
  (res.status as jest.Mock).mockReturnValue(res);
  return res;
}

// --- Tests ---
describe("RevenueController", () => {
  beforeEach(() => {
    jest.resetAllMocks();
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
});
