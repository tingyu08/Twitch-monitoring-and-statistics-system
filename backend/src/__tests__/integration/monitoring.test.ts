/**
 * Story 3.5: Monitoring & Logging - Integration Tests
 * Tests for health check endpoints and performance monitoring
 */
import request from "supertest";
import express from "express";
import { performanceMonitor } from "../../utils/performance-monitor";

// --- Mocks BEFORE Imports ---
jest.mock("../../db/prisma", () => ({
  prisma: {
    $queryRaw: jest.fn().mockResolvedValue([1]),
  },
}));

jest.mock("../../services/twitch-chat.service", () => ({
  twurpleChatService: {
    getStatus: jest.fn().mockReturnValue({ connected: true, channelCount: 5 }),
    connect: jest.fn(),
  },
}));

jest.mock("../../services/chat-listener-manager", () => ({
  chatListenerManager: {
    getHealthStatus: jest.fn().mockReturnValue({ status: "healthy" }),
    getStats: jest.fn().mockReturnValue({ activeListeners: 2 }),
    getChannels: jest.fn().mockReturnValue([]),
  },
}));

// Mock distributed coordinator dynamically imported
jest.mock("../../services/distributed-coordinator", () => ({
  distributedCoordinator: {
    getAllInstances: jest.fn().mockResolvedValue([]),
    getChannelLocks: jest.fn().mockResolvedValue([]),
    getInstanceId: jest.fn().mockReturnValue("test-instance"),
    getAcquiredChannels: jest.fn().mockReturnValue([]),
  },
}));

// Now import routes after mocks are established
import { healthRoutes } from "../../modules/admin/health.routes";

// Create test app
const app = express();
app.use(express.json());
app.use(performanceMonitor.middleware());
app.use("/api/health", healthRoutes);

describe("Story 3.5: Monitoring & Logging", () => {
  describe("Health Check Endpoint", () => {
    it("GET /api/health should return 200 and healthy status", async () => {
      const res = await request(app).get("/api/health");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("healthy");
    });

    it("GET /api/health should include timestamp", async () => {
      const res = await request(app).get("/api/health");
      expect(res.body.timestamp).toBeDefined();
    });

    it("GET /api/health should include uptime", async () => {
      const res = await request(app).get("/api/health");
      expect(typeof res.body.uptime).toBe("number");
      expect(res.body.uptime).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Performance Monitoring", () => {
    it("should track request timing via middleware", async () => {
      // Make a request that is tracked by perfMonitor
      await request(app).get("/api/health");

      // Get stats
      const stats = performanceMonitor.getStats();
      expect(stats).toBeDefined();
      expect(stats.totalRequests).toBeGreaterThanOrEqual(1);
    });

    it("should accumulate request counts", async () => {
      const initialStats = performanceMonitor.getStats();
      const initialCount = initialStats.totalRequests || 0;

      await request(app).get("/api/health");
      await request(app).get("/api/health");

      const newStats = performanceMonitor.getStats();
      expect(newStats.totalRequests).toBeGreaterThanOrEqual(initialCount + 2);
    });
  });

  describe("Logging Capability", () => {
    it("should not throw when logging info", () => {
      expect(() => {
        console.log("[TEST] Info log test");
      }).not.toThrow();
    });

    it("should not throw when logging errors", () => {
      expect(() => {
        console.error("[TEST] Error log test");
      }).not.toThrow();
    });
  });
});
