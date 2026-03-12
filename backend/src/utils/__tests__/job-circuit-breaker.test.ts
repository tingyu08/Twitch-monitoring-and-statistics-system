/**
 * job-circuit-breaker.ts 單元測試
 */

jest.mock("../logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { isTransientDbConnectivityError } from "../job-circuit-breaker";

// Reset module state between tests by re-importing a fresh module
beforeEach(() => {
  jest.resetModules();
});

describe("isTransientDbConnectivityError", () => {
  it("returns false for non-Error values", () => {
    expect(isTransientDbConnectivityError("string")).toBe(false);
    expect(isTransientDbConnectivityError(null)).toBe(false);
    expect(isTransientDbConnectivityError(42)).toBe(false);
  });

  it("returns false for non-transient Error messages", () => {
    expect(isTransientDbConnectivityError(new Error("constraint violation"))).toBe(false);
  });

  it("recognizes eai_again", () => {
    expect(isTransientDbConnectivityError(new Error("EAI_AGAIN dns lookup failed"))).toBe(true);
  });

  it("recognizes etimedout", () => {
    expect(isTransientDbConnectivityError(new Error("ETIMEDOUT connection"))).toBe(true);
  });

  it("recognizes econnreset", () => {
    expect(isTransientDbConnectivityError(new Error("ECONNRESET socket"))).toBe(true);
  });

  it("recognizes enotfound", () => {
    expect(isTransientDbConnectivityError(new Error("ENOTFOUND host"))).toBe(true);
  });

  it("recognizes fetch failed", () => {
    expect(isTransientDbConnectivityError(new Error("fetch failed"))).toBe(true);
  });

  it("recognizes network", () => {
    expect(isTransientDbConnectivityError(new Error("network timeout"))).toBe(true);
  });

  it("recognizes pipeline failed", () => {
    expect(isTransientDbConnectivityError(new Error("pipeline failed error"))).toBe(true);
  });
});

describe("circuit breaker lifecycle", () => {
  // Need fresh module to isolate state
  let cbModule: typeof import("../job-circuit-breaker");

  beforeEach(async () => {
    jest.resetModules();
    jest.mock("../logger", () => ({
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    }));
    cbModule = await import("../job-circuit-breaker");
  });

  it("should not skip a fresh job", () => {
    expect(cbModule.shouldSkipForCircuitBreaker("job-new")).toBe(false);
  });

  it("records success and resets failures", () => {
    cbModule.recordJobSuccess("job-x");
    expect(cbModule.shouldSkipForCircuitBreaker("job-x")).toBe(false);
  });

  it("does not trip breaker for non-transient error", () => {
    cbModule.recordJobFailure("job-stable", new Error("business error"));
    expect(cbModule.shouldSkipForCircuitBreaker("job-stable")).toBe(false);
  });

  it("trips breaker after threshold consecutive transient failures", () => {
    const jobName = "job-transient";
    const transientErr = new Error("econnreset dropped");
    // Default threshold is 3
    cbModule.recordJobFailure(jobName, transientErr);
    cbModule.recordJobFailure(jobName, transientErr);
    expect(cbModule.shouldSkipForCircuitBreaker(jobName)).toBe(false);
    cbModule.recordJobFailure(jobName, transientErr);
    // Now breaker should be open
    expect(cbModule.shouldSkipForCircuitBreaker(jobName)).toBe(true);
  });

  it("resets after pause period expires", () => {
    jest.useFakeTimers();
    const jobName = "job-reset";
    const transientErr = new Error("etimedout connection");

    cbModule.recordJobFailure(jobName, transientErr);
    cbModule.recordJobFailure(jobName, transientErr);
    cbModule.recordJobFailure(jobName, transientErr);

    expect(cbModule.shouldSkipForCircuitBreaker(jobName)).toBe(true);

    // Advance past default pause (300000 ms)
    jest.advanceTimersByTime(300001);

    // Should reset on next check
    expect(cbModule.shouldSkipForCircuitBreaker(jobName)).toBe(false);
    jest.useRealTimers();
  });

  it("getJobCircuitBreakerSnapshot returns snapshot array", () => {
    cbModule.recordJobSuccess("snap-job");
    const snapshot = cbModule.getJobCircuitBreakerSnapshot();
    expect(Array.isArray(snapshot)).toBe(true);
    const entry = snapshot.find((s) => s.jobName === "snap-job");
    expect(entry).toBeDefined();
    expect(entry?.paused).toBe(false);
    expect(entry?.pausedUntil).toBeNull();
  });

  it("snapshot shows paused=true for open circuit", () => {
    const jobName = "snap-open";
    const err = new Error("eai_again");
    cbModule.recordJobFailure(jobName, err);
    cbModule.recordJobFailure(jobName, err);
    cbModule.recordJobFailure(jobName, err);

    const snapshot = cbModule.getJobCircuitBreakerSnapshot();
    const entry = snapshot.find((s) => s.jobName === jobName);
    expect(entry?.paused).toBe(true);
    expect(entry?.pausedUntil).not.toBeNull();
  });
});
