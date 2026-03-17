/**
 * query-metrics 單元測試
 *
 * 測試範圍：
 * - recordQueryDuration：記錄查詢時間到環形緩衝區
 * - getQueryStats：統計 count、average、p95、max
 * - 邊緣案例：空樣本、溢出環形緩衝區 (>200 samples)
 */

describe("query-metrics", () => {
  // 每個測試使用獨立的模組實例，避免共享模組層級狀態
  let recordQueryDuration: (durationMs: number) => void;
  let getQueryStats: () => { count: number; averageMs: number; p95Ms: number; maxMs: number } | null;

  beforeEach(async () => {
    jest.resetModules();
    const mod = await import("../query-metrics");
    recordQueryDuration = mod.recordQueryDuration;
    getQueryStats = mod.getQueryStats;
  });

  describe("getQueryStats", () => {
    it("should return null when no samples recorded", () => {
      expect(getQueryStats()).toBeNull();
    });

    it("should return correct stats for a single sample", () => {
      recordQueryDuration(100);
      const stats = getQueryStats();
      expect(stats).not.toBeNull();
      expect(stats!.count).toBe(1);
      expect(stats!.averageMs).toBe(100);
      expect(stats!.p95Ms).toBe(100);
      expect(stats!.maxMs).toBe(100);
    });

    it("should return correct stats for multiple samples", () => {
      // 10 samples: 10, 20, 30, ..., 100
      for (let i = 1; i <= 10; i++) {
        recordQueryDuration(i * 10);
      }
      const stats = getQueryStats();
      expect(stats).not.toBeNull();
      expect(stats!.count).toBe(10);
      // average = (10+20+...+100)/10 = 550/10 = 55
      expect(stats!.averageMs).toBe(55);
      // max = 100
      expect(stats!.maxMs).toBe(100);
      // p95 index = ceil(10 * 0.95) - 1 = ceil(9.5) - 1 = 10 - 1 = 9 → sorted[9] = 100
      expect(stats!.p95Ms).toBe(100);
    });

    it("should correctly compute p95 for larger datasets", () => {
      // 20 samples: 1..20
      for (let i = 1; i <= 20; i++) {
        recordQueryDuration(i);
      }
      const stats = getQueryStats();
      expect(stats!.count).toBe(20);
      // p95 index = ceil(20 * 0.95) - 1 = ceil(19) - 1 = 19 - 1 = 18 → sorted[18] = 19
      expect(stats!.p95Ms).toBe(19);
      expect(stats!.maxMs).toBe(20);
    });

    it("should accumulate samples across multiple calls", () => {
      recordQueryDuration(50);
      recordQueryDuration(150);
      const stats = getQueryStats();
      expect(stats!.count).toBe(2);
      expect(stats!.averageMs).toBe(100);
      expect(stats!.maxMs).toBe(150);
    });
  });

  describe("ring buffer overflow (>200 samples)", () => {
    it("should cap sampleCount at 200 and overwrite oldest entries", () => {
      // Fill buffer with 200 samples of value 1
      for (let i = 0; i < 200; i++) {
        recordQueryDuration(1);
      }
      // Overwrite the oldest 10 with value 999
      for (let i = 0; i < 10; i++) {
        recordQueryDuration(999);
      }

      const stats = getQueryStats();
      expect(stats).not.toBeNull();
      // sampleCount stays at 200 after overflow
      expect(stats!.count).toBe(200);
      // max should be 999
      expect(stats!.maxMs).toBe(999);
    });

    it("should maintain exactly 200 samples after overflow", () => {
      // Record 250 identical samples
      for (let i = 0; i < 250; i++) {
        recordQueryDuration(42);
      }
      const stats = getQueryStats();
      expect(stats!.count).toBe(200);
      expect(stats!.averageMs).toBe(42);
      expect(stats!.maxMs).toBe(42);
    });
  });

  describe("averageMs rounding", () => {
    it("should round average to 2 decimal places", () => {
      // 1 + 2 = 3, avg = 3/2 = 1.5 → rounds fine
      recordQueryDuration(1);
      recordQueryDuration(2);
      const stats = getQueryStats();
      expect(stats!.averageMs).toBe(1.5);
    });

    it("should handle fractional average correctly", () => {
      recordQueryDuration(1);
      recordQueryDuration(2);
      recordQueryDuration(3);
      const stats = getQueryStats();
      // avg = 6/3 = 2.00
      expect(stats!.averageMs).toBe(2);
    });
  });
});
