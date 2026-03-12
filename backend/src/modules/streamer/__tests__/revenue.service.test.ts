jest.mock("../../../db/prisma", () => ({
  prisma: {
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
    streamer: {
      findUnique: jest.fn(),
    },
    subscriptionSnapshot: {
      findFirst: jest.fn(),
      upsert: jest.fn(),
    },
    cheerEvent: {
      groupBy: jest.fn(),
    },
    twitchToken: {
      update: jest.fn(),
    },
  },
}));

jest.mock("../../../utils/dynamic-import", () => ({
  importTwurpleApi: jest.fn(),
  importTwurpleAuth: jest.fn(),
}));

jest.mock("../../../utils/crypto.utils", () => ({
  decryptToken: jest.fn((v: string) => `dec:${v}`),
  encryptToken: jest.fn((v: string) => `enc:${v}`),
}));

jest.mock("../../../utils/cache-manager", () => ({
  cacheManager: {
    getOrSetWithTags: jest.fn(),
    set: jest.fn(),
    get: jest.fn(),
  },
  CacheKeys: {
    revenueSubscriptions: jest.fn((streamerId: string, days: number) =>
      `revenue:subscriptions:${streamerId}:${days}`
    ),
    revenueBits: jest.fn((streamerId: string, days: number) => `revenue:bits:${streamerId}:${days}`),
    revenueOverview: jest.fn((streamerId: string) => `revenue:overview:${streamerId}`),
  },
  CacheTTL: {
    SHORT: 60,
    MEDIUM: 300,
  },
}));

jest.mock("../../../utils/logger", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import { prisma } from "../../../db/prisma";
import { cacheManager } from "../../../utils/cache-manager";
import { logger } from "../../../utils/logger";
import { decryptToken, encryptToken } from "../../../utils/crypto.utils";
import { importTwurpleApi, importTwurpleAuth } from "../../../utils/dynamic-import";
import { RevenueService } from "../revenue.service";

describe("RevenueService", () => {
  let service: RevenueService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new RevenueService();
    (cacheManager.getOrSetWithTags as jest.Mock).mockImplementation(
      async (_key: string, resolver: () => Promise<unknown>) => resolver()
    );
  });

  afterEach(() => {
    const timer = (service as any).twurpleCleanupTimer;
    if (timer) {
      clearInterval(timer);
      (service as any).twurpleCleanupTimer = null;
    }
  });

  it("getSubscriptionStats validates streamerId", async () => {
    await expect(service.getSubscriptionStats("", 30)).rejects.toThrow("Invalid streamerId");
  });

  it("getSubscriptionStats validates days range", async () => {
    await expect(service.getSubscriptionStats("streamer-1", 0)).rejects.toThrow(
      "Days must be between"
    );
  });

  it("getSubscriptionStats maps snapshot rows", async () => {
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([
      {
        snapshotDate: "2025-01-01T00:00:00.000Z",
        tier1Count: 3,
        tier2Count: 1,
        tier3Count: 0,
        totalSubscribers: 4,
        estimatedRevenue: null,
      },
    ]);

    const data = await service.getSubscriptionStats("streamer-1", 30);

    expect(data).toEqual([
      {
        date: "2025-01-01",
        tier1Count: 3,
        tier2Count: 1,
        tier3Count: 0,
        totalSubscribers: 4,
        estimatedRevenue: 0,
      },
    ]);
  });

  it("getSubscriptionStats returns [] on DB timeout", async () => {
    jest
      .spyOn(service as any, "withQueryTimeout")
      .mockRejectedValueOnce(new Error("DB_QUERY_TIMEOUT"));

    const data = await service.getSubscriptionStats("streamer-1", 30);

    expect(data).toEqual([]);
    expect(logger.error).toHaveBeenCalledWith(
      "RevenueService",
      expect.stringContaining("getSubscriptionStats query timeout")
    );
  });

  it("getBitsStats validates inputs", async () => {
    await expect(service.getBitsStats("", 30)).rejects.toThrow("Invalid streamerId");
    await expect(service.getBitsStats("streamer-1", 400)).rejects.toThrow("Days must be between");
  });

  it("getBitsStats maps aggregate rows with Date and string", async () => {
    jest.spyOn(service as any, "ensureBitsDailyAggFresh").mockResolvedValue(undefined);
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([
      { date: new Date("2025-01-01T00:00:00.000Z"), totalBits: BigInt(100), eventCount: BigInt(2) },
      { date: "2025-01-02", totalBits: 50, eventCount: 1 },
    ]);

    const data = await service.getBitsStats("streamer-1", 30);

    expect(data).toEqual([
      { date: "2025-01-01", totalBits: 100, estimatedRevenue: 1, eventCount: 2 },
      { date: "2025-01-02", totalBits: 50, estimatedRevenue: 0.5, eventCount: 1 },
    ]);
  });

  it("getBitsStats returns [] on DB timeout", async () => {
    jest.spyOn(service as any, "ensureBitsDailyAggFresh").mockResolvedValue(undefined);
    jest
      .spyOn(service as any, "withQueryTimeout")
      .mockRejectedValueOnce(new Error("DB_QUERY_TIMEOUT"));

    const data = await service.getBitsStats("streamer-1", 30);

    expect(data).toEqual([]);
    expect(logger.error).toHaveBeenCalledWith(
      "RevenueService",
      expect.stringContaining("getBitsStats query timeout")
    );
  });

  it("getRevenueOverview returns computed payload and writes stale cache", async () => {
    jest.spyOn(service as any, "ensureBitsDailyAggFresh").mockResolvedValue(undefined);
    (prisma.subscriptionSnapshot.findFirst as jest.Mock).mockResolvedValue({
      totalSubscribers: 10,
      estimatedRevenue: 25,
      tier1Count: 8,
      tier2Count: 2,
      tier3Count: 0,
    });
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ totalBits: BigInt(300), eventCount: BigInt(3) }]);

    const data = await service.getRevenueOverview("streamer-1");

    expect(data).toEqual({
      subscriptions: {
        current: 10,
        estimatedMonthlyRevenue: 25,
        tier1: 8,
        tier2: 2,
        tier3: 0,
      },
      bits: {
        totalBits: 300,
        estimatedRevenue: 3,
        eventCount: 3,
      },
      totalEstimatedRevenue: 28,
    });
    expect(cacheManager.set).toHaveBeenCalled();
  });

  it("getRevenueOverview returns stale cache on timeout", async () => {
    jest.spyOn(service as any, "ensureBitsDailyAggFresh").mockResolvedValue(undefined);
    jest
      .spyOn(service as any, "withQueryTimeout")
      .mockRejectedValueOnce(new Error("DB_QUERY_TIMEOUT"));
    (cacheManager.get as jest.Mock).mockReturnValue({
      subscriptions: {
        current: 1,
        estimatedMonthlyRevenue: 2,
        tier1: 1,
        tier2: 0,
        tier3: 0,
      },
      bits: { totalBits: 10, estimatedRevenue: 0.1, eventCount: 1 },
      totalEstimatedRevenue: 2.1,
    });

    const data = await service.getRevenueOverview("streamer-1");

    expect(data).toEqual(
      expect.objectContaining({
        subscriptions: expect.objectContaining({ current: 1 }),
      })
    );
  });

  it("getTopSupporters validates limit and maps null names", async () => {
    await expect(service.getTopSupporters("streamer-1", 0)).rejects.toThrow("Limit must be between");

    (prisma.cheerEvent.groupBy as jest.Mock).mockResolvedValue([
      { userName: null, _sum: { bits: null }, _count: 2 },
    ]);

    const rows = await service.getTopSupporters("streamer-1", 10);

    expect(rows).toEqual([{ userName: "Unknown", totalBits: 0, eventCount: 2 }]);
  });

  it("withQueryTimeout returns operation result", async () => {
    const result = await (service as any).withQueryTimeout(async () => "ok", 10);
    expect(result).toBe("ok");
  });

  it("withQueryTimeout rejects on timeout", async () => {
    jest.useFakeTimers();
    const pending = (service as any).withQueryTimeout(() => new Promise(() => {}), 5);
    jest.advanceTimersByTime(10);
    await expect(pending).rejects.toThrow("DB_QUERY_TIMEOUT");
    jest.useRealTimers();
  });

  it("runBitsDailyAggWithRetry retries and succeeds", async () => {
    const op = jest
      .fn()
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce(undefined);
    jest.spyOn(service as any, "sleep").mockResolvedValue(undefined);

    await (service as any).runBitsDailyAggWithRetry("agg", op);

    expect(op).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      "RevenueService",
      expect.stringContaining("retrying in"),
      expect.any(Error)
    );
  });

  it("runBitsDailyAggWithRetry throws after max retries", async () => {
    const op = jest.fn().mockRejectedValue(new Error("still failing"));
    jest.spyOn(service as any, "sleep").mockResolvedValue(undefined);

    await expect((service as any).runBitsDailyAggWithRetry("agg", op)).rejects.toThrow(
      "still failing"
    );
  });

  it("ensureBitsDailyAggFresh bootstraps when no agg data exists", async () => {
    (cacheManager.getOrSetWithTags as jest.Mock).mockImplementation(
      async (_key: string, resolver: () => Promise<unknown>) => resolver()
    );
    jest
      .spyOn(service as any, "hasBitsDailyAggData")
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const refreshSpy = jest.spyOn(service as any, "refreshBitsDailyAgg").mockResolvedValue(undefined);

    await (service as any).ensureBitsDailyAggFresh("streamer-1", "2025-01-01");

    expect(refreshSpy).toHaveBeenCalledTimes(2);
  });

  it("hasBitsDailyAggData returns false when count is zero", async () => {
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ count: BigInt(0) }]);
    const ok = await (service as any).hasBitsDailyAggData("streamer-1", "2025-01-01");
    expect(ok).toBe(false);
  });

  it("syncSubscriptionSnapshot maps overall timeout error", async () => {
    jest.useFakeTimers();
    jest
      .spyOn(service as any, "_syncSubscriptionSnapshotInner")
      .mockImplementation(() => new Promise(() => {}));

    const pending = service.syncSubscriptionSnapshot("streamer-1");
    jest.advanceTimersByTime(61_000);
    await expect(pending).rejects.toThrow("Subscription sync timed out");
    jest.useRealTimers();
  });

  it("syncSubscriptionSnapshot handles undefined timer handle", async () => {
    const timeoutSpy = jest
      .spyOn(global, "setTimeout")
      .mockReturnValue(undefined as unknown as NodeJS.Timeout);
    jest.spyOn(service as any, "_syncSubscriptionSnapshotInner").mockResolvedValue(undefined);

    await expect(service.syncSubscriptionSnapshot("streamer-1")).resolves.toBeUndefined();

    timeoutSpy.mockRestore();
  });

  it("_syncSubscriptionSnapshotInner throws when streamer or token missing", async () => {
    (prisma.streamer.findUnique as jest.Mock).mockResolvedValue(null);
    await expect((service as any)._syncSubscriptionSnapshotInner("streamer-1")).rejects.toThrow(
      "Streamer not found or no valid token"
    );
  });

  it("_syncSubscriptionSnapshotInner upserts snapshot on success", async () => {
    (prisma.streamer.findUnique as jest.Mock).mockResolvedValue({
      twitchUserId: "broadcaster-1",
      twitchTokens: [{ id: "t1", accessToken: "a", refreshToken: "r" }],
    });
    jest.spyOn(service as any, "fetchSubscriptionsWithTwurple").mockResolvedValue({
      total: 5,
      tier1: 4,
      tier2: 1,
      tier3: 0,
    });

    await (service as any)._syncSubscriptionSnapshotInner("streamer-1");

    expect(prisma.subscriptionSnapshot.upsert).toHaveBeenCalledTimes(1);
  });

  it("fetchSubscriptionsWithTwurple throws when client env is missing", async () => {
    const prevId = process.env.TWITCH_CLIENT_ID;
    const prevSecret = process.env.TWITCH_CLIENT_SECRET;
    process.env.TWITCH_CLIENT_ID = "";
    process.env.TWITCH_CLIENT_SECRET = "";
    (importTwurpleApi as jest.Mock).mockResolvedValue({ ApiClient: class {} });
    (importTwurpleAuth as jest.Mock).mockResolvedValue({ RefreshingAuthProvider: class {} });

    await expect(
      (service as any).fetchSubscriptionsWithTwurple("b1", {
        id: "t1",
        accessToken: "a",
        refreshToken: "r",
      })
    ).rejects.toThrow("Missing TWITCH_CLIENT_ID or TWITCH_CLIENT_SECRET");

    process.env.TWITCH_CLIENT_ID = prevId;
    process.env.TWITCH_CLIENT_SECRET = prevSecret;
  });

  it("fetchSubscriptionsWithTwurple throws when refresh token is missing", async () => {
    const prevId = process.env.TWITCH_CLIENT_ID;
    const prevSecret = process.env.TWITCH_CLIENT_SECRET;
    process.env.TWITCH_CLIENT_ID = "cid";
    process.env.TWITCH_CLIENT_SECRET = "sec";

    class FakeAuth {
      onRefresh = jest.fn();
      addUserForToken = jest.fn();
    }
    class FakeApi {}
    (importTwurpleApi as jest.Mock).mockResolvedValue({ ApiClient: FakeApi });
    (importTwurpleAuth as jest.Mock).mockResolvedValue({ RefreshingAuthProvider: FakeAuth });

    await expect(
      (service as any).fetchSubscriptionsWithTwurple("b1", {
        id: "t1",
        accessToken: "a",
        refreshToken: null,
      })
    ).rejects.toThrow("No refresh token available for revenue sync");

    process.env.TWITCH_CLIENT_ID = prevId;
    process.env.TWITCH_CLIENT_SECRET = prevSecret;
  });

  it("fetchSubscriptionsWithTwurple reuses cached client and counts first page", async () => {
    const now = Date.now();
    (service as any).twurpleClients.set("b1", {
      authProvider: {},
      apiClient: {
        subscriptions: {
          getSubscriptions: jest.fn().mockResolvedValue({
            data: [{ tier: "1000" }, { tier: "2000" }, { tier: "3000" }],
          }),
          getSubscriptionsPaginated: jest.fn(),
        },
      },
      tokenId: "t1",
      lastUsedAt: now,
    });

    const result = await (service as any).fetchSubscriptionsWithTwurple("b1", {
      id: "t1",
      accessToken: "a",
      refreshToken: "r",
    });

    expect(result).toEqual({ total: 3, tier1: 1, tier2: 1, tier3: 1 });
    expect(importTwurpleApi).toHaveBeenCalledTimes(1);
    expect(decryptToken).not.toHaveBeenCalled();
    expect(encryptToken).not.toHaveBeenCalled();
  });

  it("startTwurpleCleanupTimer returns early if already started", () => {
    const existing = setInterval(() => {}, 1000);
    (service as any).twurpleCleanupTimer = existing;

    (service as any).startTwurpleCleanupTimer();

    expect((service as any).twurpleCleanupTimer).toBe(existing);
    clearInterval(existing);
  });

  it("cleanupTwurpleClients removes stale and evicts overflow", () => {
    const now = Date.now();
    (service as any).twurpleClientMaxEntries = 1;
    (service as any).twurpleClients.set("old", {
      authProvider: {},
      apiClient: {},
      tokenId: "a",
      lastUsedAt: now - 999999,
    });
    (service as any).twurpleClients.set("k1", {
      authProvider: {},
      apiClient: {},
      tokenId: "1",
      lastUsedAt: now,
    });
    (service as any).twurpleClients.set("k2", {
      authProvider: {},
      apiClient: {},
      tokenId: "2",
      lastUsedAt: now,
    });

    (service as any).cleanupTwurpleClients(now);

    expect((service as any).twurpleClients.has("old")).toBe(false);
    expect((service as any).twurpleClients.size).toBeLessThanOrEqual(1);
  });

  it("sleep waits for timer", async () => {
    jest.useFakeTimers();
    const p = (service as any).sleep(50);
    jest.advanceTimersByTime(50);
    await expect(p).resolves.toBeUndefined();
    jest.useRealTimers();
  });

  it("refreshBitsDailyAgg executes raw SQL", async () => {
    (prisma.$executeRaw as jest.Mock).mockResolvedValue(1);
    await (service as any).refreshBitsDailyAgg("streamer-1", "2025-01-01");
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it("prewarmRevenueCache settles all requests", async () => {
    jest.spyOn(service, "getRevenueOverview").mockResolvedValue({
      subscriptions: { current: 0, estimatedMonthlyRevenue: 0, tier1: 0, tier2: 0, tier3: 0 },
      bits: { totalBits: 0, estimatedRevenue: 0, eventCount: 0 },
      totalEstimatedRevenue: 0,
    });
    jest.spyOn(service, "getSubscriptionStats").mockRejectedValue(new Error("x"));
    jest.spyOn(service, "getBitsStats").mockResolvedValue([]);

    await expect(service.prewarmRevenueCache("streamer-1")).resolves.toBeUndefined();
  });

  it("syncSubscriptionSnapshot rethrows non-timeout errors", async () => {
    jest
      .spyOn(service as any, "_syncSubscriptionSnapshotInner")
      .mockRejectedValueOnce(new Error("other failure"));

    await expect(service.syncSubscriptionSnapshot("streamer-1")).rejects.toThrow("other failure");
  });

  it("getSubscriptionStats rethrows unexpected errors", async () => {
    jest.spyOn(service as any, "withQueryTimeout").mockRejectedValueOnce(new Error("db boom"));
    await expect(service.getSubscriptionStats("streamer-1", 30)).rejects.toThrow("db boom");
  });

  it("getBitsStats rethrows unexpected errors", async () => {
    jest.spyOn(service as any, "ensureBitsDailyAggFresh").mockResolvedValue(undefined);
    jest.spyOn(service as any, "withQueryTimeout").mockRejectedValueOnce(new Error("db boom"));
    await expect(service.getBitsStats("streamer-1", 30)).rejects.toThrow("db boom");
  });

  it("getRevenueOverview validates streamerId and creates fallback when stale missing", async () => {
    await expect(service.getRevenueOverview("")).rejects.toThrow("Invalid streamerId");

    jest.spyOn(service as any, "ensureBitsDailyAggFresh").mockResolvedValue(undefined);
    jest
      .spyOn(service as any, "withQueryTimeout")
      .mockRejectedValueOnce(new Error("DB_QUERY_TIMEOUT"));
    (cacheManager.get as jest.Mock).mockReturnValue(undefined);

    const fallback = await service.getRevenueOverview("streamer-1");
    expect(fallback.totalEstimatedRevenue).toBe(0);
    expect(cacheManager.set).toHaveBeenCalled();
  });

  it("getTopSupporters validates streamerId", async () => {
    await expect(service.getTopSupporters("", 10)).rejects.toThrow("Invalid streamerId");
  });

  it("fetchSubscriptionsWithTwurple builds new client and updates refreshed token", async () => {
    const prevId = process.env.TWITCH_CLIENT_ID;
    const prevSecret = process.env.TWITCH_CLIENT_SECRET;
    process.env.TWITCH_CLIENT_ID = "cid";
    process.env.TWITCH_CLIENT_SECRET = "sec";

    let refreshCb: ((uid: string, token: { accessToken: string; refreshToken?: string; expiresIn?: number }) => Promise<void>) | undefined;

    class FakeAuth {
      onRefresh = jest.fn((cb: any) => {
        refreshCb = cb;
      });
      addUserForToken = jest.fn().mockResolvedValue(undefined);
    }

    class FakeApi {
      subscriptions = {
        getSubscriptions: jest.fn().mockResolvedValue({ data: [{ tier: "1000" }] }),
        getSubscriptionsPaginated: jest.fn(),
      };
    }

    (importTwurpleApi as jest.Mock).mockResolvedValue({ ApiClient: FakeApi });
    (importTwurpleAuth as jest.Mock).mockResolvedValue({ RefreshingAuthProvider: FakeAuth });
    (prisma.twitchToken.update as jest.Mock).mockResolvedValue(undefined);

    const result = await (service as any).fetchSubscriptionsWithTwurple("b2", {
      id: "token-2",
      accessToken: "enc-access",
      refreshToken: "enc-refresh",
    });

    await refreshCb?.("u", { accessToken: "new-a", refreshToken: "new-r", expiresIn: 3600 });

    expect(result.total).toBe(1);
    expect(decryptToken).toHaveBeenCalledWith("enc-access");
    expect(prisma.twitchToken.update).toHaveBeenCalledTimes(1);
    expect(encryptToken).toHaveBeenCalledWith("new-a");

    process.env.TWITCH_CLIENT_ID = prevId;
    process.env.TWITCH_CLIENT_SECRET = prevSecret;
  });

  it("fetchSubscriptionsWithTwurple handles paginator path and permission errors", async () => {
    const prevId = process.env.TWITCH_CLIENT_ID;
    const prevSecret = process.env.TWITCH_CLIENT_SECRET;
    process.env.TWITCH_CLIENT_ID = "cid";
    process.env.TWITCH_CLIENT_SECRET = "sec";

    class FakeAuth {
      onRefresh = jest.fn();
      addUserForToken = jest.fn().mockResolvedValue(undefined);
    }

    const paginator = {
      async *[Symbol.asyncIterator]() {
        yield { tier: "1000" };
        yield { tier: "2000" };
      },
    };

    class FakeApiOk {
      subscriptions = {
        getSubscriptions: jest.fn().mockResolvedValue({ data: new Array(100).fill({ tier: "1000" }) }),
        getSubscriptionsPaginated: jest.fn().mockReturnValue(paginator),
      };
    }

    (importTwurpleApi as jest.Mock).mockResolvedValue({ ApiClient: FakeApiOk });
    (importTwurpleAuth as jest.Mock).mockResolvedValue({ RefreshingAuthProvider: FakeAuth });

    const result = await (service as any).fetchSubscriptionsWithTwurple("bp", {
      id: "token-p",
      accessToken: "a",
      refreshToken: "r",
    });
    expect(result.total).toBe(2);

    class FakeApiErr {
      subscriptions = {
        getSubscriptions: jest.fn().mockRejectedValue({ statusCode: 403, message: "forbidden" }),
        getSubscriptionsPaginated: jest.fn(),
      };
    }
    (importTwurpleApi as jest.Mock).mockResolvedValue({ ApiClient: FakeApiErr });

    await expect(
      (service as any).fetchSubscriptionsWithTwurple("bp2", {
        id: "token-p2",
        accessToken: "a",
        refreshToken: "r",
      })
    ).rejects.toThrow("Permission denied - requires Affiliate/Partner status");

    process.env.TWITCH_CLIENT_ID = prevId;
    process.env.TWITCH_CLIENT_SECRET = prevSecret;
  });

  it("timer callback calls cleanupTwurpleClients", () => {
    jest.useFakeTimers();
    const local = new RevenueService();
    const cleanupSpy = jest.spyOn(local as any, "cleanupTwurpleClients");

    jest.advanceTimersByTime(5 * 60 * 1000 + 10);

    expect(cleanupSpy).toHaveBeenCalled();
    const timer = (local as any).twurpleCleanupTimer;
    if (timer) clearInterval(timer);
    jest.useRealTimers();
  });

  it("cleanupTwurpleClients hits empty-oldest break branch", () => {
    (service as any).twurpleClients = new Map();
    (service as any).twurpleClientMaxEntries = -1;

    expect(() => (service as any).cleanupTwurpleClients(Date.now())).not.toThrow();
  });

  it("fetchSubscriptionsWithTwurple drops old cached client when token changes", async () => {
    const prevId = process.env.TWITCH_CLIENT_ID;
    const prevSecret = process.env.TWITCH_CLIENT_SECRET;
    process.env.TWITCH_CLIENT_ID = "cid";
    process.env.TWITCH_CLIENT_SECRET = "sec";

    class FakeAuth {
      onRefresh = jest.fn();
      addUserForToken = jest.fn().mockResolvedValue(undefined);
    }
    class FakeApi {
      subscriptions = {
        getSubscriptions: jest.fn().mockResolvedValue({ data: [{ tier: "1000" }] }),
        getSubscriptionsPaginated: jest.fn(),
      };
    }

    (service as any).twurpleClients.set("bc", {
      authProvider: {},
      apiClient: {},
      tokenId: "old-token",
      lastUsedAt: Date.now(),
    });
    (importTwurpleApi as jest.Mock).mockResolvedValue({ ApiClient: FakeApi });
    (importTwurpleAuth as jest.Mock).mockResolvedValue({ RefreshingAuthProvider: FakeAuth });

    await (service as any).fetchSubscriptionsWithTwurple("bc", {
      id: "new-token",
      accessToken: "a",
      refreshToken: "r",
    });

    expect((service as any).twurpleClients.get("bc").tokenId).toBe("new-token");
    process.env.TWITCH_CLIENT_ID = prevId;
    process.env.TWITCH_CLIENT_SECRET = prevSecret;
  });

  it("fetchSubscriptionsWithTwurple records refresh-save failure", async () => {
    const prevId = process.env.TWITCH_CLIENT_ID;
    const prevSecret = process.env.TWITCH_CLIENT_SECRET;
    process.env.TWITCH_CLIENT_ID = "cid";
    process.env.TWITCH_CLIENT_SECRET = "sec";

    let refreshCb: ((uid: string, token: { accessToken: string; refreshToken?: string; expiresIn?: number }) => Promise<void>) | undefined;
    class FakeAuth {
      onRefresh = jest.fn((cb: any) => {
        refreshCb = cb;
      });
      addUserForToken = jest.fn().mockResolvedValue(undefined);
    }
    class FakeApi {
      subscriptions = {
        getSubscriptions: jest.fn().mockResolvedValue({ data: [{ tier: "1000" }] }),
        getSubscriptionsPaginated: jest.fn(),
      };
    }
    (importTwurpleApi as jest.Mock).mockResolvedValue({ ApiClient: FakeApi });
    (importTwurpleAuth as jest.Mock).mockResolvedValue({ RefreshingAuthProvider: FakeAuth });
    (prisma.twitchToken.update as jest.Mock).mockRejectedValue(new Error("save failed"));

    await (service as any).fetchSubscriptionsWithTwurple("bx", {
      id: "token-x",
      accessToken: "a",
      refreshToken: "r",
    });
    await refreshCb?.("u", { accessToken: "new", refreshToken: "new-r", expiresIn: 10 });

    expect(logger.error).toHaveBeenCalledWith(
      "RevenueService",
      "Failed to save refreshed token to database:",
      expect.any(Error)
    );

    process.env.TWITCH_CLIENT_ID = prevId;
    process.env.TWITCH_CLIENT_SECRET = prevSecret;
  });

  it("fetchSubscriptionsWithTwurple handles tier3 and sync timeout in paginator", async () => {
    const prevId = process.env.TWITCH_CLIENT_ID;
    const prevSecret = process.env.TWITCH_CLIENT_SECRET;
    process.env.TWITCH_CLIENT_ID = "cid";
    process.env.TWITCH_CLIENT_SECRET = "sec";

    class FakeAuth {
      onRefresh = jest.fn();
      addUserForToken = jest.fn().mockResolvedValue(undefined);
    }
    const paginator = {
      async *[Symbol.asyncIterator]() {
        yield { tier: "3000" };
      },
    };
    class FakeApi {
      subscriptions = {
        getSubscriptions: jest.fn().mockResolvedValue({ data: new Array(100).fill({ tier: "1000" }) }),
        getSubscriptionsPaginated: jest.fn().mockReturnValue(paginator),
      };
    }
    (importTwurpleApi as jest.Mock).mockResolvedValue({ ApiClient: FakeApi });
    (importTwurpleAuth as jest.Mock).mockResolvedValue({ RefreshingAuthProvider: FakeAuth });

    const nowSpy = jest.spyOn(Date, "now");
    nowSpy
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(99999999);

    await expect(
      (service as any).fetchSubscriptionsWithTwurple("bt", {
        id: "token-t",
        accessToken: "a",
        refreshToken: "r",
      })
    ).rejects.toThrow("SYNC_TIMEOUT");

    nowSpy.mockRestore();
    process.env.TWITCH_CLIENT_ID = prevId;
    process.env.TWITCH_CLIENT_SECRET = prevSecret;
  });

  it("fetchSubscriptionsWithTwurple rethrows non-permission API errors", async () => {
    const prevId = process.env.TWITCH_CLIENT_ID;
    const prevSecret = process.env.TWITCH_CLIENT_SECRET;
    process.env.TWITCH_CLIENT_ID = "cid";
    process.env.TWITCH_CLIENT_SECRET = "sec";

    class FakeAuth {
      onRefresh = jest.fn();
      addUserForToken = jest.fn().mockResolvedValue(undefined);
    }
    class FakeApi {
      subscriptions = {
        getSubscriptions: jest.fn().mockRejectedValue({ statusCode: 500, message: "boom" }),
        getSubscriptionsPaginated: jest.fn(),
      };
    }
    (importTwurpleApi as jest.Mock).mockResolvedValue({ ApiClient: FakeApi });
    (importTwurpleAuth as jest.Mock).mockResolvedValue({ RefreshingAuthProvider: FakeAuth });

    await expect(
      (service as any).fetchSubscriptionsWithTwurple("be", {
        id: "token-e",
        accessToken: "a",
        refreshToken: "r",
      })
    ).rejects.toEqual(expect.objectContaining({ statusCode: 500 }));

    process.env.TWITCH_CLIENT_ID = prevId;
    process.env.TWITCH_CLIENT_SECRET = prevSecret;
  });

  it("fetchSubscriptionsWithTwurple throws when subscriber count exceeds limit", async () => {
    const prevId = process.env.TWITCH_CLIENT_ID;
    const prevSecret = process.env.TWITCH_CLIENT_SECRET;
    process.env.TWITCH_CLIENT_ID = "cid";
    process.env.TWITCH_CLIENT_SECRET = "sec";

    class FakeAuth {
      onRefresh = jest.fn();
      addUserForToken = jest.fn().mockResolvedValue(undefined);
    }

    const paginator = {
      async *[Symbol.asyncIterator]() {
        for (let i = 0; i < 5001; i += 1) {
          yield { tier: "1000" };
        }
      },
    };

    class FakeApi {
      subscriptions = {
        getSubscriptions: jest.fn().mockResolvedValue({ data: new Array(100).fill({ tier: "1000" }) }),
        getSubscriptionsPaginated: jest.fn().mockReturnValue(paginator),
      };
    }

    (importTwurpleApi as jest.Mock).mockResolvedValue({ ApiClient: FakeApi });
    (importTwurpleAuth as jest.Mock).mockResolvedValue({ RefreshingAuthProvider: FakeAuth });

    await expect(
      (service as any).fetchSubscriptionsWithTwurple("bl", {
        id: "token-l",
        accessToken: "a",
        refreshToken: "r",
      })
    ).rejects.toThrow("SUBSCRIPTION_LIMIT_EXCEEDED");

    process.env.TWITCH_CLIENT_ID = prevId;
    process.env.TWITCH_CLIENT_SECRET = prevSecret;
  });

  it("startTwurpleCleanupTimer falls back to default interval and handles missing unref", () => {
    const timerObj = {} as NodeJS.Timeout;
    const setIntervalSpy = jest
      .spyOn(global, "setInterval")
      .mockReturnValue(timerObj as unknown as ReturnType<typeof setInterval>);

    (service as any).twurpleCleanupTimer = null;
    (service as any).twurpleCleanupIntervalMs = 0;

    (service as any).startTwurpleCleanupTimer();

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 5 * 60 * 1000);
    setIntervalSpy.mockRestore();
  });

  it("cleanupTwurpleClients supports default now argument", () => {
    expect(() => (service as any).cleanupTwurpleClients()).not.toThrow();
  });

  it("maxDateKey returns first arg when it is greater", () => {
    expect((service as any).maxDateKey("2025-12-31", "2025-01-01")).toBe("2025-12-31");
  });

  it("withQueryTimeout handles undefined timer handle", async () => {
    const timeoutSpy = jest
      .spyOn(global, "setTimeout")
      .mockReturnValue(undefined as unknown as NodeJS.Timeout);

    const result = await (service as any).withQueryTimeout(async () => "ok", 10);

    expect(result).toBe("ok");
    timeoutSpy.mockRestore();
  });

  it("withBitsDailyAggRefreshLock handles replaced lock entry", async () => {
    await (service as any).withBitsDailyAggRefreshLock("lk", async () => {
      (service as any).bitsDailyAggRefreshLocks.set("lk", Promise.resolve());
    });

    expect((service as any).bitsDailyAggRefreshLocks.get("lk")).toBeDefined();
    (service as any).bitsDailyAggRefreshLocks.delete("lk");
  });

  it("ensureBitsDailyAggFresh skips bootstrap refresh when data exists", async () => {
    (cacheManager.getOrSetWithTags as jest.Mock).mockImplementation(
      async (_key: string, resolver: () => Promise<unknown>) => resolver()
    );
    jest.spyOn(service as any, "hasBitsDailyAggData").mockResolvedValue(true);
    const refreshSpy = jest.spyOn(service as any, "refreshBitsDailyAgg").mockResolvedValue(undefined);

    await (service as any).ensureBitsDailyAggFresh("streamer-1", "2025-01-01");

    expect(refreshSpy).toHaveBeenCalledTimes(1);
  });

  it("fetchSubscriptionsWithTwurple refresh callback handles missing optional fields", async () => {
    const prevId = process.env.TWITCH_CLIENT_ID;
    const prevSecret = process.env.TWITCH_CLIENT_SECRET;
    process.env.TWITCH_CLIENT_ID = "cid";
    process.env.TWITCH_CLIENT_SECRET = "sec";

    let refreshCb:
      | ((uid: string, token: { accessToken: string; refreshToken?: string; expiresIn?: number }) => Promise<void>)
      | undefined;
    class FakeAuth {
      onRefresh = jest.fn((cb: any) => {
        refreshCb = cb;
      });
      addUserForToken = jest.fn().mockResolvedValue(undefined);
    }
    class FakeApi {
      subscriptions = {
        getSubscriptions: jest.fn().mockResolvedValue({ data: [{ tier: "1000" }] }),
        getSubscriptionsPaginated: jest.fn(),
      };
    }
    (importTwurpleApi as jest.Mock).mockResolvedValue({ ApiClient: FakeApi });
    (importTwurpleAuth as jest.Mock).mockResolvedValue({ RefreshingAuthProvider: FakeAuth });
    (prisma.twitchToken.update as jest.Mock).mockResolvedValue(undefined);

    await (service as any).fetchSubscriptionsWithTwurple("bo", {
      id: "token-o",
      accessToken: "a",
      refreshToken: "r",
    });
    await refreshCb?.("u", { accessToken: "new-only" });

    expect(prisma.twitchToken.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ refreshToken: undefined, expiresAt: null }),
      })
    );

    process.env.TWITCH_CLIENT_ID = prevId;
    process.env.TWITCH_CLIENT_SECRET = prevSecret;
  });

  it("fetchSubscriptionsWithTwurple handles refresh save error", async () => {
    const prevId = process.env.TWITCH_CLIENT_ID;
    const prevSecret = process.env.TWITCH_CLIENT_SECRET;
    process.env.TWITCH_CLIENT_ID = "cid";
    process.env.TWITCH_CLIENT_SECRET = "sec";

    let refreshCb:
      | ((uid: string, token: { accessToken: string; refreshToken?: string; expiresIn?: number }) => Promise<void>)
      | undefined;
    class FakeAuth {
      onRefresh = jest.fn((cb: any) => {
        refreshCb = cb;
      });
      addUserForToken = jest.fn().mockResolvedValue(undefined);
    }
    class FakeApi {
      subscriptions = {
        getSubscriptions: jest.fn().mockResolvedValue({ data: [{ tier: "1000" }] }),
        getSubscriptionsPaginated: jest.fn(),
      };
    }
    (importTwurpleApi as jest.Mock).mockResolvedValue({ ApiClient: FakeApi });
    (importTwurpleAuth as jest.Mock).mockResolvedValue({ RefreshingAuthProvider: FakeAuth });
    (prisma.twitchToken.update as jest.Mock).mockRejectedValue(new Error("save failed"));

    await (service as any).fetchSubscriptionsWithTwurple("bs", {
      id: "token-s",
      accessToken: "a",
      refreshToken: "r",
    });
    await refreshCb?.("u", { accessToken: "x" });

    expect(logger.error).toHaveBeenCalledWith(
      "RevenueService",
      "Failed to save refreshed token to database:",
      expect.any(Error)
    );

    process.env.TWITCH_CLIENT_ID = prevId;
    process.env.TWITCH_CLIENT_SECRET = prevSecret;
  });

  it("fetchSubscriptionsWithTwurple first-page branch handles unknown tier", async () => {
    const prevId = process.env.TWITCH_CLIENT_ID;
    const prevSecret = process.env.TWITCH_CLIENT_SECRET;
    process.env.TWITCH_CLIENT_ID = "cid";
    process.env.TWITCH_CLIENT_SECRET = "sec";

    class FakeAuth {
      onRefresh = jest.fn();
      addUserForToken = jest.fn().mockResolvedValue(undefined);
    }
    class FakeApi {
      subscriptions = {
        getSubscriptions: jest.fn().mockResolvedValue({ data: [{ tier: "prime" }] }),
        getSubscriptionsPaginated: jest.fn(),
      };
    }
    (importTwurpleApi as jest.Mock).mockResolvedValue({ ApiClient: FakeApi });
    (importTwurpleAuth as jest.Mock).mockResolvedValue({ RefreshingAuthProvider: FakeAuth });

    const result = await (service as any).fetchSubscriptionsWithTwurple("bu", {
      id: "token-u",
      accessToken: "a",
      refreshToken: "r",
    });

    expect(result).toEqual({ total: 1, tier1: 0, tier2: 0, tier3: 0 });
    process.env.TWITCH_CLIENT_ID = prevId;
    process.env.TWITCH_CLIENT_SECRET = prevSecret;
  });

  it("fetchSubscriptionsWithTwurple paginator branch handles unknown tier and executes timer callback", async () => {
    const prevId = process.env.TWITCH_CLIENT_ID;
    const prevSecret = process.env.TWITCH_CLIENT_SECRET;
    process.env.TWITCH_CLIENT_ID = "cid";
    process.env.TWITCH_CLIENT_SECRET = "sec";

    class FakeAuth {
      onRefresh = jest.fn();
      addUserForToken = jest.fn().mockResolvedValue(undefined);
    }
    const paginator = {
      async *[Symbol.asyncIterator]() {
        yield { tier: "unknown" };
      },
    };
    class FakeApi {
      subscriptions = {
        getSubscriptions: jest.fn().mockResolvedValue({ data: new Array(100).fill({ tier: "1000" }) }),
        getSubscriptionsPaginated: jest.fn().mockReturnValue(paginator),
      };
    }
    (importTwurpleApi as jest.Mock).mockResolvedValue({ ApiClient: FakeApi });
    (importTwurpleAuth as jest.Mock).mockResolvedValue({ RefreshingAuthProvider: FakeAuth });

    const timeoutSpy = jest
      .spyOn(global, "setTimeout")
      .mockImplementation(((cb: (...args: unknown[]) => void) => {
        cb();
        return 1 as unknown as NodeJS.Timeout;
      }) as typeof setTimeout);

    const result = await (service as any).fetchSubscriptionsWithTwurple("bv", {
      id: "token-v",
      accessToken: "a",
      refreshToken: "r",
    });

    expect(result).toEqual({ total: 1, tier1: 0, tier2: 0, tier3: 0 });
    timeoutSpy.mockRestore();
    process.env.TWITCH_CLIENT_ID = prevId;
    process.env.TWITCH_CLIENT_SECRET = prevSecret;
  });

  it("getSubscriptionStats uses default days argument", async () => {
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([]);
    await service.getSubscriptionStats("streamer-1");
    expect(prisma.$queryRaw).toHaveBeenCalled();
  });

  it("getBitsStats uses default days argument", async () => {
    jest.spyOn(service as any, "ensureBitsDailyAggFresh").mockResolvedValue(undefined);
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([]);
    await service.getBitsStats("streamer-1");
    expect(prisma.$queryRaw).toHaveBeenCalled();
  });

  it("getRevenueOverview handles missing snapshot and bits rows", async () => {
    jest.spyOn(service as any, "ensureBitsDailyAggFresh").mockResolvedValue(undefined);
    (prisma.subscriptionSnapshot.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([]);

    const data = await service.getRevenueOverview("streamer-1");

    expect(data).toEqual({
      subscriptions: {
        current: 0,
        estimatedMonthlyRevenue: 0,
        tier1: 0,
        tier2: 0,
        tier3: 0,
      },
      bits: {
        totalBits: 0,
        estimatedRevenue: 0,
        eventCount: 0,
      },
      totalEstimatedRevenue: 0,
    });
  });

  it("getTopSupporters uses default limit argument", async () => {
    (prisma.cheerEvent.groupBy as jest.Mock).mockResolvedValue([]);
    const rows = await service.getTopSupporters("streamer-1");
    expect(rows).toEqual([]);
    expect(prisma.cheerEvent.groupBy).toHaveBeenCalled();
  });

  it("getRevenueOverview rethrows unexpected errors", async () => {
    jest.spyOn(service as any, "ensureBitsDailyAggFresh").mockResolvedValue(undefined);
    jest.spyOn(service as any, "withQueryTimeout").mockRejectedValueOnce(new Error("unexpected"));

    await expect(service.getRevenueOverview("streamer-1")).rejects.toThrow("unexpected");
  });
});
