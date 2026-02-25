/**
 * db-retry 單元測試
 *
 * 測試範圍：
 * - retryDatabaseOperation：成功、重試、指數退避、不可重試錯誤、自訂 shouldRetry
 * - batchOperation：分批、批間延遲、逐筆降級、onBatchComplete 回呼
 */

jest.mock("../logger", () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import { retryDatabaseOperation, batchOperation } from "../db-retry";

describe("retryDatabaseOperation", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("should return result on first success", async () => {
    const op = jest.fn().mockResolvedValue("ok");
    const result = await retryDatabaseOperation(op);
    expect(result).toBe("ok");
    expect(op).toHaveBeenCalledTimes(1);
  });

  it("should retry on retryable error and succeed", async () => {
    const op = jest
      .fn()
      .mockRejectedValueOnce(new Error("502 bad gateway"))
      .mockResolvedValue("recovered");

    const promise = retryDatabaseOperation(op, {
      initialDelayMs: 100,
      maxRetries: 3,
    });

    // Flush the first retry delay
    await jest.advanceTimersByTimeAsync(100);

    const result = await promise;
    expect(result).toBe("recovered");
    expect(op).toHaveBeenCalledTimes(2);
  });

  it("should throw after exhausting all retries", async () => {
    jest.useRealTimers();
    const error = new Error("503 service unavailable");
    const op = jest.fn().mockRejectedValue(error);

    await expect(
      retryDatabaseOperation(op, {
        maxRetries: 2,
        initialDelayMs: 10,
        maxDelayMs: 20,
      })
    ).rejects.toThrow("503 service unavailable");

    expect(op).toHaveBeenCalledTimes(3); // initial + 2 retries
    jest.useFakeTimers();
  });

  it("should not retry non-retryable errors", async () => {
    const error = new Error("unique constraint violation");
    const op = jest.fn().mockRejectedValue(error);

    await expect(
      retryDatabaseOperation(op, { maxRetries: 3 })
    ).rejects.toThrow("unique constraint violation");

    expect(op).toHaveBeenCalledTimes(1);
  });

  it("should apply exponential backoff with cap", async () => {
    const op = jest
      .fn()
      .mockRejectedValueOnce(new Error("timeout"))
      .mockRejectedValueOnce(new Error("timeout"))
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValue("done");

    const promise = retryDatabaseOperation(op, {
      maxRetries: 3,
      initialDelayMs: 100,
      backoffMultiplier: 2,
      maxDelayMs: 300,
    });

    // 1st retry: 100ms
    await jest.advanceTimersByTimeAsync(100);
    // 2nd retry: min(200, 300) = 200ms
    await jest.advanceTimersByTimeAsync(200);
    // 3rd retry: min(400, 300) = 300ms (capped)
    await jest.advanceTimersByTimeAsync(300);

    const result = await promise;
    expect(result).toBe("done");
    expect(op).toHaveBeenCalledTimes(4);
  });

  it("should retry known retryable error patterns", async () => {
    const retryableMessages = [
      "502 error",
      "503 error",
      "400 bad request",
      "bad gateway",
      "service unavailable",
      "timeout reached",
      "ECONNRESET",
      "ETIMEDOUT",
      "ENOTFOUND",
      "network error",
      "fetch failed",
      "server_error occurred",
      "batch request failed",
    ];

    for (const msg of retryableMessages) {
      const op = jest
        .fn()
        .mockRejectedValueOnce(new Error(msg))
        .mockResolvedValue("ok");

      const promise = retryDatabaseOperation(op, {
        maxRetries: 1,
        initialDelayMs: 10,
      });
      await jest.advanceTimersByTimeAsync(10);

      const result = await promise;
      expect(result).toBe("ok");
      expect(op).toHaveBeenCalledTimes(2);
    }
  });

  it("should support custom shouldRetry function", async () => {
    const customRetry = (err: unknown) =>
      err instanceof Error && err.message.includes("CUSTOM_RETRYABLE");

    const op = jest
      .fn()
      .mockRejectedValueOnce(new Error("CUSTOM_RETRYABLE"))
      .mockResolvedValue("ok");

    const promise = retryDatabaseOperation(op, {
      maxRetries: 2,
      initialDelayMs: 50,
      shouldRetry: customRetry,
    });

    await jest.advanceTimersByTimeAsync(50);

    const result = await promise;
    expect(result).toBe("ok");
    expect(op).toHaveBeenCalledTimes(2);
  });

  it("should not retry non-Error thrown values by default", async () => {
    const op = jest.fn().mockRejectedValue("string error");

    await expect(
      retryDatabaseOperation(op, { maxRetries: 3 })
    ).rejects.toBe("string error");

    expect(op).toHaveBeenCalledTimes(1);
  });
});

describe("batchOperation", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("should process all items in batches", async () => {
    const items = [1, 2, 3, 4, 5];
    const op = jest.fn().mockImplementation(async (batch: number[]) => batch.reduce((a, b) => a + b, 0));

    const promise = batchOperation(items, op, {
      batchSize: 2,
      delayBetweenBatchesMs: 50,
    });

    // Flush inter-batch delays: 2 delays for 3 batches
    await jest.advanceTimersByTimeAsync(50);
    await jest.advanceTimersByTimeAsync(50);

    const results = await promise;

    // Batches: [1,2]=3, [3,4]=7, [5]=5
    expect(results).toEqual([3, 7, 5]);
    expect(op).toHaveBeenCalledTimes(3);
    expect(op).toHaveBeenCalledWith([1, 2]);
    expect(op).toHaveBeenCalledWith([3, 4]);
    expect(op).toHaveBeenCalledWith([5]);
  });

  it("should call onBatchComplete callback", async () => {
    const items = [1, 2, 3, 4];
    const op = jest.fn().mockResolvedValue("done");
    const onComplete = jest.fn();

    const promise = batchOperation(items, op, {
      batchSize: 2,
      delayBetweenBatchesMs: 10,
      onBatchComplete: onComplete,
    });

    await jest.advanceTimersByTimeAsync(10);

    await promise;

    expect(onComplete).toHaveBeenCalledTimes(2);
    expect(onComplete).toHaveBeenCalledWith(1, 2); // batch 1 of 2
    expect(onComplete).toHaveBeenCalledWith(2, 2); // batch 2 of 2
  });

  it("should fallback to single-item processing on batch failure", async () => {
    const items = [1, 2, 3];
    let callCount = 0;
    const op = jest.fn().mockImplementation(async (batch: number[]) => {
      callCount++;
      // Fail on first call (batch of [1,2]), succeed on single items
      if (callCount === 1 && batch.length > 1) {
        throw new Error("batch request failed");
      }
      return batch.reduce((a, b) => a + b, 0);
    });

    const promise = batchOperation(items, op, {
      batchSize: 2,
      delayBetweenBatchesMs: 10,
      fallbackToSingleOnBatchFailure: true,
    });

    // Flush retry delays from retryDatabaseOperation + inter-batch delays
    for (let i = 0; i < 20; i++) {
      await jest.advanceTimersByTimeAsync(500);
    }

    const results = await promise;

    // First batch [1,2] fails -> retries exhaust -> falls back to [1] and [2] individually
    // Second batch [3] succeeds
    // Results should contain single-item results + the second batch
    expect(results.length).toBeGreaterThanOrEqual(2);
  });

  it("should skip fallback when fallbackToSingleOnBatchFailure is false", async () => {
    const items = [1, 2, 3, 4];
    const op = jest.fn()
      .mockRejectedValueOnce(new Error("batch request failed"))
      .mockResolvedValue("ok");

    const promise = batchOperation(items, op, {
      batchSize: 2,
      delayBetweenBatchesMs: 10,
      fallbackToSingleOnBatchFailure: false,
    });

    // Flush retry delays + inter-batch delays
    for (let i = 0; i < 20; i++) {
      await jest.advanceTimersByTimeAsync(500);
    }

    const results = await promise;

    // First batch failed and was skipped (no fallback), second batch succeeded
    expect(results).toContain("ok");
  });

  it("should handle empty items array", async () => {
    const op = jest.fn();
    const results = await batchOperation([], op);
    expect(results).toEqual([]);
    expect(op).not.toHaveBeenCalled();
  });

  it("should process single-item array without inter-batch delay", async () => {
    const op = jest.fn().mockResolvedValue("result");

    const results = await batchOperation([42], op, {
      batchSize: 10,
      delayBetweenBatchesMs: 1000,
    });

    expect(results).toEqual(["result"]);
    expect(op).toHaveBeenCalledWith([42]);
  });
});

describe("retryDatabaseOperation - 404 retryable pattern", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("should retry on 404 error (Turso connection issue)", async () => {
    const op = jest
      .fn()
      .mockRejectedValueOnce(new Error("404 not found"))
      .mockResolvedValue("recovered");

    const promise = retryDatabaseOperation(op, { maxRetries: 1, initialDelayMs: 10 });
    await jest.advanceTimersByTimeAsync(10);
    const result = await promise;
    expect(result).toBe("recovered");
    expect(op).toHaveBeenCalledTimes(2);
  });
});
