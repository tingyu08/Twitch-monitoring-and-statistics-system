/**
 * memory-thresholds.ts 單元測試
 *
 * 測試範圍：
 * - MEMORY_THRESHOLDS 常數讀取
 * - isMemorySafe / isMemoryCritical / shouldStopNewTasks
 * - getCurrentMemoryMB
 */

import {
  MEMORY_THRESHOLDS,
  isMemorySafe,
  isMemoryCritical,
  shouldStopNewTasks,
  getCurrentMemoryMB,
} from "../memory-thresholds";

describe("MEMORY_THRESHOLDS", () => {
  it("應有正確的預設常數值", () => {
    expect(MEMORY_THRESHOLDS.WARNING_MB).toBe(350);
    expect(MEMORY_THRESHOLDS.CRITICAL_MB).toBe(420);
    expect(MEMORY_THRESHOLDS.MAX_MB).toBe(450);
    expect(MEMORY_THRESHOLDS.GC_TRIGGER_MB).toBe(380);
  });

  it("WARNING_MB < GC_TRIGGER_MB < CRITICAL_MB < MAX_MB", () => {
    expect(MEMORY_THRESHOLDS.WARNING_MB).toBeLessThan(MEMORY_THRESHOLDS.GC_TRIGGER_MB);
    expect(MEMORY_THRESHOLDS.GC_TRIGGER_MB).toBeLessThan(MEMORY_THRESHOLDS.CRITICAL_MB);
    expect(MEMORY_THRESHOLDS.CRITICAL_MB).toBeLessThan(MEMORY_THRESHOLDS.MAX_MB);
  });
});

describe("isMemorySafe", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("記憶體低於 WARNING_MB 時應回傳 true", () => {
    const lowMemoryMB = 100;
    jest.spyOn(process, "memoryUsage").mockReturnValue({
      rss: lowMemoryMB * 1024 * 1024,
      heapTotal: 0,
      heapUsed: 0,
      external: 0,
      arrayBuffers: 0,
    });
    expect(isMemorySafe()).toBe(true);
  });

  it("記憶體等於 WARNING_MB 時應回傳 false", () => {
    const warningMB = MEMORY_THRESHOLDS.WARNING_MB;
    jest.spyOn(process, "memoryUsage").mockReturnValue({
      rss: warningMB * 1024 * 1024,
      heapTotal: 0,
      heapUsed: 0,
      external: 0,
      arrayBuffers: 0,
    });
    expect(isMemorySafe()).toBe(false);
  });

  it("記憶體超過 WARNING_MB 時應回傳 false", () => {
    const highMemoryMB = 400;
    jest.spyOn(process, "memoryUsage").mockReturnValue({
      rss: highMemoryMB * 1024 * 1024,
      heapTotal: 0,
      heapUsed: 0,
      external: 0,
      arrayBuffers: 0,
    });
    expect(isMemorySafe()).toBe(false);
  });
});

describe("isMemoryCritical", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("記憶體低於 CRITICAL_MB 時應回傳 false", () => {
    const safeMB = 300;
    jest.spyOn(process, "memoryUsage").mockReturnValue({
      rss: safeMB * 1024 * 1024,
      heapTotal: 0,
      heapUsed: 0,
      external: 0,
      arrayBuffers: 0,
    });
    expect(isMemoryCritical()).toBe(false);
  });

  it("記憶體等於 CRITICAL_MB 時應回傳 true", () => {
    const criticalMB = MEMORY_THRESHOLDS.CRITICAL_MB;
    jest.spyOn(process, "memoryUsage").mockReturnValue({
      rss: criticalMB * 1024 * 1024,
      heapTotal: 0,
      heapUsed: 0,
      external: 0,
      arrayBuffers: 0,
    });
    expect(isMemoryCritical()).toBe(true);
  });

  it("記憶體超過 CRITICAL_MB 時應回傳 true", () => {
    const criticalMB = 440;
    jest.spyOn(process, "memoryUsage").mockReturnValue({
      rss: criticalMB * 1024 * 1024,
      heapTotal: 0,
      heapUsed: 0,
      external: 0,
      arrayBuffers: 0,
    });
    expect(isMemoryCritical()).toBe(true);
  });
});

describe("shouldStopNewTasks", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("記憶體低於 MAX_MB 時應回傳 false", () => {
    const safeMB = 400;
    jest.spyOn(process, "memoryUsage").mockReturnValue({
      rss: safeMB * 1024 * 1024,
      heapTotal: 0,
      heapUsed: 0,
      external: 0,
      arrayBuffers: 0,
    });
    expect(shouldStopNewTasks()).toBe(false);
  });

  it("記憶體等於 MAX_MB 時應回傳 true", () => {
    const maxMB = MEMORY_THRESHOLDS.MAX_MB;
    jest.spyOn(process, "memoryUsage").mockReturnValue({
      rss: maxMB * 1024 * 1024,
      heapTotal: 0,
      heapUsed: 0,
      external: 0,
      arrayBuffers: 0,
    });
    expect(shouldStopNewTasks()).toBe(true);
  });

  it("記憶體超過 MAX_MB 時應回傳 true", () => {
    const overMaxMB = 500;
    jest.spyOn(process, "memoryUsage").mockReturnValue({
      rss: overMaxMB * 1024 * 1024,
      heapTotal: 0,
      heapUsed: 0,
      external: 0,
      arrayBuffers: 0,
    });
    expect(shouldStopNewTasks()).toBe(true);
  });
});

describe("getCurrentMemoryMB", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("應回傳四捨五入的 MB 值", () => {
    jest.spyOn(process, "memoryUsage").mockReturnValue({
      rss: 256 * 1024 * 1024,
      heapTotal: 0,
      heapUsed: 0,
      external: 0,
      arrayBuffers: 0,
    });
    expect(getCurrentMemoryMB()).toBe(256);
  });

  it("應對小數點四捨五入", () => {
    // 256.7 MB → 257
    jest.spyOn(process, "memoryUsage").mockReturnValue({
      rss: Math.round(256.7 * 1024 * 1024),
      heapTotal: 0,
      heapUsed: 0,
      external: 0,
      arrayBuffers: 0,
    });
    const result = getCurrentMemoryMB();
    expect(result).toBeGreaterThanOrEqual(256);
    expect(result).toBeLessThanOrEqual(257);
  });

  it("應回傳整數", () => {
    jest.spyOn(process, "memoryUsage").mockReturnValue({
      rss: 300 * 1024 * 1024,
      heapTotal: 0,
      heapUsed: 0,
      external: 0,
      arrayBuffers: 0,
    });
    const result = getCurrentMemoryMB();
    expect(Number.isInteger(result)).toBe(true);
  });
});
