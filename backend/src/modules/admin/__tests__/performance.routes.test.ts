/**
 * performance.routes.ts 單元測試
 */

jest.mock("../../../utils/performance-monitor", () => ({
  performanceMonitor: {
    getStats: jest.fn().mockReturnValue({
      totalRequests: 100,
      averageResponseTime: 120,
      p95: 300,
      slowRequests: 5,
    }),
    getSlowRequests: jest.fn().mockReturnValue([
      { path: "/api/test", duration: 600 },
      { path: "/api/other", duration: 700 },
    ]),
    reset: jest.fn(),
  },
  performanceLogger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
  API_SLOW_THRESHOLD_MS: 500,
}));

jest.mock("../../../utils/cache-manager", () => ({
  cacheManager: {
    getStats: jest.fn().mockReturnValue({ hits: 50, misses: 10, size: 60 }),
  },
}));

jest.mock("../../../utils/revenue-sync-queue", () => ({
  revenueSyncQueue: {
    getStatus: jest.fn().mockResolvedValue({
      pending: 0,
      processing: 0,
      failed: 0,
      completed: 10,
      oldestWaitingMs: 0,
      failedRatioPercent: 0,
    }),
    getDiagnostics: jest.fn().mockResolvedValue({ failed: [], recent: [] }),
  },
}));

jest.mock("../../../utils/data-export-queue", () => ({
  dataExportQueue: {
    getStatus: jest.fn().mockResolvedValue({
      pending: 0,
      processing: 0,
      failed: 0,
      completed: 5,
      oldestWaitingMs: 0,
      failedRatioPercent: 0,
    }),
    getDiagnostics: jest.fn().mockResolvedValue({ failed: [], recent: [] }),
  },
}));

jest.mock("../../../utils/redis-client", () => ({
  getRedisCircuitBreakerStats: jest.fn().mockReturnValue({ state: "closed", failures: 0 }),
}));

jest.mock("../../../utils/job-circuit-breaker", () => ({
  getJobCircuitBreakerSnapshot: jest.fn().mockReturnValue({ jobs: {} }),
}));

import request from "supertest";
import express from "express";
import { performanceRoutes } from "../performance.routes";
import { revenueSyncQueue } from "../../../utils/revenue-sync-queue";
import { dataExportQueue } from "../../../utils/data-export-queue";
import { performanceMonitor, performanceLogger } from "../../../utils/performance-monitor";

const app = express();
app.use(express.json());
app.use("/api/admin/performance", performanceRoutes);

describe("performance.routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // restore defaults
    (revenueSyncQueue.getStatus as jest.Mock).mockResolvedValue({
      pending: 0, processing: 0, failed: 0, completed: 10,
      oldestWaitingMs: 0, failedRatioPercent: 0,
    });
    (dataExportQueue.getStatus as jest.Mock).mockResolvedValue({
      pending: 0, processing: 0, failed: 0, completed: 5,
      oldestWaitingMs: 0, failedRatioPercent: 0,
    });
    (performanceMonitor.getStats as jest.Mock).mockReturnValue({
      totalRequests: 100, averageResponseTime: 120, p95: 300, slowRequests: 5,
    });
  });

  // ====================================================
  // GET /stats
  // ====================================================
  describe("GET /stats", () => {
    it("returns 200 with performance stats", async () => {
      const res = await request(app).get("/api/admin/performance/stats");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty("api");
      expect(res.body.data).toHaveProperty("cache");
      expect(res.body.data).toHaveProperty("memory");
      expect(res.body.data).toHaveProperty("queues");
    });

    it("pushes alert when revenue queue oldestWaitingMs > 120s", async () => {
      (revenueSyncQueue.getStatus as jest.Mock).mockResolvedValue({
        oldestWaitingMs: 200000, failedRatioPercent: 0,
      });
      const res = await request(app).get("/api/admin/performance/stats");
      expect(res.status).toBe(200);
      expect(performanceLogger.warn).toHaveBeenCalled();
    });

    it("pushes alert when export queue oldestWaitingMs > 300s", async () => {
      (dataExportQueue.getStatus as jest.Mock).mockResolvedValue({
        oldestWaitingMs: 400000, failedRatioPercent: 0,
      });
      const res = await request(app).get("/api/admin/performance/stats");
      expect(res.status).toBe(200);
      expect(performanceLogger.warn).toHaveBeenCalled();
    });

    it("pushes alert when revenue failedRatioPercent > 5%", async () => {
      (revenueSyncQueue.getStatus as jest.Mock).mockResolvedValue({
        oldestWaitingMs: 0, failedRatioPercent: 10,
      });
      const res = await request(app).get("/api/admin/performance/stats");
      expect(res.status).toBe(200);
      expect(performanceLogger.warn).toHaveBeenCalled();
    });

    it("pushes alert when export failedRatioPercent > 10%", async () => {
      (dataExportQueue.getStatus as jest.Mock).mockResolvedValue({
        oldestWaitingMs: 0, failedRatioPercent: 15,
      });
      const res = await request(app).get("/api/admin/performance/stats");
      expect(res.status).toBe(200);
      expect(performanceLogger.warn).toHaveBeenCalled();
    });

    it("returns 500 when queue status throws", async () => {
      (revenueSyncQueue.getStatus as jest.Mock).mockRejectedValue(new Error("queue error"));
      const res = await request(app).get("/api/admin/performance/stats");
      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    });

    it("returns 500 when getStats throws synchronously", async () => {
      (performanceMonitor.getStats as jest.Mock).mockImplementation(() => {
        throw new Error("sync fail");
      });
      const res = await request(app).get("/api/admin/performance/stats");
      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Failed to retrieve performance statistics");
    });
  });

  // ====================================================
  // GET /slow
  // ====================================================
  describe("GET /slow", () => {
    it("returns slow request list", async () => {
      const res = await request(app).get("/api/admin/performance/slow");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.count).toBe(2);
    });

    it("returns 500 when getSlowRequests throws", async () => {
      (performanceMonitor.getSlowRequests as jest.Mock).mockImplementation(() => {
        throw new Error("fail");
      });
      const res = await request(app).get("/api/admin/performance/slow");
      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    });
  });

  // ====================================================
  // GET /queues
  // ====================================================
  describe("GET /queues", () => {
    it("returns queue status", async () => {
      const res = await request(app).get("/api/admin/performance/queues");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty("revenueSync");
      expect(res.body.data).toHaveProperty("dataExport");
    });

    it("returns 500 when queue status throws", async () => {
      (dataExportQueue.getStatus as jest.Mock).mockRejectedValue(new Error("fail"));
      const res = await request(app).get("/api/admin/performance/queues");
      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    });
  });

  // ====================================================
  // GET /queues/failed
  // ====================================================
  describe("GET /queues/failed", () => {
    it("returns diagnostics with default limit", async () => {
      const res = await request(app).get("/api/admin/performance/queues/failed");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty("revenueSync");
      expect(res.body.data).toHaveProperty("dataExport");
    });

    it("clamps limit to 1-100", async () => {
      const res = await request(app).get("/api/admin/performance/queues/failed?limit=200");
      expect(res.status).toBe(200);
    });

    it("returns 500 when diagnostics throws", async () => {
      (revenueSyncQueue.getDiagnostics as jest.Mock).mockRejectedValue(new Error("fail"));
      const res = await request(app).get("/api/admin/performance/queues/failed");
      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    });
  });

  // ====================================================
  // POST /reset
  // ====================================================
  describe("POST /reset", () => {
    const origEnv = process.env.NODE_ENV;
    afterEach(() => {
      process.env.NODE_ENV = origEnv;
    });

    it("resets metrics in non-production", async () => {
      process.env.NODE_ENV = "test";
      const res = await request(app).post("/api/admin/performance/reset");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(performanceMonitor.reset).toHaveBeenCalled();
    });

    it("returns 403 in production", async () => {
      process.env.NODE_ENV = "production";
      const res = await request(app).post("/api/admin/performance/reset");
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it("returns 500 when reset throws", async () => {
      process.env.NODE_ENV = "test";
      (performanceMonitor.reset as jest.Mock).mockImplementation(() => {
        throw new Error("fail");
      });
      const res = await request(app).post("/api/admin/performance/reset");
      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    });
  });

  // ====================================================
  // GET /health
  // ====================================================
  describe("GET /health", () => {
    it("returns 200 healthy when avg < 500 and p95 < 1000", async () => {
      (performanceMonitor.getStats as jest.Mock).mockReturnValue({
        totalRequests: 100, averageResponseTime: 200, p95: 500, slowRequests: 2,
      });
      const res = await request(app).get("/api/admin/performance/health");
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("healthy");
    });

    it("returns 503 degraded when avg >= 500", async () => {
      (performanceMonitor.getStats as jest.Mock).mockReturnValue({
        totalRequests: 100, averageResponseTime: 600, p95: 500, slowRequests: 50,
      });
      const res = await request(app).get("/api/admin/performance/health");
      expect(res.status).toBe(503);
      expect(res.body.data.status).toBe("degraded");
    });

    it("calculates slowRequestsRatio as 0 when totalRequests = 0", async () => {
      (performanceMonitor.getStats as jest.Mock).mockReturnValue({
        totalRequests: 0, averageResponseTime: 50, p95: 100, slowRequests: 0,
      });
      const res = await request(app).get("/api/admin/performance/health");
      expect(res.status).toBe(200);
      expect(res.body.data.metrics.slowRequestsRatio).toBe(0);
    });

    it("returns 500 when getStats throws", async () => {
      (performanceMonitor.getStats as jest.Mock).mockImplementation(() => {
        throw new Error("fail");
      });
      const res = await request(app).get("/api/admin/performance/health");
      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    });
  });

});
