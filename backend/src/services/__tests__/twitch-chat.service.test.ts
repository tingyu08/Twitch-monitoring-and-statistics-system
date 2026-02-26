jest.mock("../../utils/logger", () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock("../../db/prisma", () => ({
  prisma: {
    channel: {
      findFirst: jest.fn(),
    },
  },
}));

jest.mock("../websocket.gateway", () => ({
  webSocketGateway: {
    broadcastChatHeat: jest.fn(),
    broadcastRaid: jest.fn(),
  },
}));

jest.mock("../../modules/viewer/viewer-message.repository", () => ({
  viewerMessageRepository: {
    saveMessage: jest.fn(),
  },
}));

jest.mock("../../utils/crypto.utils", () => ({
  decryptToken: jest.fn(),
  encryptToken: jest.fn(),
}));

jest.mock("../../utils/dynamic-import", () => ({
  importTwurpleAuth: jest.fn(),
  importTwurpleChat: jest.fn(),
}));

import { prisma } from "../../db/prisma";
import { viewerMessageRepository } from "../../modules/viewer/viewer-message.repository";
import { logger } from "../../utils/logger";
import { webSocketGateway } from "../websocket.gateway";
import { TwurpleChatService } from "../twitch-chat.service";

describe("TwurpleChatService heat detection", () => {
  let nowMs = 1_000_000;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Date, "now").mockImplementation(() => nowMs);
    (prisma.channel.findFirst as jest.Mock).mockResolvedValue({ id: "channel-1" });
  });

  afterEach(async () => {
    jest.restoreAllMocks();
  });

  it("triggers chat heat alert and respects cooldown", async () => {
    const service = new TwurpleChatService();

    for (let i = 0; i < 50; i += 1) {
      await (service as any).checkChatHeat("demo", "hello world");
    }

    expect(webSocketGateway.broadcastChatHeat).toHaveBeenCalledTimes(1);
    expect(webSocketGateway.broadcastChatHeat).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: "channel-1",
        channelName: "demo",
        heatLevel: 50,
      })
    );

    nowMs += 1000;
    await (service as any).checkChatHeat("demo", "still hot");
    expect(webSocketGateway.broadcastChatHeat).toHaveBeenCalledTimes(1);

    nowMs += 31_000;
    for (let i = 0; i < 50; i += 1) {
      await (service as any).checkChatHeat("demo", "hot again");
    }

    expect(webSocketGateway.broadcastChatHeat).toHaveBeenCalledTimes(2);
    await service.disconnect();
  });

  it("compacts stale timestamps when sliding window index grows", async () => {
    const service = new TwurpleChatService();
    const channelName = "compact-channel";
    const stale = Array.from({ length: 200 }, (_, i) => nowMs - 10_000 + i);

    (service as any).messageTimestamps.set(channelName, stale);
    (service as any).heatWindowStartIndex.set(channelName, 150);

    await (service as any).checkChatHeat(channelName, "one fresh message");

    const timestamps = (service as any).messageTimestamps.get(channelName) as number[];
    const startIndex = (service as any).heatWindowStartIndex.get(channelName);

    expect(timestamps).toHaveLength(1);
    expect(startIndex).toBe(0);
    expect(webSocketGateway.broadcastChatHeat).not.toHaveBeenCalled();
    await service.disconnect();
  });

  it("skips heat alert when channel id lookup fails", async () => {
    const service = new TwurpleChatService();
    (prisma.channel.findFirst as jest.Mock).mockResolvedValueOnce(null);

    for (let i = 0; i < 50; i += 1) {
      await (service as any).checkChatHeat("missing-channel", "burst");
    }

    expect(webSocketGateway.broadcastChatHeat).not.toHaveBeenCalled();
    await service.disconnect();
  });

  it("cleanup removes stale channel heat data and cache entries", async () => {
    const service = new TwurpleChatService();
    const staleTs = [nowMs - 60_000, nowMs - 59_000];

    (service as any).messageTimestamps.set("stale", staleTs);
    (service as any).heatWindowStartIndex.set("stale", 1);
    (service as any).lastHeatAlert.set("stale", nowMs - 60_000);
    (service as any).channelIdCache.set("stale", "channel-stale");

    (service as any).cleanupStaleHeatData();

    expect((service as any).messageTimestamps.has("stale")).toBe(false);
    expect((service as any).heatWindowStartIndex.has("stale")).toBe(false);
    expect((service as any).lastHeatAlert.has("stale")).toBe(false);
    expect((service as any).channelIdCache.has("stale")).toBe(false);

    await service.disconnect();
  });

  it("reuses cached channel id without querying DB", async () => {
    const service = new TwurpleChatService();

    (service as any).channelIdCache.set("demo", "cached-1");
    const channelId = await (service as any).getChannelId("Demo");

    expect(channelId).toBe("cached-1");
    expect(prisma.channel.findFirst).not.toHaveBeenCalled();
    await service.disconnect();
  });

  it("evicts oldest channel cache entry when max size reached", async () => {
    const service = new TwurpleChatService();

    for (let i = 0; i < 500; i += 1) {
      (service as any).channelIdCache.set(`old-${i}`, `id-${i}`);
    }
    (prisma.channel.findFirst as jest.Mock).mockResolvedValueOnce({ id: "new-id" });

    const channelId = await (service as any).getChannelId("Newest");

    expect(channelId).toBe("new-id");
    expect((service as any).channelIdCache.has("old-0")).toBe(false);
    expect((service as any).channelIdCache.get("newest")).toBe("new-id");
    expect((service as any).channelIdCache.size).toBe(500);
    await service.disconnect();
  });

  it("cleanup removes orphaned lastHeatAlert entries", async () => {
    const service = new TwurpleChatService();

    (service as any).lastHeatAlert.set("orphan", nowMs - 1000);
    (service as any).cleanupStaleHeatData();

    expect((service as any).lastHeatAlert.has("orphan")).toBe(false);
    await service.disconnect();
  });

  it("parses normal message and triggers async heat check", async () => {
    const service = new TwurpleChatService();
    const heatSpy = jest.spyOn(service as any, "checkChatHeat").mockResolvedValue(undefined);

    (service as any).handleMessage("#Demo", "alice", "hello", {
      userInfo: {
        userId: "viewer-1",
        displayName: "Alice",
        badges: new Map<string, string>([["subscriber", "1"]]),
      },
      bits: 0,
      date: new Date("2026-02-26T10:00:00.000Z"),
      emoteOffsets: new Map<string, unknown>([["25", []]]),
    });

    expect(viewerMessageRepository.saveMessage).toHaveBeenCalledWith(
      "Demo",
      expect.objectContaining({
        viewerId: "viewer-1",
        username: "alice",
        displayName: "Alice",
        messageText: "hello",
        messageType: "CHAT",
      })
    );
    expect(heatSpy).toHaveBeenCalledWith("Demo", "hello");

    await service.disconnect();
  });

  it("handles message parsing/storage errors safely", async () => {
    const service = new TwurpleChatService();
    (viewerMessageRepository.saveMessage as jest.Mock).mockImplementationOnce(() => {
      throw new Error("save failed");
    });

    (service as any).handleMessage("#Demo", "alice", "hello", {
      userInfo: {
        userId: "viewer-1",
        displayName: "Alice",
        badges: new Map<string, string>(),
      },
      bits: 10,
      date: new Date("2026-02-26T10:00:00.000Z"),
      emoteOffsets: new Map<string, unknown>(),
    });

    expect(logger.error).toHaveBeenCalledWith(
      "Twurple Chat",
      "Error handling message",
      expect.any(Error)
    );

    await service.disconnect();
  });

  it("saves subscription and gift-sub events then performs heat check", async () => {
    const service = new TwurpleChatService();
    const heatSpy = jest.spyOn(service as any, "checkChatHeat").mockResolvedValue(undefined);

    (service as any).handleSubscription(
      "#demo",
      "user1",
      { displayName: "User One", message: "thanks" },
      null
    );
    (service as any).handleGiftSub(
      "#demo",
      "gifter",
      { displayName: "target", gifterDisplayName: "gifterName" },
      null
    );

    expect(viewerMessageRepository.saveMessage).toHaveBeenCalledWith(
      "demo",
      expect.objectContaining({
        viewerId: "user1",
        messageType: "SUBSCRIPTION",
        messageText: "thanks",
      })
    );
    expect(viewerMessageRepository.saveMessage).toHaveBeenCalledWith(
      "demo",
      expect.objectContaining({
        viewerId: "gifter",
        messageType: "GIFT_SUBSCRIPTION",
        messageText: "Gifted sub to target",
      })
    );
    expect(heatSpy).toHaveBeenCalledWith("demo", "New Subscription!");
    expect(heatSpy).toHaveBeenCalledWith("demo", "Gift Sub!");

    await service.disconnect();
  });

  it("broadcasts raid with resolved channel id and still checks heat", async () => {
    const service = new TwurpleChatService();
    const channelSpy = jest.spyOn(service as any, "getChannelId").mockResolvedValue("channel-raid");
    const heatSpy = jest.spyOn(service as any, "checkChatHeat").mockResolvedValue(undefined);

    await (service as any).handleRaid(
      "#demo",
      "raider",
      { viewerCount: 42, displayName: "RaidUser" },
      null
    );

    expect(channelSpy).toHaveBeenCalledWith("demo");
    expect(webSocketGateway.broadcastRaid).toHaveBeenCalledWith({
      channelId: "channel-raid",
      channelName: "demo",
      raider: "RaidUser",
      viewers: 42,
    });
    expect(heatSpy).toHaveBeenCalledWith("demo", "Raid from raider");

    await service.disconnect();
  });

  it("does not broadcast raid when channel id is missing", async () => {
    const service = new TwurpleChatService();
    jest.spyOn(service as any, "getChannelId").mockResolvedValue(null);
    const heatSpy = jest.spyOn(service as any, "checkChatHeat").mockResolvedValue(undefined);

    await (service as any).handleRaid(
      "#demo",
      "raider",
      { viewerCount: 99, displayName: "RaidUser" },
      null
    );

    expect(webSocketGateway.broadcastRaid).not.toHaveBeenCalled();
    expect(heatSpy).toHaveBeenCalledWith("demo", "Raid from raider");

    await service.disconnect();
  });
});
