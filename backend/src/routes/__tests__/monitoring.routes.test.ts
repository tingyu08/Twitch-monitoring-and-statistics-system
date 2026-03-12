/**
 * monitoring.routes.ts 測試
 */

jest.mock("../../utils/performance-monitor", () => ({
  performanceMonitor: {
    getStats: jest.fn().mockReturnValue({ requests: 100, avgDuration: 50 }),
    getMemorySnapshot: jest.fn().mockReturnValue({ heapUsed: 50000000 }),
    getSlowRequests: jest.fn().mockReturnValue([
      { path: "/api/test", duration: 2000, timestamp: Date.now() },
    ]),
    reset: jest.fn(),
  },
}));

jest.mock("../../utils/cache-manager", () => ({
  cacheManager: {
    getStats: jest.fn().mockReturnValue({
      itemCount: 42,
      memoryUsage: 5 * 1024 * 1024,
      hitRate: 0.85,
    }),
    resetStats: jest.fn(),
  },
}));

import request from "supertest";
import express from "express";
import monitoringRouter from "../monitoring.routes";

const app = express();
app.use(express.json());
app.use("/api/monitoring", monitoringRouter);

describe("Monitoring Routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.NODE_ENV;
  });

  describe("GET /api/monitoring/performance", () => {
    it("returns performance stats", async () => {
      const res = await request(app).get("/api/monitoring/performance");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("requests");
    });
  });

  describe("GET /api/monitoring/cache", () => {
    it("returns cache stats", async () => {
      const res = await request(app).get("/api/monitoring/cache");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("itemCount");
    });
  });

  describe("GET /api/monitoring/memory", () => {
    it("returns memory info", async () => {
      const res = await request(app).get("/api/monitoring/memory");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("detailed");
      expect(res.body).toHaveProperty("limits");
      expect(res.body).toHaveProperty("usagePercent");
    });
  });

  describe("GET /api/monitoring/slow-requests", () => {
    it("returns slow requests list", async () => {
      const res = await request(app).get("/api/monitoring/slow-requests");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("count");
      expect(res.body).toHaveProperty("requests");
    });
  });

  describe("GET /api/monitoring/health", () => {
    it("returns health info with healthy status", async () => {
      const res = await request(app).get("/api/monitoring/health");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("status");
      expect(res.body).toHaveProperty("uptime");
      expect(res.body).toHaveProperty("memory");
      expect(res.body).toHaveProperty("cache");
      expect(res.body).toHaveProperty("timestamp");
    });

    it("reports warning status when rss is high", async () => {
      // Override process.memoryUsage temporarily
      const origMemoryUsage = process.memoryUsage;
      process.memoryUsage = jest.fn().mockReturnValue({
        rss: 380 * 1024 * 1024, // 380MB → warning
        heapUsed: 200 * 1024 * 1024,
        heapTotal: 400 * 1024 * 1024,
        external: 0,
        arrayBuffers: 0,
      }) as any;

      const res = await request(app).get("/api/monitoring/health");
      expect(res.body.status).toBe("warning");

      process.memoryUsage = origMemoryUsage;
    });

    it("reports critical status when rss is very high", async () => {
      const origMemoryUsage = process.memoryUsage;
      process.memoryUsage = jest.fn().mockReturnValue({
        rss: 450 * 1024 * 1024, // 450MB → critical
        heapUsed: 300 * 1024 * 1024,
        heapTotal: 400 * 1024 * 1024,
        external: 0,
        arrayBuffers: 0,
      }) as any;

      const res = await request(app).get("/api/monitoring/health");
      expect(res.body.status).toBe("critical");

      process.memoryUsage = origMemoryUsage;
    });
  });

  describe("POST /api/monitoring/reset", () => {
    it("resets stats in non-production environment", async () => {
      process.env.NODE_ENV = "development";
      const res = await request(app).post("/api/monitoring/reset");
      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/reset/i);
    });

    it("returns 403 in production environment", async () => {
      process.env.NODE_ENV = "production";
      const res = await request(app).post("/api/monitoring/reset");
      expect(res.status).toBe(403);
    });
  });
});
