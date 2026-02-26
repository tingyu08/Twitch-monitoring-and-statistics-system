jest.mock("../../../db/prisma", () => ({
  prisma: {
    viewerChannelMessage: {
      createMany: jest.fn(),
    },
    $transaction: jest.fn(),
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

describe("ViewerMessageRepository config fallback", () => {
  const originalBufferMax = process.env.VIEWER_MESSAGE_BUFFER_MAX;

  afterEach(() => {
    process.env.VIEWER_MESSAGE_BUFFER_MAX = originalBufferMax;
    jest.resetModules();
  });

  it("falls back to default max buffer when env is below batch size", async () => {
    process.env.VIEWER_MESSAGE_BUFFER_MAX = "40";
    jest.resetModules();

    const { ViewerMessageRepository } = await import("../viewer-message.repository");
    const repo = new ViewerMessageRepository();
    const flushSpy = jest.spyOn(repo as any, "flushBuffers").mockResolvedValue(undefined);

    (repo as any).flushInProgress = true;
    (repo as any).messageBuffer = Array.from({ length: 49 }, () => ({
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

    expect(flushSpy).toHaveBeenCalledTimes(1);
  });
});
