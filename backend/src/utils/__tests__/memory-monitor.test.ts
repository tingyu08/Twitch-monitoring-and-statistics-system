import { MemoryMonitor } from "../memory-monitor";

jest.mock("../cache-manager", () => ({
  cacheManager: { clear: jest.fn() },
}));

function mockMemoryUsage(rssMB: number) {
  return jest.spyOn(process, "memoryUsage").mockReturnValue({
    rss: rssMB * 1024 * 1024,
    heapUsed: 50 * 1024 * 1024,
    heapTotal: 100 * 1024 * 1024,
    external: 5 * 1024 * 1024,
    arrayBuffers: 0,
  });
}

describe("MemoryMonitor", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe("start / stop", () => {
    it("should start monitoring and set interval", () => {
      const monitor = new MemoryMonitor(400, 480);
      mockMemoryUsage(100);
      monitor.start(5000);
      expect((monitor as any).monitorInterval).not.toBeNull();
      monitor.stop();
    });

    it("should not create duplicate interval on second start()", () => {
      const monitor = new MemoryMonitor(400, 480);
      mockMemoryUsage(100);
      monitor.start(5000);
      const first = (monitor as any).monitorInterval;
      monitor.start(5000);
      expect((monitor as any).monitorInterval).toBe(first);
      monitor.stop();
    });

    it("should clear interval on stop()", () => {
      const monitor = new MemoryMonitor(400, 480);
      mockMemoryUsage(100);
      monitor.start(5000);
      monitor.stop();
      expect((monitor as any).monitorInterval).toBeNull();
    });

    it("should not throw when stop() called without start()", () => {
      const monitor = new MemoryMonitor(400, 480);
      expect(() => monitor.stop()).not.toThrow();
    });

    it("should call check() via setInterval", () => {
      const monitor = new MemoryMonitor(400, 480);
      mockMemoryUsage(100);
      const spy = jest.spyOn(monitor, "check");
      monitor.start(1000);
      jest.advanceTimersByTime(3000);
      expect(spy).toHaveBeenCalledTimes(3);
      monitor.stop();
    });
  });

  describe("check()", () => {
    it("should return memory stats in MB", () => {
      mockMemoryUsage(200);
      const monitor = new MemoryMonitor(400, 480);
      const stats = monitor.check();
      expect(stats.rss).toBe(200);
      expect(stats.heapUsed).toBe(50);
    });

    it("should call handleWarning when rss >= warningThresholdMB", () => {
      mockMemoryUsage(410);
      const monitor = new MemoryMonitor(400, 480);
      const spy = jest.spyOn(monitor as any, "handleWarning");
      monitor.check();
      expect(spy).toHaveBeenCalled();
    });

    it("should call handleCritical when rss >= criticalThresholdMB", () => {
      mockMemoryUsage(490);
      const monitor = new MemoryMonitor(400, 480);
      const spy = jest.spyOn(monitor as any, "handleCritical");
      monitor.check();
      expect(spy).toHaveBeenCalled();
    });

    it("should not call warnings when rss is below thresholds", () => {
      mockMemoryUsage(100);
      const monitor = new MemoryMonitor(400, 480);
      const warnSpy = jest.spyOn(monitor as any, "handleWarning");
      const critSpy = jest.spyOn(monitor as any, "handleCritical");
      monitor.check();
      expect(warnSpy).not.toHaveBeenCalled();
      expect(critSpy).not.toHaveBeenCalled();
    });
  });

  describe("getStats()", () => {
    it("should return formatted string", () => {
      mockMemoryUsage(200);
      const monitor = new MemoryMonitor(400, 480);
      const result = monitor.getStats();
      expect(result).toContain("200MB");
      expect(result).toContain("Heap Used");
    });
  });

  describe("handleWarning cooldown", () => {
    it("should not repeat warning within cooldown period", () => {
      mockMemoryUsage(450);
      const monitor = new MemoryMonitor(400, 480);
      const gcSpy = jest.spyOn(monitor as any, "tryGC");
      monitor.check();
      monitor.check(); // second call within 60s cooldown
      expect(gcSpy).toHaveBeenCalledTimes(1);
    });

    it("should warn again after cooldown expires", () => {
      mockMemoryUsage(450);
      const monitor = new MemoryMonitor(400, 480);
      const gcSpy = jest.spyOn(monitor as any, "tryGC");
      monitor.check();
      jest.advanceTimersByTime(61000);
      monitor.check();
      expect(gcSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe("tryGC()", () => {
    it("should call global.gc when available", () => {
      const originalGc = (global as any).gc;
      const mockGc = jest.fn();
      (global as any).gc = mockGc;
      mockMemoryUsage(100);

      const monitor = new MemoryMonitor(400, 480);
      (monitor as any).tryGC();

      expect(mockGc).toHaveBeenCalled();
      (global as any).gc = originalGc;
    });

    it("should not throw when global.gc is undefined", () => {
      const originalGc = (global as any).gc;
      delete (global as any).gc;

      const monitor = new MemoryMonitor(400, 480);
      expect(() => (monitor as any).tryGC()).not.toThrow();

      (global as any).gc = originalGc;
    });

    it("should not throw when global.gc throws", () => {
      const originalGc = (global as any).gc;
      (global as any).gc = () => { throw new Error("GC failed"); };

      const monitor = new MemoryMonitor(400, 480);
      expect(() => (monitor as any).tryGC()).not.toThrow();

      (global as any).gc = originalGc;
    });
  });

  describe("isNearLimit / isOverLimit", () => {
    it("isNearLimit returns true when rss >= warningThreshold", () => {
      mockMemoryUsage(401);
      const monitor = new MemoryMonitor(400, 480);
      expect(monitor.isNearLimit()).toBe(true);
    });

    it("isNearLimit returns false when rss < warningThreshold", () => {
      mockMemoryUsage(100);
      const monitor = new MemoryMonitor(400, 480);
      expect(monitor.isNearLimit()).toBe(false);
    });

    it("isOverLimit returns true when rss >= criticalThreshold", () => {
      mockMemoryUsage(481);
      const monitor = new MemoryMonitor(400, 480);
      expect(monitor.isOverLimit()).toBe(true);
    });

    it("isOverLimit returns false when rss < criticalThreshold", () => {
      mockMemoryUsage(200);
      const monitor = new MemoryMonitor(400, 480);
      expect(monitor.isOverLimit()).toBe(false);
    });
  });

  describe("getCachedStats() - TTL caching", () => {
    it("should return cached stats within TTL", () => {
      const spy = jest.spyOn(process, "memoryUsage").mockReturnValue({
        rss: 100 * 1024 * 1024,
        heapUsed: 50 * 1024 * 1024,
        heapTotal: 100 * 1024 * 1024,
        external: 5 * 1024 * 1024,
        arrayBuffers: 0,
      });
      const monitor = new MemoryMonitor(400, 480);
      monitor.isNearLimit(); // first call populates cache
      monitor.isNearLimit(); // second call should use cache
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it("should refresh stats after TTL expires", () => {
      const spy = jest.spyOn(process, "memoryUsage").mockReturnValue({
        rss: 100 * 1024 * 1024,
        heapUsed: 50 * 1024 * 1024,
        heapTotal: 100 * 1024 * 1024,
        external: 5 * 1024 * 1024,
        arrayBuffers: 0,
      });
      const monitor = new MemoryMonitor(400, 480);
      monitor.isNearLimit();
      jest.advanceTimersByTime(6000); // past 5s TTL
      monitor.isNearLimit();
      expect(spy).toHaveBeenCalledTimes(2);
    });
  });
});
