/**
 * slow-query-logger 單元測試
 *
 * 測試範圍：
 * - setupSlowQueryLogger：singleton guard、$extends 不支援回退
 * - 查詢 extension handler：記錄時長、慢查詢記錄、節流、model 未定義、ignore list
 * - SLOW_QUERY_TOP_N 聚合模式
 */

// 在 describe 最外層宣告可重新賦值的 mock 引用
let warnMock: jest.Mock;
let debugMock: jest.Mock;
let infoMock: jest.Mock;
let errorMock: jest.Mock;
let recordQueryDurationMock: jest.Mock;

// 建立一個 mock Prisma，可選擇性地包含 $extends
function makeMockPrisma(supportsExtend = true) {
  const prisma: Record<string, unknown> = {};
  if (supportsExtend) {
    prisma.$extends = jest.fn().mockReturnValue(prisma); // returns self for simplicity
  }
  return prisma;
}

// 從 $extends 呼叫中提取 query handler
function extractQueryHandler(prisma: Record<string, unknown>) {
  const extendMock = prisma.$extends as jest.Mock;
  const extension = extendMock.mock.calls[0][0] as {
    query: {
      $allModels: {
        $allOperations: (opts: {
          model: string | undefined;
          operation: string;
          args: unknown;
          query: (args: unknown) => Promise<unknown>;
        }) => Promise<unknown>;
      };
    };
  };
  return extension.query.$allModels.$allOperations.bind(extension.query.$allModels);
}

// 使用 Date.now spy 執行查詢 handler，回傳對應時長
// Note: model must be passed explicitly (no default) to allow null/undefined testing
async function callHandlerWithDuration(
  handler: (opts: {
    model: string | undefined;
    operation: string;
    args: unknown;
    query: (args: unknown) => Promise<unknown>;
  }) => Promise<unknown>,
  durationMs: number,
  model: string | undefined,
  operation = "findMany"
) {
  let call = 0;
  const dateSpy = jest.spyOn(Date, "now").mockImplementation(() => {
    // First call → before, second call → before + durationMs
    return call++ === 0 ? 0 : durationMs;
  });

  try {
    const fakeQuery = jest.fn().mockResolvedValue("result");
    const result = await handler({ model, operation, args: {}, query: fakeQuery });
    return result;
  } finally {
    dateSpy.mockRestore();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 每個 describe 使用獨立模組實例
// ─────────────────────────────────────────────────────────────────────────────

describe("setupSlowQueryLogger – $extends not supported", () => {
  let setupSlowQueryLogger: (prisma: unknown, thresholdMs?: number) => unknown;

  beforeAll(async () => {
    jest.resetModules();
    jest.doMock("../../utils/logger", () => {
      warnMock = jest.fn();
      infoMock = jest.fn();
      debugMock = jest.fn();
      errorMock = jest.fn();
      return { logger: { warn: warnMock, info: infoMock, debug: debugMock, error: errorMock } };
    });
    jest.doMock("../query-metrics", () => {
      recordQueryDurationMock = jest.fn();
      return { recordQueryDuration: recordQueryDurationMock };
    });
    const mod: any = await import("../slow-query-logger");
    setupSlowQueryLogger = mod.setupSlowQueryLogger;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (global as Record<string, unknown>).slowQueryLoggerInitialized = undefined;
  });

  it("should return prisma unchanged and log warning when $extends is missing", () => {
    const prisma = makeMockPrisma(false);
    const result = setupSlowQueryLogger(prisma, 1000);
    expect(result).toBe(prisma);
    expect(warnMock).toHaveBeenCalledWith(
      "SlowQuery",
      "Prisma extension not supported in this runtime"
    );
  });
});

describe("setupSlowQueryLogger – singleton guard", () => {
  let setupSlowQueryLogger: (prisma: unknown, thresholdMs?: number) => unknown;

  beforeAll(async () => {
    jest.resetModules();
    jest.doMock("../../utils/logger", () => ({
      logger: { warn: jest.fn(), info: jest.fn(), debug: jest.fn(), error: jest.fn() },
    }));
    jest.doMock("../query-metrics", () => ({ recordQueryDuration: jest.fn() }));
    const mod: any = await import("../slow-query-logger");
    setupSlowQueryLogger = mod.setupSlowQueryLogger;
  });

  beforeEach(() => {
    (global as Record<string, unknown>).slowQueryLoggerInitialized = undefined;
  });

  it("should call $extends only once even if setupSlowQueryLogger is called twice", () => {
    const prisma = makeMockPrisma(true);
    setupSlowQueryLogger(prisma, 1000);
    const resultSecond = setupSlowQueryLogger(prisma, 1000);
    expect((prisma.$extends as jest.Mock)).toHaveBeenCalledTimes(1);
    // Second call returns prisma directly
    expect(resultSecond).toBe(prisma);
  });
});

describe("query extension handler – core behaviour", () => {
  let handler: (opts: {
    model: string | undefined;
    operation: string;
    args: unknown;
    query: (args: unknown) => Promise<unknown>;
  }) => Promise<unknown>;
  let localRecordDuration: jest.Mock;
  let localWarn: jest.Mock;

  beforeAll(async () => {
    jest.resetModules();
    localWarn = jest.fn();
    localRecordDuration = jest.fn();
    jest.doMock("../../utils/logger", () => ({
      logger: { warn: localWarn, info: jest.fn(), debug: jest.fn(), error: jest.fn() },
    }));
    jest.doMock("../query-metrics", () => ({ recordQueryDuration: localRecordDuration }));
    (global as Record<string, unknown>).slowQueryLoggerInitialized = undefined;

    const { setupSlowQueryLogger } = await import("../slow-query-logger") as any;
    const prisma = makeMockPrisma(true);
    setupSlowQueryLogger(prisma, 100); // threshold: 100ms
    handler = extractQueryHandler(prisma);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should call recordQueryDuration for every query", async () => {
    await callHandlerWithDuration(handler, 50, "User");
    expect(localRecordDuration).toHaveBeenCalledTimes(1);
    expect(localRecordDuration).toHaveBeenCalledWith(50);
  });

  it("should NOT log slow query when duration is below threshold", async () => {
    await callHandlerWithDuration(handler, 50, "User"); // 50ms < 100ms threshold
    const slowLogs = localWarn.mock.calls.filter(
      (c) => c[0] === "SlowQuery" && String(c[1]).includes("took")
    );
    expect(slowLogs).toHaveLength(0);
  });

  it("should log slow query when duration exceeds threshold", async () => {
    await callHandlerWithDuration(handler, 200, "Channel", "findMany"); // 200ms > 100ms
    const slowLogs = localWarn.mock.calls.filter(
      (c) => c[0] === "SlowQuery" && String(c[1]).includes("took")
    );
    expect(slowLogs).toHaveLength(1);
    expect(localWarn).toHaveBeenCalledWith(
      "SlowQuery",
      expect.stringContaining("took 200ms"),
      expect.objectContaining({ model: "Channel", action: "findMany", duration: 200 })
    );
  });

  it("should handle undefined model (raw queries) and use 'Raw' prefix", async () => {
    // Use a fresh Date.now reference to ensure consistent timing
    await callHandlerWithDuration(handler, 300, undefined, "$queryRaw"); // above threshold (100ms)
    // At least one warn call should reference "Raw."
    const allSlowLogs = localWarn.mock.calls.filter(
      (c) => c[0] === "SlowQuery" && typeof c[1] === "string"
    );
    // Show all calls for debugging if assertion fails
    expect(allSlowLogs.map((c) => c[1])).toContainEqual(expect.stringContaining("Raw."));
  });

  it("should return the query result", async () => {
    const fakeQuery = jest.fn().mockResolvedValue("my-result");
    let call = 0;
    const dateSpy = jest.spyOn(Date, "now").mockImplementation(() => (call++ === 0 ? 0 : 50));
    try {
      const result = await handler({ model: "Post", operation: "findFirst", args: {}, query: fakeQuery });
      expect(result).toBe("my-result");
    } finally {
      dateSpy.mockRestore();
    }
  });
});

describe("query extension handler – throttle behavior", () => {
  let handler: (opts: {
    model: string | undefined;
    operation: string;
    args: unknown;
    query: (args: unknown) => Promise<unknown>;
  }) => Promise<unknown>;
  let localWarn: jest.Mock;

  beforeAll(async () => {
    jest.resetModules();
    localWarn = jest.fn();
    jest.doMock("../../utils/logger", () => ({
      logger: { warn: localWarn, info: jest.fn(), debug: jest.fn(), error: jest.fn() },
    }));
    jest.doMock("../query-metrics", () => ({ recordQueryDuration: jest.fn() }));
    process.env.SLOW_QUERY_LOG_THROTTLE_MS = "60000"; // 1 min throttle
    (global as Record<string, unknown>).slowQueryLoggerInitialized = undefined;

    const { setupSlowQueryLogger } = await import("../slow-query-logger") as any;
    const prisma = makeMockPrisma(true);
    setupSlowQueryLogger(prisma, 100); // threshold: 100ms
    handler = extractQueryHandler(prisma);
  });

  afterAll(() => {
    delete process.env.SLOW_QUERY_LOG_THROTTLE_MS;
  });

  it("should log first slow query, then throttle subsequent ones", async () => {
    // First call: should log
    await callHandlerWithDuration(handler, 200, "Stream", "findMany");
    const firstCount = localWarn.mock.calls.filter(
      (c) => c[0] === "SlowQuery" && String(c[1]).includes("took")
    ).length;
    expect(firstCount).toBe(1);

    // Second call immediately: should be suppressed (within throttle window)
    localWarn.mockClear();
    await callHandlerWithDuration(handler, 200, "Stream", "findMany");
    const secondCount = localWarn.mock.calls.filter(
      (c) => c[0] === "SlowQuery" && String(c[1]).includes("took")
    ).length;
    expect(secondCount).toBe(0);
  });
});

describe("SLOW_QUERY_LOG_IGNORE env variable", () => {
  let handler: (opts: {
    model: string | undefined;
    operation: string;
    args: unknown;
    query: (args: unknown) => Promise<unknown>;
  }) => Promise<unknown>;
  let localWarn: jest.Mock;

  beforeAll(async () => {
    jest.resetModules();
    localWarn = jest.fn();
    jest.doMock("../../utils/logger", () => ({
      logger: { warn: localWarn, info: jest.fn(), debug: jest.fn(), error: jest.fn() },
    }));
    jest.doMock("../query-metrics", () => ({ recordQueryDuration: jest.fn() }));
    process.env.SLOW_QUERY_LOG_IGNORE = "User.findMany,Post.findFirst";
    (global as Record<string, unknown>).slowQueryLoggerInitialized = undefined;

    const { setupSlowQueryLogger } = await import("../slow-query-logger") as any;
    const prisma = makeMockPrisma(true);
    setupSlowQueryLogger(prisma, 10); // very low threshold
    handler = extractQueryHandler(prisma);
  });

  afterAll(() => {
    delete process.env.SLOW_QUERY_LOG_IGNORE;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should not log slow query for ignored model.operation", async () => {
    await callHandlerWithDuration(handler, 500, "User", "findMany"); // above threshold but ignored
    const slowLogs = localWarn.mock.calls.filter(
      (c) => c[0] === "SlowQuery" && String(c[1]).includes("took")
    );
    expect(slowLogs).toHaveLength(0);
  });

  it("should still log non-ignored queries", async () => {
    await callHandlerWithDuration(handler, 500, "Channel", "findMany"); // not in ignore list
    const slowLogs = localWarn.mock.calls.filter(
      (c) => c[0] === "SlowQuery" && String(c[1]).includes("took")
    );
    expect(slowLogs).toHaveLength(1);
  });
});

describe("SLOW_QUERY_TOP_N aggregation mode", () => {
  let handler: (opts: {
    model: string | undefined;
    operation: string;
    args: unknown;
    query: (args: unknown) => Promise<unknown>;
  }) => Promise<unknown>;
  let localWarn: jest.Mock;

  beforeAll(async () => {
    jest.resetModules();
    localWarn = jest.fn();
    jest.doMock("../../utils/logger", () => ({
      logger: { warn: localWarn, info: jest.fn(), debug: jest.fn(), error: jest.fn() },
    }));
    jest.doMock("../query-metrics", () => ({ recordQueryDuration: jest.fn() }));
    process.env.SLOW_QUERY_TOP_N = "3";
    process.env.SLOW_QUERY_TOP_N_WINDOW_MS = "500";
    (global as Record<string, unknown>).slowQueryLoggerInitialized = undefined;

    jest.useFakeTimers();
    const { setupSlowQueryLogger } = await import("../slow-query-logger") as any;
    const prisma = makeMockPrisma(true);
    setupSlowQueryLogger(prisma, 10); // low threshold
    handler = extractQueryHandler(prisma);
  });

  afterAll(() => {
    delete process.env.SLOW_QUERY_TOP_N;
    delete process.env.SLOW_QUERY_TOP_N_WINDOW_MS;
    jest.useRealTimers();
  });

  it("should NOT log individual slow query when SLOW_QUERY_TOP_N > 0", async () => {
    await callHandlerWithDuration(handler, 200, "Viewer", "findMany");
    const individualLogs = localWarn.mock.calls.filter(
      (c) => c[0] === "SlowQuery" && String(c[1]).includes("took")
    );
    expect(individualLogs).toHaveLength(0);
  });

  it("should flush top-N aggregated queries after window timer fires", async () => {
    // Record a slow query to populate aggregates
    await callHandlerWithDuration(handler, 200, "Stream", "count");

    // intervalMs = Math.max(1000, SLOW_QUERY_TOP_N_WINDOW_MS) = Math.max(1000, 500) = 1000
    // Advance past 1000ms flush interval
    jest.advanceTimersByTime(1100);

    const topNLogs = localWarn.mock.calls.filter(
      (c) => c[0] === "SlowQuery" && String(c[1]).includes("Top")
    );
    expect(topNLogs.length).toBeGreaterThanOrEqual(1);
  });
});
