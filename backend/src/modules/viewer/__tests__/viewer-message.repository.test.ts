jest.mock("../../../db/prisma", () => ({
  prisma: {
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
import { ViewerMessageRepository } from "../viewer-message.repository";

describe("ViewerMessageRepository flush batch emits", () => {
  const txExecuteRaw = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.viewerChannelMessage.createMany as jest.Mock).mockResolvedValue({ count: 3 });
    (prisma.$transaction as jest.Mock).mockImplementation(async (callback: (tx: any) => Promise<unknown>) =>
      callback({
        $executeRaw: txExecuteRaw,
      })
    );
    txExecuteRaw.mockResolvedValue(1);
    (prisma.$executeRaw as jest.Mock).mockResolvedValue(1);
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
});
