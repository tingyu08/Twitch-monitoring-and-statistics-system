import { PerformanceMonitor } from "../performance-monitor";

describe("PerformanceMonitor", () => {
  let monitor: PerformanceMonitor;

  beforeEach(() => {
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
    expect(stats.slowRequests).toBe(1); // 500 > 200
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
});
