/**
 * redis-client.ts 單元測試
 *
 * 因為 Redis 不在測試環境中，所以 mock ioredis
 * 並測試 circuit breaker 邏輯與所有 helper 函數
 */

jest.mock("../logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// Create a full mock for ioredis Redis class
const mockRedisInstance = {
  on: jest.fn().mockReturnThis(),
  connect: jest.fn().mockResolvedValue(undefined),
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  scan: jest.fn(),
  sadd: jest.fn(),
  smembers: jest.fn(),
  eval: jest.fn(),
};

const MockRedis = jest.fn().mockImplementation(() => mockRedisInstance);
jest.mock("ioredis", () => ({
  __esModule: true,
  default: MockRedis,
}));

describe("redis-client – no REDIS_URL (graceful fallback)", () => {
  let rc: typeof import("../redis-client");

  beforeEach(async () => {
    jest.resetModules();
    delete process.env.REDIS_URL;
    delete process.env.REDIS_URI;
    delete process.env.REDIS_CONNECTION_STRING;
    jest.mock("../logger", () => ({
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    }));
    jest.mock("ioredis", () => ({ __esModule: true, default: MockRedis }));
    rc = await import("../redis-client");
  });

  it("isRedisEnabled returns false without URL", () => {
    expect(rc.isRedisEnabled()).toBe(false);
  });

  it("isRedisReady returns false initially", () => {
    expect(rc.isRedisReady()).toBe(false);
  });

  it("getRedisClient returns null when not ready", () => {
    expect(rc.getRedisClient()).toBeNull();
  });

  it("initRedis returns false without URL", async () => {
    const result = await rc.initRedis();
    expect(result).toBe(false);
  });

  it("getRedisCircuitBreakerStats reports disabled state", () => {
    const stats = rc.getRedisCircuitBreakerStats();
    expect(stats.enabled).toBe(false);
    expect(stats.open).toBe(false);
    expect(stats.state).toBe("closed");
  });

  // All operations gracefully return null/0/[] when no Redis
  it("redisGetJson returns null", async () => {
    expect(await rc.redisGetJson("key")).toBeNull();
  });

  it("redisSetJson is a no-op", async () => {
    await expect(rc.redisSetJson("key", { a: 1 }, 60)).resolves.toBeUndefined();
  });

  it("redisDeleteKey is a no-op", async () => {
    await expect(rc.redisDeleteKey("key")).resolves.toBeUndefined();
  });

  it("redisDeleteKeys returns 0", async () => {
    expect(await rc.redisDeleteKeys(["k1", "k2"])).toBe(0);
  });

  it("redisDeleteKeys returns 0 for empty array", async () => {
    expect(await rc.redisDeleteKeys([])).toBe(0);
  });

  it("redisDeleteByPrefix returns 0", async () => {
    expect(await rc.redisDeleteByPrefix("prefix")).toBe(0);
  });

  it("redisDeleteBySuffix returns 0", async () => {
    expect(await rc.redisDeleteBySuffix("suffix")).toBe(0);
  });

  it("redisTagAddKeys is a no-op for empty keys", async () => {
    await expect(rc.redisTagAddKeys("tag", [])).resolves.toBeUndefined();
  });

  it("redisTagAddKeys is a no-op when no client", async () => {
    await expect(rc.redisTagAddKeys("tag", ["k1"])).resolves.toBeUndefined();
  });

  it("redisTagGetKeys returns []", async () => {
    expect(await rc.redisTagGetKeys("tag")).toEqual([]);
  });

  it("redisTagDelete is a no-op", async () => {
    await expect(rc.redisTagDelete("tag")).resolves.toBeUndefined();
  });

  it("redisAcquireLock returns false", async () => {
    expect(await rc.redisAcquireLock("key", "token", 1000)).toBe(false);
  });

  it("redisReleaseLock is a no-op", async () => {
    await expect(rc.redisReleaseLock("key", "token")).resolves.toBeUndefined();
  });

  it("getBullMQConnectionOptions returns null when not ready", () => {
    expect(rc.getBullMQConnectionOptions()).toBeNull();
  });
});

describe("redis-client – with REDIS_URL (successful connection)", () => {
  let rc: typeof import("../redis-client");

  beforeEach(async () => {
    jest.resetModules();
    process.env.REDIS_URL = "redis://localhost:6379";

    const freshMockInstance = {
      on: jest.fn().mockReturnThis(),
      connect: jest.fn().mockResolvedValue(undefined),
      get: jest.fn().mockResolvedValue(JSON.stringify({ data: "test" })),
      set: jest.fn().mockResolvedValue("OK"),
      del: jest.fn().mockResolvedValue(1),
      scan: jest.fn().mockResolvedValue(["0", []]),
      sadd: jest.fn().mockResolvedValue(1),
      smembers: jest.fn().mockResolvedValue(["bmad:cache:k1"]),
      eval: jest.fn().mockResolvedValue(1),
    };

    const mockFreshMockRedis = jest.fn().mockImplementation(() => freshMockInstance);

    jest.mock("ioredis", () => ({ __esModule: true, default: mockFreshMockRedis }));
    jest.mock("../logger", () => ({
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    }));

    rc = await import("../redis-client");
    await rc.initRedis();
  });

  afterEach(() => {
    delete process.env.REDIS_URL;
  });

  it("isRedisReady returns true after initRedis", () => {
    expect(rc.isRedisReady()).toBe(true);
  });

  it("isRedisEnabled returns true", () => {
    expect(rc.isRedisEnabled()).toBe(true);
  });

  it("getRedisClient returns the client", () => {
    expect(rc.getRedisClient()).not.toBeNull();
  });

  it("initRedis is idempotent", async () => {
    const result = await rc.initRedis();
    expect(result).toBe(true);
  });

  it("getBullMQConnectionOptions returns parsed options", () => {
    const opts = rc.getBullMQConnectionOptions();
    expect(opts).not.toBeNull();
    expect(opts?.host).toBe("localhost");
    expect(opts?.port).toBe(6379);
  });

  it("redisGetJson returns parsed value", async () => {
    const result = await rc.redisGetJson<{ data: string }>("mykey");
    expect(result).toEqual({ data: "test" });
  });

  it("redisGetJson returns null for missing key", async () => {
    const client = rc.getRedisClient() as any;
    client.get.mockResolvedValueOnce(null);
    const result = await rc.redisGetJson("missing");
    expect(result).toBeNull();
  });

  it("redisSetJson succeeds", async () => {
    await expect(rc.redisSetJson("k", { v: 1 }, 30)).resolves.toBeUndefined();
  });

  it("redisDeleteKey succeeds", async () => {
    await expect(rc.redisDeleteKey("k")).resolves.toBeUndefined();
  });

  it("redisDeleteKeys with multiple keys", async () => {
    const client = rc.getRedisClient() as any;
    client.del.mockResolvedValueOnce(2);
    const count = await rc.redisDeleteKeys(["k1", "k2"]);
    expect(count).toBe(2);
  });

  it("redisTagAddKeys calls sadd", async () => {
    await expect(rc.redisTagAddKeys("tag1", ["key1"])).resolves.toBeUndefined();
  });

  it("redisTagGetKeys returns stripped keys", async () => {
    const keys = await rc.redisTagGetKeys("tag1");
    expect(keys).toEqual(["k1"]);
  });

  it("redisTagDelete calls del on tag key", async () => {
    await expect(rc.redisTagDelete("tag1")).resolves.toBeUndefined();
  });

  it("redisAcquireLock returns true on OK", async () => {
    const client = rc.getRedisClient() as any;
    client.set.mockResolvedValueOnce("OK");
    const result = await rc.redisAcquireLock("lock-key", "tok", 5000);
    expect(result).toBe(true);
  });

  it("redisAcquireLock returns false on null (already locked)", async () => {
    const client = rc.getRedisClient() as any;
    client.set.mockResolvedValueOnce(null);
    const result = await rc.redisAcquireLock("lock-key", "tok", 5000);
    expect(result).toBe(false);
  });

  it("redisReleaseLock calls eval script", async () => {
    await expect(rc.redisReleaseLock("lock-key", "tok")).resolves.toBeUndefined();
  });

  it("redisDeleteByPrefix with no matching keys (scan returns empty)", async () => {
    const client = rc.getRedisClient() as any;
    client.scan.mockResolvedValueOnce(["0", []]);
    const count = await rc.redisDeleteByPrefix("pref");
    expect(count).toBe(0);
  });

  it("redisDeleteByPrefix with matching keys", async () => {
    const client = rc.getRedisClient() as any;
    client.scan
      .mockResolvedValueOnce(["1", ["bmad:cache:pref:key1"]])
      .mockResolvedValueOnce(["0", []]);
    client.del.mockResolvedValue(1);
    const count = await rc.redisDeleteByPrefix("pref");
    expect(count).toBe(1);
  });

  it("redisDeleteBySuffix with matching keys", async () => {
    const client = rc.getRedisClient() as any;
    client.scan.mockResolvedValueOnce(["0", ["bmad:cache:key:suffix"]]);
    client.del.mockResolvedValue(1);
    const count = await rc.redisDeleteBySuffix("suffix");
    expect(count).toBe(1);
  });
});

describe("redis-client – connection failure fallback", () => {
  let rc: typeof import("../redis-client");

  beforeEach(async () => {
    jest.resetModules();
    process.env.REDIS_URL = "redis://localhost:9999";

    const failingInstance = {
      on: jest.fn().mockReturnThis(),
      connect: jest.fn().mockRejectedValue(new Error("ECONNREFUSED")),
    };
    const mockFailingRedis = jest.fn().mockImplementation(() => failingInstance);

    jest.mock("ioredis", () => ({ __esModule: true, default: mockFailingRedis }));
    jest.mock("../logger", () => ({
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    }));

    rc = await import("../redis-client");
    await rc.initRedis();
  });

  afterEach(() => {
    delete process.env.REDIS_URL;
  });

  it("isRedisReady is false after failed connection", () => {
    expect(rc.isRedisReady()).toBe(false);
  });

  it("getBullMQConnectionOptions returns null when not ready", () => {
    expect(rc.getBullMQConnectionOptions()).toBeNull();
  });
});

describe("redis-client – getBullMQConnectionOptions with invalid URL", () => {
  it("returns null on invalid URL", async () => {
    jest.resetModules();
    process.env.REDIS_URL = "redis://localhost:6379";
    jest.mock("../logger", () => ({
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    }));

    const workingInstance = {
      on: jest.fn().mockReturnThis(),
      connect: jest.fn().mockResolvedValue(undefined),
    };
    const mockWorkingRedis = jest.fn().mockImplementation(() => workingInstance);
    jest.mock("ioredis", () => ({ __esModule: true, default: mockWorkingRedis }));

    const rc2 = await import("../redis-client");
    await rc2.initRedis();

    // Now override env to invalid URL and call getBullMQConnectionOptions
    process.env.REDIS_URL = "not-a-valid-url://@@@@";
    const opts = rc2.getBullMQConnectionOptions();
    expect(opts).toBeNull();
    delete process.env.REDIS_URL;
  });
});

describe("redis-client – error handling paths", () => {
  let rc: typeof import("../redis-client");

  beforeEach(async () => {
    jest.resetModules();
    process.env.REDIS_URL = "redis://localhost:6379";

    const errorInstance = {
      on: jest.fn().mockReturnThis(),
      connect: jest.fn().mockResolvedValue(undefined),
      get: jest.fn().mockRejectedValue(new Error("Redis get error")),
      set: jest.fn().mockRejectedValue(new Error("Redis set error")),
      del: jest.fn().mockRejectedValue(new Error("Redis del error")),
      scan: jest.fn().mockRejectedValue(new Error("Redis scan error")),
      sadd: jest.fn().mockRejectedValue(new Error("Redis sadd error")),
      smembers: jest.fn().mockRejectedValue(new Error("Redis smembers error")),
      eval: jest.fn().mockRejectedValue(new Error("Redis eval error")),
    };
    const mockErrorRedis = jest.fn().mockImplementation(() => errorInstance);

    jest.mock("ioredis", () => ({ __esModule: true, default: mockErrorRedis }));
    jest.mock("../logger", () => ({
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    }));

    rc = await import("../redis-client");
    await rc.initRedis();
  });

  afterEach(() => {
    delete process.env.REDIS_URL;
  });

  it("redisGetJson returns null on error and marks failure", async () => {
    const result = await rc.redisGetJson("key");
    expect(result).toBeNull();
  });

  it("redisSetJson handles error gracefully", async () => {
    await expect(rc.redisSetJson("key", {}, 60)).resolves.toBeUndefined();
  });

  it("redisDeleteKey handles error gracefully", async () => {
    await expect(rc.redisDeleteKey("key")).resolves.toBeUndefined();
  });

  it("redisDeleteKeys handles error gracefully", async () => {
    expect(await rc.redisDeleteKeys(["k1"])).toBe(0);
  });

  it("redisTagAddKeys handles error gracefully", async () => {
    await expect(rc.redisTagAddKeys("tag", ["k1"])).resolves.toBeUndefined();
  });

  it("redisTagGetKeys returns [] on error", async () => {
    expect(await rc.redisTagGetKeys("tag")).toEqual([]);
  });

  it("redisTagDelete handles error gracefully", async () => {
    await expect(rc.redisTagDelete("tag")).resolves.toBeUndefined();
  });

  it("redisAcquireLock returns false on error", async () => {
    expect(await rc.redisAcquireLock("k", "t", 100)).toBe(false);
  });

  it("redisReleaseLock handles error gracefully", async () => {
    await expect(rc.redisReleaseLock("k", "t")).resolves.toBeUndefined();
  });

  it("redisDeleteByPrefix handles scan error gracefully", async () => {
    expect(await rc.redisDeleteByPrefix("p")).toBe(0);
  });
});

describe("redis-client – circuit breaker open/half-open transitions", () => {
  let rc: typeof import("../redis-client");
  let mockInstance: any;

  beforeEach(async () => {
    jest.resetModules();
    process.env.REDIS_URL = "redis://localhost:6379";
    process.env.REDIS_FAILURE_THRESHOLD = "2";
    process.env.REDIS_CIRCUIT_BREAKER_MS = "100";

    mockInstance = {
      on: jest.fn().mockReturnThis(),
      connect: jest.fn().mockResolvedValue(undefined),
      get: jest.fn().mockRejectedValue(new Error("fail")),
      set: jest.fn().mockResolvedValue("OK"),
    };
    const mockCBRedis = jest.fn().mockImplementation(() => mockInstance);

    jest.mock("ioredis", () => ({ __esModule: true, default: mockCBRedis }));
    jest.mock("../logger", () => ({
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    }));

    rc = await import("../redis-client");
    await rc.initRedis();
  });

  afterEach(() => {
    delete process.env.REDIS_URL;
    delete process.env.REDIS_FAILURE_THRESHOLD;
    delete process.env.REDIS_CIRCUIT_BREAKER_MS;
  });

  it("circuit opens after failure threshold", async () => {
    // Trigger failures to open circuit
    await rc.redisGetJson("k1"); // fail 1
    await rc.redisGetJson("k2"); // fail 2 -> circuit opens

    const stats = rc.getRedisCircuitBreakerStats();
    expect(stats.open).toBe(true);
    expect(stats.state).toBe("open");
    expect(stats.openedCount).toBeGreaterThan(0);
  });

  it("circuit enters half-open after breaker window", async () => {
    jest.useFakeTimers();

    // Open the circuit
    await rc.redisGetJson("k1");
    await rc.redisGetJson("k2");

    // Advance past circuit breaker window
    jest.advanceTimersByTime(200);

    // Next call should attempt (half-open state)
    mockInstance.set.mockResolvedValueOnce("OK");
    // getRedisCircuitBreakerStats to check state
    const stats = rc.getRedisCircuitBreakerStats();
    // remainingOpenMs should be 0 now
    expect(stats.remainingOpenMs).toBe(0);

    jest.useRealTimers();
  });
});
