/**
 * timeout.utils.ts 單元測試
 *
 * 測試範圍：
 * - withTimeout：成功完成、超時拋出 TimeoutError、計時器清理
 * - TimeoutError：屬性驗證
 * - isTimeoutError：類型守衛
 * - API_TIMEOUT_MS：常數值確認
 */

import { withTimeout, TimeoutError, isTimeoutError, API_TIMEOUT_MS } from "../timeout.utils";

describe("TimeoutError", () => {
  it("應正確設定屬性", () => {
    const err = new TimeoutError("Operation timed out", 5000);
    expect(err.message).toBe("Operation timed out");
    expect(err.timeoutMs).toBe(5000);
    expect(err.isTimeout).toBe(true);
    expect(err.name).toBe("TimeoutError");
  });

  it("應為 Error 的實例", () => {
    const err = new TimeoutError("timeout", 1000);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(TimeoutError);
  });
});

describe("isTimeoutError", () => {
  it("TimeoutError 實例應回傳 true", () => {
    const err = new TimeoutError("timeout", 1000);
    expect(isTimeoutError(err)).toBe(true);
  });

  it("帶有 isTimeout 屬性的一般 Error 應回傳 true", () => {
    const err = Object.assign(new Error("timeout"), { isTimeout: true });
    expect(isTimeoutError(err)).toBe(true);
  });

  it("一般 Error 應回傳 false", () => {
    expect(isTimeoutError(new Error("normal error"))).toBe(false);
  });

  it("非 Error 值應回傳 false", () => {
    expect(isTimeoutError("string")).toBe(false);
    expect(isTimeoutError(null)).toBe(false);
    expect(isTimeoutError(undefined)).toBe(false);
    expect(isTimeoutError(42)).toBe(false);
  });
});

describe("withTimeout", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("應回傳 Promise 成功結果", async () => {
    const promise = Promise.resolve("success");
    const result = await withTimeout(promise, 1000);
    expect(result).toBe("success");
  });

  it("Promise 比超時更快完成時不應拋出錯誤", async () => {
    const promise = new Promise<string>((resolve) => {
      setTimeout(() => resolve("done"), 500);
    });

    const resultPromise = withTimeout(promise, 2000);
    jest.advanceTimersByTime(500);
    const result = await resultPromise;
    expect(result).toBe("done");
  });

  it("超時時應拋出 TimeoutError", async () => {
    const neverResolves = new Promise<string>(() => {});
    const resultPromise = withTimeout(neverResolves, 1000, "Custom timeout message");

    jest.advanceTimersByTime(1000);

    await expect(resultPromise).rejects.toThrow(TimeoutError);
    await expect(resultPromise).rejects.toThrow("Custom timeout message");
  });

  it("超時錯誤應包含正確的 timeoutMs", async () => {
    const neverResolves = new Promise<string>(() => {});
    const resultPromise = withTimeout(neverResolves, 5000);

    jest.advanceTimersByTime(5000);

    try {
      await resultPromise;
    } catch (error) {
      expect(isTimeoutError(error)).toBe(true);
      if (error instanceof TimeoutError) {
        expect(error.timeoutMs).toBe(5000);
      }
    }
  });

  it("應使用預設錯誤訊息", async () => {
    const neverResolves = new Promise<string>(() => {});
    const resultPromise = withTimeout(neverResolves, 100);

    jest.advanceTimersByTime(100);

    await expect(resultPromise).rejects.toThrow("Operation timed out");
  });

  it("Promise 失敗時應傳遞原始錯誤", async () => {
    const originalError = new Error("Original error");
    const failingPromise = Promise.reject(originalError);
    await expect(withTimeout(failingPromise, 1000)).rejects.toThrow("Original error");
  });

  it("成功完成後應清理計時器（不留任何計時器）", async () => {
    const promise = Promise.resolve(42);
    const result = await withTimeout(promise, 10000);
    expect(result).toBe(42);
    // 清理計時器後，即使時間前進也不應有錯誤
    jest.advanceTimersByTime(10000);
  });
});

describe("API_TIMEOUT_MS", () => {
  it("應有正確的常數值", () => {
    expect(API_TIMEOUT_MS.SHORT).toBe(5000);
    expect(API_TIMEOUT_MS.MEDIUM).toBe(10000);
    expect(API_TIMEOUT_MS.LONG).toBe(30000);
  });

  it("SHORT < MEDIUM < LONG", () => {
    expect(API_TIMEOUT_MS.SHORT).toBeLessThan(API_TIMEOUT_MS.MEDIUM);
    expect(API_TIMEOUT_MS.MEDIUM).toBeLessThan(API_TIMEOUT_MS.LONG);
  });
});
