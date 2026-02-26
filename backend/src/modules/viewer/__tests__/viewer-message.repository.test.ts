jest.mock("../../../db/prisma", () => ({
  prisma: {
    viewer: {
      findUnique: jest.fn(),
    },
    channel: {
      findFirst: jest.fn(),
    },
    viewerChannelMessage: {
      createMany: jest.fn(),
    },
    $transaction: jest.fn(),
    $executeRaw: jest.fn(),
  },
}));

jest.mock("../../../services/websocket.gateway", () => ({
  webSocketGateway: {
    emitViewerStats: jest.fn(),
    emitViewerStatsBatch: jest.fn(),
  },
}));

jest.mock("../../../utils/cache-manager", () => ({
  CacheTTL: { SHORT: 30, LONG: 600 },
  cacheManager: {
    get: jest.fn().mockReturnValue(null),
    set: jest.fn(),
    delete: jest.fn(),
  },
}));

jest.mock("../../../utils/logger", () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import { prisma } from "../../../db/prisma";
import { webSocketGateway } from "../../../services/websocket.gateway";
import { cacheManager } from "../../../utils/cache-manager";
import { logger } from "../../../utils/logger";
import { ViewerMessageRepository } from "../viewer-message.repository";

describe("ViewerMessageRepository flush batch emits", () => {
  const txExecuteRaw = jest.fn();

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    (prisma.viewer.findUnique as jest.Mock).mockResolvedValue({ id: "viewer-1" });
    (prisma.channel.findFirst as jest.Mock).mockResolvedValue({ id: "channel-1" });
    (prisma.viewerChannelMessage.createMany as jest.Mock).mockResolvedValue({ count: 3 });
    (prisma.$transaction as jest.Mock).mockImplementation(async (callback: (tx: any) => Promise<unknown>) =>
      callback({
        $executeRaw: txExecuteRaw,
      })
    );
    txExecuteRaw.mockResolvedValue(1);
    (prisma.$executeRaw as jest.Mock).mockResolvedValue(1);
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it("uses batched socket event for multi-channel updates of same viewer", async () => {
    const repo = new ViewerMessageRepository();
    const ts = new Date("2026-02-26T10:00:00.000Z");

    const batch = [
      {
        viewerId: "v1",
        channelId: "c1",
        messageText: "a",
        messageType: "CHAT",
        timestamp: ts,
        badges: null,
        emotesUsed: null,
        bitsAmount: null,
        emoteCount: 0,
        retryCount: 0,
      },
      {
        viewerId: "v1",
        channelId: "c2",
        messageText: "b",
        messageType: "CHAT",
        timestamp: ts,
        badges: null,
        emotesUsed: null,
        bitsAmount: null,
        emoteCount: 1,
        retryCount: 0,
      },
      {
        viewerId: "v2",
        channelId: "c3",
        messageText: "c",
        messageType: "CHAT",
        timestamp: ts,
        badges: null,
        emotesUsed: null,
        bitsAmount: null,
        emoteCount: 0,
        retryCount: 0,
      },
    ];

    const ok = await (repo as any).flushBatch(batch);

    expect(ok).toBe(true);
    expect(prisma.viewerChannelMessage.createMany).toHaveBeenCalledTimes(1);
    expect(txExecuteRaw).toHaveBeenCalledTimes(3);

    expect(webSocketGateway.emitViewerStatsBatch).toHaveBeenCalledWith(
      "v1",
      expect.arrayContaining([
        { channelId: "c1", messageCountDelta: 1 },
        { channelId: "c2", messageCountDelta: 1 },
      ])
    );
    expect(webSocketGateway.emitViewerStats).toHaveBeenCalledWith("v2", {
      channelId: "c3",
      messageCountDelta: 1,
    });

    expect(cacheManager.delete).toHaveBeenCalledWith("viewer:v1:channels_list");
    expect(cacheManager.delete).toHaveBeenCalledWith("viewer:v2:channels_list");
  });

  it("keeps single-channel viewer update as single socket event", async () => {
    const repo = new ViewerMessageRepository();
    const ts = new Date("2026-02-26T10:00:00.000Z");

    const batch = [
      {
        viewerId: "v1",
        channelId: "c1",
        messageText: "a",
        messageType: "CHAT",
        timestamp: ts,
        badges: null,
        emotesUsed: null,
        bitsAmount: null,
        emoteCount: 0,
        retryCount: 0,
      },
      {
        viewerId: "v1",
        channelId: "c1",
        messageText: "b",
        messageType: "CHAT",
        timestamp: ts,
        badges: null,
        emotesUsed: null,
        bitsAmount: null,
        emoteCount: 2,
        retryCount: 0,
      },
    ];

    await (repo as any).flushBatch(batch);

    expect(webSocketGateway.emitViewerStatsBatch).not.toHaveBeenCalled();
    expect(webSocketGateway.emitViewerStats).toHaveBeenCalledWith("v1", {
      channelId: "c1",
      messageCountDelta: 2,
    });
  });

  it("returns true and retries lifetime stats when aggregate transaction fails after raw messages persisted", async () => {
    const repo = new ViewerMessageRepository();
    const ts = new Date("2026-02-26T10:00:00.000Z");

    const batch = [
      {
        viewerId: "v9",
        channelId: "c9",
        messageText: "x",
        messageType: "CHAT",
        timestamp: ts,
        badges: null,
        emotesUsed: null,
        bitsAmount: null,
        emoteCount: 0,
        retryCount: 0,
      },
    ];

    (prisma.$transaction as jest.Mock).mockRejectedValueOnce(new Error("aggregate failed"));
    (prisma.$executeRaw as jest.Mock).mockResolvedValueOnce(1);

    const ok = await (repo as any).flushBatch(batch);

    expect(ok).toBe(true);
    expect(prisma.viewerChannelMessage.createMany).toHaveBeenCalledTimes(1);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(cacheManager.delete).toHaveBeenCalledWith("viewer:v9:channels_list");
    expect(webSocketGateway.emitViewerStats).not.toHaveBeenCalled();
    expect(webSocketGateway.emitViewerStatsBatch).not.toHaveBeenCalled();
  });

  it("returns false and pushes message into retry buffer when raw insert fails", async () => {
    const repo = new ViewerMessageRepository();
    const ts = new Date("2026-02-26T10:00:00.000Z");

    const batch = [
      {
        viewerId: "vr",
        channelId: "cr",
        messageText: "retry-me",
        messageType: "CHAT",
        timestamp: ts,
        badges: null,
        emotesUsed: null,
        bitsAmount: null,
        emoteCount: 0,
        retryCount: 0,
      },
    ];

    (prisma.viewerChannelMessage.createMany as jest.Mock).mockRejectedValueOnce(
      new Error("insert failed")
    );

    const ok = await (repo as any).flushBatch(batch);

    expect(ok).toBe(false);
    expect((repo as any).retryBuffer).toHaveLength(1);
    expect((repo as any).retryBuffer[0].message.retryCount).toBe(1);
    expect(webSocketGateway.emitViewerStats).not.toHaveBeenCalled();
    expect(webSocketGateway.emitViewerStatsBatch).not.toHaveBeenCalled();
  });

  it("saveMessage skips when viewer lookup resolves to null sentinel", async () => {
    const repo = new ViewerMessageRepository();
    (cacheManager.get as jest.Mock).mockImplementation((key: string) =>
      key.startsWith("lookup:viewer") ? "__NULL__" : null
    );

    await repo.saveMessage("demo", {
      twitchUserId: "tu-1",
      username: "user",
      displayName: "User",
      messageText: "hi",
      messageType: "CHAT",
      timestamp: new Date("2026-02-26T10:00:00.000Z"),
      badges: null,
      emotes: null,
      bits: 0,
    });

    expect(prisma.channel.findFirst).not.toHaveBeenCalled();
    expect((repo as any).messageBuffer).toHaveLength(0);
  });

  it("saveMessage sets null sentinel cache when channel not found", async () => {
    const repo = new ViewerMessageRepository();
    (cacheManager.get as jest.Mock).mockReturnValue(null);
    (prisma.channel.findFirst as jest.Mock).mockResolvedValueOnce(null);

    await repo.saveMessage("missing_channel", {
      twitchUserId: "tu-2",
      username: "user",
      displayName: "User",
      messageText: "hi",
      messageType: "CHAT",
      timestamp: new Date("2026-02-26T10:00:00.000Z"),
      badges: null,
      emotes: null,
      bits: 0,
    });

    expect(cacheManager.set).toHaveBeenCalledWith(
      "lookup:channel:missing_channel",
      "__NULL__",
      30
    );
    expect((repo as any).messageBuffer).toHaveLength(0);
  });

  it("saveMessage enqueues normalized payload with json fields and bits", async () => {
    const repo = new ViewerMessageRepository();
    (cacheManager.get as jest.Mock).mockReturnValue(null);

    await repo.saveMessage("demo", {
      twitchUserId: "tu-3",
      username: "user",
      displayName: "User",
      messageText: "cheer100",
      messageType: "CHEER",
      timestamp: new Date("2026-02-26T10:00:00.000Z"),
      badges: { subscriber: "1" },
      emotes: ["Kappa"],
      bits: 100,
    });

    expect((repo as any).messageBuffer).toHaveLength(1);
    const queued = (repo as any).messageBuffer[0];
    expect(queued.viewerId).toBe("viewer-1");
    expect(queued.channelId).toBe("channel-1");
    expect(queued.badges).toBe(JSON.stringify({ subscriber: "1" }));
    expect(queued.emotesUsed).toBe(JSON.stringify(["Kappa"]));
    expect(queued.bitsAmount).toBe(100);
    expect(queued.emoteCount).toBe(1);
  });

  it("saveMessage logs error when lookup throws non-retryable error", async () => {
    const repo = new ViewerMessageRepository();
    (cacheManager.get as jest.Mock).mockReturnValue(null);
    (prisma.viewer.findUnique as jest.Mock).mockRejectedValueOnce(new Error("permission denied"));

    await repo.saveMessage("demo", {
      twitchUserId: "tu-4",
      username: "user",
      displayName: "User",
      messageText: "hi",
      messageType: "CHAT",
      timestamp: new Date("2026-02-26T10:00:00.000Z"),
      badges: null,
      emotes: null,
      bits: 0,
    });

    expect(logger.error).toHaveBeenCalledWith(
      "ViewerMessage",
      "getCachedViewerId(tu-4) failed after 1 attempts",
      expect.any(Error)
    );
  });

  it("flushBatch drops over-retried messages", async () => {
    const repo = new ViewerMessageRepository();
    const ts = new Date("2026-02-26T10:00:00.000Z");
    const batch = [
      {
        viewerId: "vd",
        channelId: "cd",
        messageText: "drop",
        messageType: "CHAT",
        timestamp: ts,
        badges: null,
        emotesUsed: null,
        bitsAmount: null,
        emoteCount: 0,
        retryCount: 3,
      },
    ];
    (prisma.viewerChannelMessage.createMany as jest.Mock).mockRejectedValueOnce(
      new Error("insert failed")
    );

    const ok = await (repo as any).flushBatch(batch);

    expect(ok).toBe(false);
    expect((repo as any).retryBuffer).toHaveLength(0);
    expect(logger.error).toHaveBeenCalledWith(
      "ViewerMessage",
      "Dropped 1 messages after 3 retries"
    );
  });

  it("flushBuffers marks flushRequested when already in progress", async () => {
    const repo = new ViewerMessageRepository();
    (repo as any).flushInProgress = true;

    await (repo as any).flushBuffers();

    expect((repo as any).flushRequested).toBe(true);
  });

  it("flushBatch returns true for empty batch", async () => {
    const repo = new ViewerMessageRepository();
    const ok = await (repo as any).flushBatch([]);
    expect(ok).toBe(true);
  });

  it("scheduleFlush creates only one timer", async () => {
    const repo = new ViewerMessageRepository();

    (repo as any).scheduleFlush();
    const firstTimer = (repo as any).flushTimer;
    (repo as any).scheduleFlush();

    expect((repo as any).flushTimer).toBe(firstTimer);
    await (repo as any).flushBuffers();
  });

  it("retries transient viewer lookup errors and succeeds", async () => {
    const repo = new ViewerMessageRepository();
    (cacheManager.get as jest.Mock).mockReturnValue(null);
    (prisma.viewer.findUnique as jest.Mock)
      .mockRejectedValueOnce(new Error("502 bad gateway"))
      .mockResolvedValueOnce({ id: "viewer-retry" });

    const promise = (repo as any).getCachedViewerId("tu-retry");
    await jest.advanceTimersByTimeAsync(120);
    const viewerId = await promise;

    expect(viewerId).toBe("viewer-retry");
    expect(prisma.viewer.findUnique).toHaveBeenCalledTimes(2);
    expect(logger.debug).toHaveBeenCalledWith(
      "ViewerMessage",
      expect.stringContaining("retry 1/3")
    );
  });

  it.each([
    "503 service unavailable",
    "http status 400 server_error",
    "http status 404",
    "fetch failed",
    "ECONNRESET",
    "batch request failed",
  ])("retries for transient pattern: %s", async (errorMessage) => {
    const repo = new ViewerMessageRepository();
    (cacheManager.get as jest.Mock).mockReturnValue(null);
    (prisma.viewer.findUnique as jest.Mock)
      .mockRejectedValueOnce(new Error(errorMessage))
      .mockResolvedValueOnce({ id: "viewer-pattern" });

    const promise = (repo as any).getCachedViewerId("tu-pattern");
    await jest.advanceTimersByTimeAsync(120);
    await expect(promise).resolves.toBe("viewer-pattern");
  });

  it("returns cached viewer and channel ids without hitting DB", async () => {
    const repo = new ViewerMessageRepository();
    (cacheManager.get as jest.Mock).mockImplementation((key: string) => {
      if (key.startsWith("lookup:viewer")) return "viewer-cached";
      if (key.startsWith("lookup:channel")) return "channel-cached";
      return null;
    });

    await repo.saveMessage("demo", {
      twitchUserId: "tu-cache",
      username: "user",
      displayName: "User",
      messageText: "hi",
      messageType: "CHAT",
      timestamp: new Date("2026-02-26T10:00:00.000Z"),
      badges: null,
      emotes: null,
      bits: 0,
    });

    expect(prisma.viewer.findUnique).not.toHaveBeenCalled();
    expect(prisma.channel.findFirst).not.toHaveBeenCalled();
    expect((repo as any).messageBuffer).toHaveLength(1);
    expect((repo as any).messageBuffer[0].viewerId).toBe("viewer-cached");
    expect((repo as any).messageBuffer[0].channelId).toBe("channel-cached");
  });

  it("returns null from channel cache sentinel", async () => {
    const repo = new ViewerMessageRepository();
    (cacheManager.get as jest.Mock).mockImplementation((key: string) => {
      if (key.startsWith("lookup:viewer")) return "viewer-ok";
      if (key.startsWith("lookup:channel")) return "__NULL__";
      return null;
    });

    await repo.saveMessage("demo", {
      twitchUserId: "tu-null-channel",
      username: "user",
      displayName: "User",
      messageText: "hi",
      messageType: "CHAT",
      timestamp: new Date("2026-02-26T10:00:00.000Z"),
      badges: null,
      emotes: null,
      bits: 0,
    });

    expect(prisma.channel.findFirst).not.toHaveBeenCalled();
    expect((repo as any).messageBuffer).toHaveLength(0);
  });

  it("logs saveMessage error when cached lookup throws", async () => {
    const repo = new ViewerMessageRepository();
    jest.spyOn(repo as any, "getCachedViewerId").mockRejectedValueOnce(new Error("lookup failed"));

    await repo.saveMessage("demo", {
      twitchUserId: "tu-enqueue",
      username: "raw",
      displayName: "Raw",
      messageText: "raw",
      messageType: "CHAT",
      timestamp: new Date("2026-02-26T10:00:00.000Z"),
      badges: null,
      emotes: null,
      bits: 0,
    });

    expect(logger.error).toHaveBeenCalledWith("ViewerMessage", "Error saving message", expect.any(Error));
  });

  it("schedules flush when flushBatch fails mid-loop with remaining buffer", async () => {
    const repo = new ViewerMessageRepository();
    const msg = {
      viewerId: "v",
      channelId: "c",
      messageText: "m",
      messageType: "CHAT",
      timestamp: new Date("2026-02-26T10:00:00.000Z"),
      badges: null,
      emotesUsed: null,
      bitsAmount: null,
      emoteCount: 0,
      retryCount: 0,
    };

    (repo as any).messageBuffer = Array.from({ length: 60 }, () => ({ ...msg }));
    const flushBatchSpy = jest.spyOn(repo as any, "flushBatch").mockResolvedValueOnce(false);

    await (repo as any).flushBuffers();

    expect(flushBatchSpy).toHaveBeenCalledTimes(1);
    expect((repo as any).messageBuffer.length).toBe(10);
    expect((repo as any).flushTimer).not.toBeNull();
  });

  it("logs fallback retry failure when aggregate and standalone retry both fail", async () => {
    const repo = new ViewerMessageRepository();
    const ts = new Date("2026-02-26T10:00:00.000Z");
    const batch = [
      {
        viewerId: "vf",
        channelId: "cf",
        messageText: "x",
        messageType: "CHAT",
        timestamp: ts,
        badges: null,
        emotesUsed: null,
        bitsAmount: null,
        emoteCount: 0,
        retryCount: 0,
      },
    ];

    (prisma.$transaction as jest.Mock).mockRejectedValueOnce(new Error("aggregate failed"));
    (prisma.$executeRaw as jest.Mock).mockRejectedValueOnce(new Error("fallback failed"));

    const ok = await (repo as any).flushBatch(batch);

    expect(ok).toBe(true);
    expect(logger.error).toHaveBeenCalledWith(
      "ViewerMessage",
      "Standalone lifetime_stats retry also failed; data will be recovered by periodic aggregation jobs",
      expect.any(Error)
    );
  });

  it("flushPendingMessages returns early when buffer is empty", async () => {
    const repo = new ViewerMessageRepository();
    const flushSpy = jest.spyOn(repo as any, "flushBuffers");

    await repo.flushPendingMessages();

    expect(flushSpy).not.toHaveBeenCalled();
  });

  it("flushPendingMessages calls flushBuffers when buffer has entries", async () => {
    const repo = new ViewerMessageRepository();
    (repo as any).messageBuffer.push({
      viewerId: "v",
      channelId: "c",
      messageText: "m",
      messageType: "CHAT",
      timestamp: new Date("2026-02-26T10:00:00.000Z"),
      badges: null,
      emotesUsed: null,
      bitsAmount: null,
      emoteCount: 0,
      retryCount: 0,
    });
    const flushSpy = jest.spyOn(repo as any, "flushBuffers").mockResolvedValue(undefined);

    await repo.flushPendingMessages();

    expect(flushSpy).toHaveBeenCalledTimes(1);
  });

  it("logs overflow drop warning only when warn interval elapsed", async () => {
    const repo = new ViewerMessageRepository();
    (repo as any).messageBuffer = Array.from({ length: 3000 }, () => ({}));
    (repo as any).lastOverflowWarnAt = Date.now() - 31_000;

    (repo as any).logOverflowDrop();

    expect(logger.warn).toHaveBeenCalledWith(
      "ViewerMessage",
      expect.stringContaining("Message buffer pressure")
    );

    jest.clearAllMocks();
    (repo as any).lastOverflowWarnAt = Date.now();
    (repo as any).logOverflowDrop();

    expect(logger.warn).not.toHaveBeenCalled();
    await repo.flushPendingMessages();
  });

  it("handles enqueue soft-threshold flush failure", async () => {
    const repo = new ViewerMessageRepository();
    (repo as any).messageBuffer = Array.from({ length: 2400 }, () => ({
      viewerId: "v",
      channelId: "c",
      messageText: "m",
      messageType: "CHAT",
      timestamp: new Date("2026-02-26T10:00:00.000Z"),
      badges: null,
      emotesUsed: null,
      bitsAmount: null,
      emoteCount: 0,
      retryCount: 0,
    }));
    jest.spyOn(repo as any, "flushBuffers").mockRejectedValueOnce(new Error("soft flush failed"));

    (repo as any).enqueueMessage({
      viewerId: "v",
      channelId: "c",
      messageText: "m",
      messageType: "CHAT",
      timestamp: new Date("2026-02-26T10:00:00.000Z"),
      badges: null,
      emotesUsed: null,
      bitsAmount: null,
      emoteCount: 0,
      retryCount: 0,
    });

    await Promise.resolve();

    expect(logger.error).toHaveBeenCalledWith(
      "ViewerMessage",
      "Failed to flush message buffer under pressure",
      expect.any(Error)
    );
  });

  it("logs capacity flush failure when at max buffer", async () => {
    const repo = new ViewerMessageRepository();
    const msg = {
      viewerId: "v",
      channelId: "c",
      messageText: "m",
      messageType: "CHAT",
      timestamp: new Date("2026-02-26T10:00:00.000Z"),
      badges: null,
      emotesUsed: null,
      bitsAmount: null,
      emoteCount: 0,
      retryCount: 0,
    };
    (repo as any).messageBuffer = Array.from({ length: 3000 }, () => ({ ...msg }));
    (repo as any).flushInProgress = false;
    jest.spyOn(repo as any, "flushBuffers").mockRejectedValue(new Error("capacity flush failed"));

    (repo as any).enqueueMessage({ ...msg });
    await Promise.resolve();

    expect((repo as any).messageBuffer.length).toBeLessThanOrEqual(3000);
    expect(logger.error).toHaveBeenCalledWith(
      "ViewerMessage",
      "Failed to flush message buffer at capacity",
      expect.any(Error)
    );
  });

  it("drops oldest message when full and flush is in progress", async () => {
    const repo = new ViewerMessageRepository();
    const msg = {
      viewerId: "v",
      channelId: "c",
      messageText: "m",
      messageType: "CHAT",
      timestamp: new Date("2026-02-26T10:00:00.000Z"),
      badges: null,
      emotesUsed: null,
      bitsAmount: null,
      emoteCount: 0,
      retryCount: 0,
    };
    (repo as any).messageBuffer = Array.from({ length: 3000 }, () => ({ ...msg }));
    (repo as any).flushInProgress = true;
    const overflowSpy = jest.spyOn(repo as any, "logOverflowDrop");

    (repo as any).enqueueMessage({ ...msg });

    expect(overflowSpy).toHaveBeenCalled();
    expect((repo as any).messageBuffer.length).toBe(3000);
  });

  it("logs flush failure when enqueue reaches batch size", async () => {
    const repo = new ViewerMessageRepository();
    const msg = {
      viewerId: "v",
      channelId: "c",
      messageText: "m",
      messageType: "CHAT",
      timestamp: new Date("2026-02-26T10:00:00.000Z"),
      badges: null,
      emotesUsed: null,
      bitsAmount: null,
      emoteCount: 0,
      retryCount: 0,
    };
    (repo as any).messageBuffer = Array.from({ length: 49 }, () => ({ ...msg }));
    jest.spyOn(repo as any, "flushBuffers").mockRejectedValueOnce(new Error("batch flush failed"));

    (repo as any).enqueueMessage({ ...msg });
    await Promise.resolve();

    expect(logger.error).toHaveBeenCalledWith(
      "ViewerMessage",
      "Failed to flush message buffer",
      expect.any(Error)
    );
  });

  it("logs scheduled timer flush failure", async () => {
    const repo = new ViewerMessageRepository();
    jest.spyOn(repo as any, "flushBuffers").mockRejectedValueOnce(new Error("timer flush failed"));

    (repo as any).scheduleFlush();
    await jest.advanceTimersByTimeAsync(5001);

    expect(logger.error).toHaveBeenCalledWith(
      "ViewerMessage",
      "Failed to flush message buffer",
      expect.any(Error)
    );
  });

  it("drops oldest retry entry when retry buffer is at capacity", async () => {
    const repo = new ViewerMessageRepository();
    const msg = {
      viewerId: "v",
      channelId: "c",
      messageText: "m",
      messageType: "CHAT",
      timestamp: new Date("2026-02-26T10:00:00.000Z"),
      badges: null,
      emotesUsed: null,
      bitsAmount: null,
      emoteCount: 0,
      retryCount: 1,
    };
    (repo as any).retryBuffer = Array.from({ length: 3000 }, () => ({ message: { ...msg }, readyAt: 1 }));
    const overflowSpy = jest.spyOn(repo as any, "logOverflowDrop");

    (repo as any).enqueueRetryMessages([{ ...msg }]);

    expect((repo as any).retryBuffer.length).toBe(3000);
    expect(overflowSpy).toHaveBeenCalled();
  });

  it("keeps not-ready retry entries pending during promotion", async () => {
    const repo = new ViewerMessageRepository();
    const now = Date.now();
    (repo as any).retryBuffer = [
      {
        message: {
          viewerId: "v",
          channelId: "c",
          messageText: "m",
          messageType: "CHAT",
          timestamp: new Date("2026-02-26T10:00:00.000Z"),
          badges: null,
          emotesUsed: null,
          bitsAmount: null,
          emoteCount: 0,
          retryCount: 1,
        },
        readyAt: now + 10_000,
      },
    ];

    (repo as any).promoteReadyRetryMessages();

    expect((repo as any).retryBuffer).toHaveLength(1);
    expect((repo as any).messageBuffer).toHaveLength(0);
  });

  it("updates lifetime lastWatchedAt with the latest timestamp in batch", async () => {
    const repo = new ViewerMessageRepository();
    const ts1 = new Date("2026-02-26T10:00:00.000Z");
    const ts2 = new Date("2026-02-26T10:05:00.000Z");

    await (repo as any).flushBatch([
      {
        viewerId: "vt",
        channelId: "ct",
        messageText: "a",
        messageType: "CHAT",
        timestamp: ts1,
        badges: null,
        emotesUsed: null,
        bitsAmount: null,
        emoteCount: 0,
        retryCount: 0,
      },
      {
        viewerId: "vt",
        channelId: "ct",
        messageText: "b",
        messageType: "CHAT",
        timestamp: ts2,
        badges: null,
        emotesUsed: null,
        bitsAmount: null,
        emoteCount: 0,
        retryCount: 0,
      },
    ]);

    expect(txExecuteRaw).toHaveBeenCalled();
  });

  it("skips daily increments with non-positive messageCount", async () => {
    const repo = new ViewerMessageRepository();
    const ts = new Date("2026-02-26T10:00:00.000Z");
    const originalValues = Map.prototype.values;

    const valuesSpy = jest.spyOn(Map.prototype, "values").mockImplementation(function (this: Map<unknown, unknown>) {
      const entries = Array.from(originalValues.call(this));
      if (
        entries.length > 0 &&
        typeof entries[0] === "object" &&
        entries[0] !== null &&
        "messageCount" in (entries[0] as Record<string, unknown>) &&
        "emoteCount" in (entries[0] as Record<string, unknown>)
      ) {
        return [
          ...entries,
          {
            viewerId: "skip-viewer",
            channelId: "skip-channel",
            date: ts,
            messageCount: 0,
            emoteCount: 0,
          },
        ][Symbol.iterator]();
      }
      return originalValues.call(this);
    });

    await (repo as any).flushBatch([
      {
        viewerId: "v1",
        channelId: "c1",
        messageText: "a",
        messageType: "CHAT",
        timestamp: ts,
        badges: null,
        emotesUsed: null,
        bitsAmount: null,
        emoteCount: 0,
        retryCount: 0,
      },
    ]);

    expect(cacheManager.delete).not.toHaveBeenCalledWith("viewer:skip-viewer:channels_list");
    expect(webSocketGateway.emitViewerStats).not.toHaveBeenCalledWith("skip-viewer", expect.anything());

    valuesSpy.mockRestore();
  });
});
