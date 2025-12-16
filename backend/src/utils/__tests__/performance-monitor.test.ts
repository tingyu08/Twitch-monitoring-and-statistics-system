/**
 * Performance Monitor Unit Tests
 */

import { PerformanceMonitor } from "../performance-monitor";

describe("PerformanceMonitor", () => {
  let monitor: PerformanceMonitor;

  beforeEach(() => {
    monitor = new PerformanceMonitor({ enableLogging: false });
  });

  afterEach(() => {
    monitor.reset();
  });

  describe("getStats", () => {
    it("should return empty stats when no metrics recorded", () => {
      const stats = monitor.getStats();

      expect(stats.totalRequests).toBe(0);
      expect(stats.averageResponseTime).toBe(0);
      expect(stats.slowRequests).toBe(0);
      expect(stats.fastRequests).toBe(0);
      expect(stats.p50).toBe(0);
      expect(stats.p95).toBe(0);
      expect(stats.p99).toBe(0);
      expect(Object.keys(stats.requestsByPath)).toHaveLength(0);
    });
  });

  describe("middleware", () => {
    it("should return a middleware function", () => {
      const middleware = monitor.middleware();
      expect(typeof middleware).toBe("function");
    });
  });

  describe("getMetrics", () => {
    it("should return a copy of metrics array", () => {
      const metrics = monitor.getMetrics();
      expect(Array.isArray(metrics)).toBe(true);
    });
  });

  describe("getSlowRequests", () => {
    it("should return an empty array when no slow requests", () => {
      const slowRequests = monitor.getSlowRequests();
      expect(slowRequests).toHaveLength(0);
    });
  });

  describe("reset", () => {
    it("should clear all metrics", () => {
      // 確認 reset 後指標為空
      monitor.reset();
      const metrics = monitor.getMetrics();
      expect(metrics).toHaveLength(0);
    });
  });
});

describe("PerformanceMonitor with custom config", () => {
  it("should accept custom slow threshold", () => {
    const customMonitor = new PerformanceMonitor({
      slowThreshold: 100,
      enableLogging: false,
    });

    expect(customMonitor).toBeDefined();
  });

  it("should accept custom max metrics history", () => {
    const customMonitor = new PerformanceMonitor({
      maxMetricsHistory: 500,
      enableLogging: false,
    });

    expect(customMonitor).toBeDefined();
  });
});
