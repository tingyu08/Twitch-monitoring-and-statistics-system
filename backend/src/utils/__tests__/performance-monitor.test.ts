jest.mock("../logger", () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock("../../db/query-metrics", () => ({
  getQueryStats: jest.fn(() => null),
}));

import { logger } from "../logger";
import { getQueryStats } from "../../db/query-metrics";
import { PerformanceMonitor, performanceLogger } from "../performance-monitor";

describe("PerformanceMonitor", () => {
  let monitor: PerformanceMonitor;

  beforeEach(() => {
    jest.clearAllMocks();
    monitor = new PerformanceMonitor({ enableLogging: false });
  });

  it("should record metrics via middleware", (done) => {
    const req = { path: "/test", method: "GET" } as any;
    const res = {
      statusCode: 200,
      on: jest.fn((event, callback) => {
        if (event === "finish") {
          // Simulate some time passed and trigger
          setTimeout(callback, 10);
        }
      }),
    } as any;
    const next = jest.fn();

    const mw = monitor.middleware();
    mw(req, res, next);

    expect(next).toHaveBeenCalled();

    // After res.on('finish') is called
    setTimeout(() => {
      const stats = monitor.getStats();
      expect(stats.totalRequests).toBe(1);
      expect(stats.requestsByPath["GET /test"]).toBeDefined();
      expect(stats.requestsByPath["GET /test"].count).toBe(1);
      done();
    }, 50);
  });

  it("should calculate percentiles correctly", () => {
    const monitor = new PerformanceMonitor({ enableLogging: false });
    // Manually add metrics
    (monitor as any).recordMetric({
      duration: 10,
      path: "/a",
      method: "G",
      statusCode: 200,
      timestamp: new Date(),
    });
    (monitor as any).recordMetric({
      duration: 20,
      path: "/a",
      method: "G",
      statusCode: 200,
      timestamp: new Date(),
    });
    (monitor as any).recordMetric({
      duration: 30,
      path: "/a",
      method: "G",
      statusCode: 200,
      timestamp: new Date(),
    });
    (monitor as any).recordMetric({
      duration: 500,
      path: "/a",
      method: "G",
      statusCode: 200,
      timestamp: new Date(),
    });

    const stats = monitor.getStats();
    expect(stats.p50).toBeDefined();
    expect(stats.slowRequests).toBe(0); // 預設 slowThreshold 是 1000ms，500ms 不算慢
  });

  it("should reset metrics", () => {
    (monitor as any).recordMetric({
      duration: 10,
      path: "/a",
      method: "G",
      statusCode: 200,
      timestamp: new Date(),
    });
    monitor.reset();
    expect(monitor.getStats().totalRequests).toBe(0);
  });

  it("returns cached stats core when stats are clean", () => {
    (monitor as any).recordMetric({
      duration: 10,
      path: "/a",
      method: "GET",
      statusCode: 200,
      timestamp: new Date(),
    });

    const first = monitor.getStats();
    const second = monitor.getStats();

    expect(first.totalRequests).toBe(1);
    expect(second.totalRequests).toBe(1);
  });

  it("returns dbQueries when query stats exist", () => {
    (getQueryStats as jest.Mock).mockReturnValue({
      count: 3,
      averageMs: 12,
      p95Ms: 20,
      maxMs: 30,
    });

    const stats = monitor.getStats();
    expect(stats.dbQueries).toEqual({
      count: 3,
      averageMs: 12,
      p95Ms: 20,
      maxMs: 30,
    });
  });

  it("tracks slow requests with custom threshold", () => {
    const slowMonitor = new PerformanceMonitor({ enableLogging: false, slowThreshold: 100 });
    (slowMonitor as any).recordMetric({
      duration: 150,
      path: "/slow",
      method: "GET",
      statusCode: 200,
      timestamp: new Date(),
    });

    const stats = slowMonitor.getStats();
    expect(stats.slowRequests).toBe(1);
    expect(stats.fastRequests).toBe(0);
    expect(slowMonitor.getSlowRequests()).toHaveLength(1);
  });

  it("uses circular buffer when max history is exceeded", () => {
    const smallMonitor = new PerformanceMonitor({
      enableLogging: false,
      maxMetricsHistory: 2,
    });

    ;(smallMonitor as any).recordMetric({
      duration: 10,
      path: "/1",
      method: "GET",
      statusCode: 200,
      timestamp: new Date(),
    });
    ;(smallMonitor as any).recordMetric({
      duration: 20,
      path: "/2",
      method: "GET",
      statusCode: 200,
      timestamp: new Date(),
    });
    ;(smallMonitor as any).recordMetric({
      duration: 30,
      path: "/3",
      method: "GET",
      statusCode: 200,
      timestamp: new Date(),
    });

    const metrics = smallMonitor.getMetrics();
    expect(metrics).toHaveLength(2);
    expect(metrics.some((m) => m.path === "/3")).toBe(true);
  });

  it("logs warn for slow request when logging enabled", () => {
    const loggingMonitor = new PerformanceMonitor({ enableLogging: true, slowThreshold: 100 });
    ;(loggingMonitor as any).recordMetric({
      duration: 150,
      path: "/slow",
      method: "GET",
      statusCode: 200,
      timestamp: new Date(),
    });

    expect(logger.warn).toHaveBeenCalled();
  });

  it("logs debug for fast request when logging enabled", () => {
    const loggingMonitor = new PerformanceMonitor({ enableLogging: true, slowThreshold: 100 });
    ;(loggingMonitor as any).recordMetric({
      duration: 50,
      path: "/fast",
      method: "GET",
      statusCode: 200,
      timestamp: new Date(),
    });

    expect(logger.debug).toHaveBeenCalled();
  });

  it("normalizes route path ids and strips query string via middleware", (done) => {
    const req = {
      originalUrl: "/users/123/orders/550e8400-e29b-41d4-a716-446655440000?foo=bar",
      path: "/ignored",
      method: "GET",
    } as any;
    const res = {
      statusCode: 200,
      on: jest.fn((event, callback) => {
        if (event === "finish") {
          setTimeout(callback, 10);
        }
      }),
    } as any;

    const mw = monitor.middleware();
    mw(req, res, jest.fn());

    setTimeout(() => {
      const stats = monitor.getStats();
      expect(stats.requestsByPath["GET /users/:id/orders/:id"]).toBeDefined();
      done();
    }, 40);
  });

  it("normalizes 24-char hex ids via middleware", (done) => {
    const req = {
      originalUrl: "/items/507f1f77bcf86cd799439011/details",
      path: "/ignored",
      method: "GET",
    } as any;
    const res = {
      statusCode: 200,
      on: jest.fn((event, callback) => {
        if (event === "finish") {
          setTimeout(callback, 10);
        }
      }),
    } as any;

    monitor.middleware()(req, res, jest.fn());

    setTimeout(() => {
      const stats = monitor.getStats();
      expect(stats.requestsByPath["GET /items/:id/details"]).toBeDefined();
      done();
    }, 40);
  });

  it("forces minDuration Infinity fallback branch to 0", () => {
    (monitor as any).recordMetric({
      duration: 10,
      path: "/inf",
      method: "GET",
      statusCode: 200,
      timestamp: new Date(),
    });

    const realMin = Math.min;
    const minSpy = jest.spyOn(Math, "min").mockImplementation(((a: number, b: number) => {
      if (a === Infinity && b === 10) {
        return Infinity;
      }
      return realMin(a, b);
    }) as typeof Math.min);

    const stats = monitor.getStats();
    minSpy.mockRestore();

    expect(stats.requestsByPath["GET /inf"].minDuration).toBe(0);
  });

  it("returns memory snapshot in MB", () => {
    const memSpy = jest.spyOn(process, "memoryUsage").mockReturnValue({
      rss: 300 * 1024 * 1024,
      heapTotal: 200 * 1024 * 1024,
      heapUsed: 100 * 1024 * 1024,
      external: 50 * 1024 * 1024,
      arrayBuffers: 0,
    });

    const snapshot = monitor.getMemorySnapshot();
    memSpy.mockRestore();

    expect(snapshot.heapUsed).toBe(100);
    expect(snapshot.heapTotal).toBe(200);
    expect(snapshot.rss).toBe(300);
    expect(snapshot.external).toBe(50);
  });

  it("supports stop as a no-op", () => {
    expect(() => monitor.stop()).not.toThrow();
  });

  it("supports private memory monitor no-op helpers", () => {
    expect(() => (monitor as any).startMemoryMonitoring()).not.toThrow();
    expect(() => (monitor as any).checkMemoryUsage()).not.toThrow();
  });

  it("uses production defaults when imported under production env", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    jest.resetModules();

    const mod = await import("../performance-monitor");

    process.env.NODE_ENV = originalNodeEnv;

    expect(mod.API_SLOW_THRESHOLD_MS).toBe(2000);
    const prodMonitor = new mod.PerformanceMonitor();
    expect((prodMonitor as any).config.maxMetricsHistory).toBe(100);
  });

  it("uses non-production defaults when imported under test env", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";
    jest.resetModules();

    const mod = await import("../performance-monitor");

    process.env.NODE_ENV = originalNodeEnv;

    expect(mod.API_SLOW_THRESHOLD_MS).toBe(1000);
    const testMonitor = new mod.PerformanceMonitor();
    expect((testMonitor as any).config.maxMetricsHistory).toBe(200);
  });

  it("performanceLogger proxies to base logger", () => {
    performanceLogger.debug("d", 1);
    performanceLogger.info("i", 2);
    performanceLogger.warn("w", 3);
    performanceLogger.error("e", 4);

    expect(logger.debug).toHaveBeenCalledWith("PERFORMANCE", "d", 1);
    expect(logger.info).toHaveBeenCalledWith("PERFORMANCE", "i", 2);
    expect(logger.warn).toHaveBeenCalledWith("PERFORMANCE", "w", 3);
    expect(logger.error).toHaveBeenCalledWith("PERFORMANCE", "e", 4);
  });
});
