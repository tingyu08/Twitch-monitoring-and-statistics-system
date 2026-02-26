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
    twitchToken: {
      findFirst: jest.fn(),
      update: jest.fn(),
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
import { decryptToken, encryptToken } from "../../utils/crypto.utils";
import { importTwurpleAuth, importTwurpleChat } from "../../utils/dynamic-import";
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

describe("TwurpleChatService initialize/join/leave lifecycle", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TWITCH_CLIENT_ID = "cid";
    process.env.TWITCH_CLIENT_SECRET = "csec";
    (importTwurpleChat as jest.Mock).mockResolvedValue({
      ChatClient: jest.fn().mockImplementation(() => ({
        onMessage: jest.fn(),
        onSub: jest.fn(),
        onResub: jest.fn(),
        onSubGift: jest.fn(),
        onRaid: jest.fn(),
        onDisconnect: jest.fn(),
        onConnect: jest.fn(),
        connect: jest.fn().mockResolvedValue(undefined),
        join: jest.fn().mockResolvedValue(undefined),
        part: jest.fn().mockResolvedValue(undefined),
        quit: jest.fn(),
      })),
    });
    (importTwurpleAuth as jest.Mock).mockResolvedValue({
      RefreshingAuthProvider: jest.fn().mockImplementation(() => ({
        onRefresh: jest.fn(),
        addUserForToken: jest.fn().mockResolvedValue(undefined),
      })),
    });
    (decryptToken as jest.Mock).mockImplementation((v: string) => `dec:${v}`);
    (encryptToken as jest.Mock).mockImplementation((v: string) => `enc:${v}`);
    (prisma.twitchToken.findFirst as jest.Mock).mockResolvedValue({
      id: "token-1",
      accessToken: "a1",
      refreshToken: "r1",
      expiresAt: new Date(Date.now() + 3600_000),
      updatedAt: new Date(Date.now() - 1000),
      streamer: {
        displayName: "Owner",
        channels: [{ channelName: "owner_channel" }],
      },
    });
    (prisma.twitchToken.update as jest.Mock).mockResolvedValue(undefined);
  });

  it("warns and exits when no token record exists", async () => {
    const service = new TwurpleChatService();
    (prisma.twitchToken.findFirst as jest.Mock).mockResolvedValueOnce(null);

    await service.initialize();

    expect(logger.warn).toHaveBeenCalledWith(
      "Twurple Chat",
      "No user token found in database. Please login first. Chat listener disabled."
    );
    expect((service as any).chatClient).toBeNull();
    await service.disconnect();
  });

  it("warns and exits when twitch credentials are missing", async () => {
    const service = new TwurpleChatService();
    process.env.TWITCH_CLIENT_ID = "";
    process.env.TWITCH_CLIENT_SECRET = "";

    await service.initialize();

    expect(logger.warn).toHaveBeenCalledWith(
      "Twurple Chat",
      "Missing TWITCH_CLIENT_ID or TWITCH_CLIENT_SECRET. Chat listener disabled."
    );
    await service.disconnect();
  });

  it("initializes chat client, registers handlers, and auto-joins owner channel", async () => {
    const service = new TwurpleChatService();
    const fakeChatClient = {
      onMessage: jest.fn(),
      onSub: jest.fn(),
      onResub: jest.fn(),
      onSubGift: jest.fn(),
      onRaid: jest.fn(),
      onDisconnect: jest.fn(),
      onConnect: jest.fn(),
      connect: jest.fn().mockResolvedValue(undefined),
      join: jest.fn().mockResolvedValue(undefined),
      part: jest.fn().mockResolvedValue(undefined),
      quit: jest.fn(),
    };
    const provider = {
      onRefresh: jest.fn(),
      addUserForToken: jest.fn().mockResolvedValue(undefined),
    };

    (importTwurpleChat as jest.Mock).mockResolvedValue({
      ChatClient: jest.fn().mockImplementation(() => fakeChatClient),
    });
    (importTwurpleAuth as jest.Mock).mockResolvedValue({
      RefreshingAuthProvider: jest.fn().mockImplementation(() => provider),
    });

    await service.initialize();

    expect(fakeChatClient.connect).toHaveBeenCalledTimes(1);
    expect(fakeChatClient.join).toHaveBeenCalledWith("owner_channel");
    expect(provider.addUserForToken).toHaveBeenCalledTimes(1);
    expect(service.getStatus().connected).toBe(true);
    expect(service.getStatus().channels).toContain("owner_channel");
    expect(decryptToken).toHaveBeenCalledWith("a1");
    expect(decryptToken).toHaveBeenCalledWith("r1");

    await service.disconnect();
    expect(fakeChatClient.quit).toHaveBeenCalledTimes(1);
  });

  it("retries initialize on retryable timeout errors", async () => {
    const service = new TwurpleChatService();
    const initSpy = jest
      .spyOn(service as any, "initializeInternal")
      .mockRejectedValueOnce(new Error("Connect Timeout"))
      .mockResolvedValueOnce(undefined);

    await service.initialize(2, 1);

    expect(initSpy).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      "Twurple Chat",
      expect.stringContaining("初始化失敗")
    );
    await service.disconnect();
  });

  it("stops initialize on non-retryable errors", async () => {
    const service = new TwurpleChatService();
    const initSpy = jest
      .spyOn(service as any, "initializeInternal")
      .mockRejectedValue(new Error("bad config"));

    await service.initialize(3, 1);

    expect(initSpy).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      "Twurple Chat",
      "連接 Twitch Chat 失敗 (嘗試 1 次)",
      expect.any(Error)
    );
    await service.disconnect();
  });

  it("registers connect/disconnect callbacks and updates state", async () => {
    const service = new TwurpleChatService();
    let onDisconnect: ((manually: boolean, reason: Error | undefined) => void) | undefined;
    let onConnect: (() => void) | undefined;
    const fakeChatClient = {
      onMessage: jest.fn(),
      onSub: jest.fn(),
      onResub: jest.fn(),
      onSubGift: jest.fn(),
      onRaid: jest.fn(),
      onDisconnect: jest.fn((cb: (manually: boolean, reason: Error | undefined) => void) => {
        onDisconnect = cb;
      }),
      onConnect: jest.fn((cb: () => void) => {
        onConnect = cb;
      }),
      connect: jest.fn(),
      join: jest.fn(),
      part: jest.fn(),
      quit: jest.fn(),
    };

    (service as any).chatClient = fakeChatClient;
    (service as any).setupEventHandlers();

    onDisconnect?.(false, new Error("socket down"));
    expect(service.getStatus().connected).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith("Twurple Chat", expect.stringContaining("已斷線"));

    onConnect?.();
    expect(service.getStatus().connected).toBe(true);
    expect(logger.info).toHaveBeenCalledWith("Twurple Chat", "已連接/重連");

    await service.disconnect();
  });

  it("joinChannel warns once when client not initialized", async () => {
    const service = new TwurpleChatService();

    await service.joinChannel("abc");
    await service.joinChannel("abc");

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      "Twurple Chat",
      "Chat client not initialized. Please login first."
    );
    await service.disconnect();
  });

  it("joinChannel retries timeout and eventually succeeds", async () => {
    const service = new TwurpleChatService();
    const timeoutSpy = jest
      .spyOn(global, "setTimeout")
      .mockImplementation((cb: TimerHandler) => {
        if (typeof cb === "function") cb();
        return 0 as unknown as NodeJS.Timeout;
      });
    const join = jest
      .fn()
      .mockRejectedValueOnce(new Error("Did not receive a reply"))
      .mockResolvedValueOnce(undefined);

    (service as any).chatClient = { join, quit: jest.fn() };

    await service.joinChannel("#AbC");

    expect(join).toHaveBeenCalledTimes(2);
    expect(service.getStatus().channels).toContain("abc");
    expect(logger.info).toHaveBeenCalledWith(
      "Twurple Chat",
      "Successfully joined channel abc after 1 retries"
    );
    await service.disconnect();
    timeoutSpy.mockRestore();
  });

  it("joinChannel logs warn after max timeout retries", async () => {
    const service = new TwurpleChatService();
    const timeoutSpy = jest
      .spyOn(global, "setTimeout")
      .mockImplementation((cb: TimerHandler) => {
        if (typeof cb === "function") cb();
        return 0 as unknown as NodeJS.Timeout;
      });
    const join = jest.fn().mockRejectedValue(new Error("Did not receive a reply"));

    (service as any).chatClient = { join, quit: jest.fn() };

    await service.joinChannel("abc");

    expect(join).toHaveBeenCalledTimes(3);
    expect(logger.warn).toHaveBeenCalledWith(
      "Twurple Chat",
      "Failed to join channel abc after 2 retries: IRC timeout"
    );
    await service.disconnect();
    timeoutSpy.mockRestore();
  });

  it("leaveChannel logs error when part fails", async () => {
    const service = new TwurpleChatService();
    const part = jest.fn().mockRejectedValue(new Error("part failed"));

    (service as any).chatClient = { part, quit: jest.fn() };
    (service as any).channels.add("abc");

    await service.leaveChannel("#AbC");

    expect(logger.error).toHaveBeenCalledWith(
      "Twurple Chat",
      "Failed to leave channel abc",
      expect.any(Error)
    );
    await service.disconnect();
  });

  it("extract helpers return null on malformed payloads", async () => {
    const service = new TwurpleChatService();

    const badges = (service as any).extractBadges({
      userInfo: {
        badges: {
          forEach: () => {
            throw new Error("badges error");
          },
        },
      },
    });
    const emotes = (service as any).extractEmotes({
      get emoteOffsets() {
        throw new Error("emotes error");
      },
    });

    expect(badges).toBeNull();
    expect(emotes).toBeNull();
    await service.disconnect();
  });

  it("logs database lookup errors in getChannelId", async () => {
    const service = new TwurpleChatService();
    (prisma.channel.findFirst as jest.Mock).mockRejectedValueOnce(new Error("db boom"));

    const channelId = await (service as any).getChannelId("demo");

    expect(channelId).toBeNull();
    expect(logger.error).toHaveBeenCalledWith(
      "Twurple Chat",
      "Failed to lookup channelId for demo",
      expect.any(Error)
    );
    await service.disconnect();
  });

  it("updates token in onRefresh callback", async () => {
    const service = new TwurpleChatService();
    let refreshCallback:
      | ((userId: string, data: { accessToken: string; refreshToken?: string; expiresIn?: number }) => Promise<void>)
      | undefined;
    const provider = {
      onRefresh: jest.fn(
        (
          cb: (userId: string, data: { accessToken: string; refreshToken?: string; expiresIn?: number }) => Promise<void>
        ) => {
          refreshCallback = cb;
        }
      ),
      addUserForToken: jest.fn().mockResolvedValue(undefined),
    };
    const fakeChatClient = {
      onMessage: jest.fn(),
      onSub: jest.fn(),
      onResub: jest.fn(),
      onSubGift: jest.fn(),
      onRaid: jest.fn(),
      onDisconnect: jest.fn(),
      onConnect: jest.fn(),
      connect: jest.fn().mockResolvedValue(undefined),
      join: jest.fn().mockResolvedValue(undefined),
      part: jest.fn().mockResolvedValue(undefined),
      quit: jest.fn(),
    };

    (importTwurpleAuth as jest.Mock).mockResolvedValue({
      RefreshingAuthProvider: jest.fn().mockImplementation(() => provider),
    });
    (importTwurpleChat as jest.Mock).mockResolvedValue({
      ChatClient: jest.fn().mockImplementation(() => fakeChatClient),
    });

    await service.initialize();
    await refreshCallback?.("u1", {
      accessToken: "new-access",
      refreshToken: "new-refresh",
      expiresIn: 3600,
    });

    expect(logger.info).toHaveBeenCalledWith("Twurple Chat", "Token 已獲刷新: u1");
    expect(prisma.twitchToken.update).toHaveBeenCalledTimes(1);
    expect(encryptToken).toHaveBeenCalledWith("new-access");
    expect(encryptToken).toHaveBeenCalledWith("new-refresh");

    await service.disconnect();
  });

  it("wires message/sub/gift/raid handlers through setupEventHandlers callbacks", async () => {
    const service = new TwurpleChatService();
    let onMessage:
      | ((channel: string, user: string, text: string, msg: unknown) => void)
      | undefined;
    let onSub:
      | ((channel: string, user: string, subInfo: unknown, msg: unknown) => void)
      | undefined;
    let onResub:
      | ((channel: string, user: string, subInfo: unknown, msg: unknown) => void)
      | undefined;
    let onSubGift:
      | ((channel: string, user: string, subInfo: unknown, msg: unknown) => void)
      | undefined;
    let onRaid:
      | ((channel: string, user: string, raidInfo: unknown, msg: unknown) => void)
      | undefined;

    const fakeChatClient = {
      onMessage: jest.fn((cb: (channel: string, user: string, text: string, msg: unknown) => void) => {
        onMessage = cb;
      }),
      onSub: jest.fn((cb: (channel: string, user: string, subInfo: unknown, msg: unknown) => void) => {
        onSub = cb;
      }),
      onResub: jest.fn((cb: (channel: string, user: string, subInfo: unknown, msg: unknown) => void) => {
        onResub = cb;
      }),
      onSubGift: jest.fn((cb: (channel: string, user: string, subInfo: unknown, msg: unknown) => void) => {
        onSubGift = cb;
      }),
      onRaid: jest.fn((cb: (channel: string, user: string, raidInfo: unknown, msg: unknown) => void) => {
        onRaid = cb;
      }),
      onDisconnect: jest.fn(),
      onConnect: jest.fn(),
      connect: jest.fn(),
      join: jest.fn(),
      part: jest.fn(),
      quit: jest.fn(),
    };

    const messageSpy = jest.spyOn(service as any, "handleMessage").mockImplementation(() => undefined);
    const subSpy = jest
      .spyOn(service as any, "handleSubscription")
      .mockImplementation(() => undefined);
    const giftSpy = jest.spyOn(service as any, "handleGiftSub").mockImplementation(() => undefined);
    const raidSpy = jest.spyOn(service as any, "handleRaid").mockResolvedValue(undefined);

    (service as any).chatClient = fakeChatClient;
    (service as any).setupEventHandlers();

    onMessage?.("#d", "u", "txt", {});
    onSub?.("#d", "u", { displayName: "x", message: "y" }, null);
    onResub?.("#d", "u2", { displayName: "x2", message: "y2" }, null);
    onSubGift?.("#d", "g", { displayName: "t", gifterDisplayName: "gd" }, null);
    await onRaid?.("#d", "r", { viewerCount: 3, displayName: "rd" }, null);

    expect(messageSpy).toHaveBeenCalledTimes(1);
    expect(subSpy).toHaveBeenCalledTimes(2);
    expect(giftSpy).toHaveBeenCalledTimes(1);
    expect(raidSpy).toHaveBeenCalledTimes(1);

    await service.disconnect();
  });

  it("joinChannel logs non-timeout errors", async () => {
    const service = new TwurpleChatService();
    const join = jest.fn().mockRejectedValue(new Error("forbidden"));

    (service as any).chatClient = { join, quit: jest.fn() };
    await service.joinChannel("abc");

    expect(logger.error).toHaveBeenCalledWith(
      "Twurple Chat",
      "Failed to join channel abc",
      expect.any(Error)
    );
    await service.disconnect();
  });

  it("leaveChannel succeeds and removes channel from set", async () => {
    const service = new TwurpleChatService();
    const part = jest.fn().mockResolvedValue(undefined);

    (service as any).chatClient = { part, quit: jest.fn() };
    (service as any).channels.add("abc");

    await service.leaveChannel("#AbC");

    expect(part).toHaveBeenCalledWith("abc");
    expect(service.getStatus().channels).not.toContain("abc");
    await service.disconnect();
  });

  it("logs async heat-check errors for message/sub/gift paths", async () => {
    const service = new TwurpleChatService();
    jest
      .spyOn(service as any, "checkChatHeat")
      .mockRejectedValue(new Error("heat async failed"));

    (service as any).handleMessage("#demo", "u", "hello", {
      userInfo: { userId: "u1", displayName: "U", badges: new Map<string, string>() },
      bits: 0,
      date: new Date(),
      emoteOffsets: new Map<string, unknown>(),
    });
    (service as any).handleSubscription("#demo", "u", { displayName: "U", message: "m" }, null);
    (service as any).handleGiftSub(
      "#demo",
      "u",
      { displayName: "Target", gifterDisplayName: "Gifter" },
      null
    );

    await Promise.resolve();

    expect(logger.error).toHaveBeenCalledWith(
      "Twurple Chat",
      "Error in heat check",
      expect.any(Error)
    );
    await service.disconnect();
  });

  it("handles subscription/gift parsing failures", async () => {
    const service = new TwurpleChatService();
    (viewerMessageRepository.saveMessage as jest.Mock)
      .mockImplementationOnce(() => {
        throw new Error("sub fail");
      })
      .mockImplementationOnce(() => {
        throw new Error("gift fail");
      });

    (service as any).handleSubscription("#demo", "u", { displayName: "U", message: "m" }, null);
    (service as any).handleGiftSub(
      "#demo",
      "u",
      { displayName: "Target", gifterDisplayName: "Gifter" },
      null
    );

    expect(logger.error).toHaveBeenCalledWith(
      "Twurple Chat",
      "Error handling subscription",
      expect.any(Error)
    );
    expect(logger.error).toHaveBeenCalledWith(
      "Twurple Chat",
      "Error handling gift sub",
      expect.any(Error)
    );
    await service.disconnect();
  });

  it("limits timestamp overflow and adjusts start index", async () => {
    const service = new TwurpleChatService();
    const channelName = "overflow-channel";
    const timestamps = Array.from({ length: 1001 }, (_, i) => i + 1);

    (service as any).messageTimestamps.set(channelName, timestamps);
    (service as any).heatWindowStartIndex.set(channelName, 10);

    await (service as any).checkChatHeat(channelName, "fresh");

    const nextTimestamps = (service as any).messageTimestamps.get(channelName) as number[];
    const startIndex = (service as any).heatWindowStartIndex.get(channelName);

    expect(nextTimestamps.length).toBeLessThanOrEqual(1000);
    expect(startIndex).toBeGreaterThanOrEqual(0);
    await service.disconnect();
  });

  it("handles raid path errors", async () => {
    const service = new TwurpleChatService();
    jest
      .spyOn(service as any, "checkChatHeat")
      .mockRejectedValue(new Error("raid heat failed"));
    jest.spyOn(service as any, "getChannelId").mockResolvedValue("c1");

    await (service as any).handleRaid(
      "#demo",
      "raider",
      { viewerCount: 5, displayName: "Raider" },
      null
    );

    expect(logger.error).toHaveBeenCalledWith(
      "Twurple Chat",
      "Error handling raid",
      expect.any(Error)
    );
    await service.disconnect();
  });

  it("executes cleanup interval callback", async () => {
    jest.useFakeTimers();
    const cleanupSpy = jest
      .spyOn(TwurpleChatService.prototype as any, "cleanupStaleHeatData")
      .mockImplementation(() => undefined);
    const service = new TwurpleChatService();

    jest.advanceTimersByTime(30_001);

    expect(cleanupSpy).toHaveBeenCalled();
    await service.disconnect();
    cleanupSpy.mockRestore();
  });

  it("initializeInternal returns early when token exists but refreshToken is null", async () => {
    const service = new TwurpleChatService();
    (prisma.twitchToken.findFirst as jest.Mock).mockResolvedValueOnce({
      id: "token-2",
      accessToken: "a2",
      refreshToken: null,
      streamer: { displayName: "Owner", channels: [{ channelName: "owner_channel" }] },
    });

    await (service as any).initializeInternal();

    expect(logger.warn).toHaveBeenCalledWith(
      "Twurple Chat",
      "No user token found in database. Please login first. Chat listener disabled."
    );
    await service.disconnect();
  });

  it("onRefresh uses fallback refreshToken and null expiresAt when fields missing", async () => {
    const service = new TwurpleChatService();
    let refreshCallback:
      | ((userId: string, data: { accessToken: string; refreshToken?: string; expiresIn?: number }) => Promise<void>)
      | undefined;
    const provider = {
      onRefresh: jest.fn(
        (
          cb: (userId: string, data: { accessToken: string; refreshToken?: string; expiresIn?: number }) => Promise<void>
        ) => {
          refreshCallback = cb;
        }
      ),
      addUserForToken: jest.fn().mockResolvedValue(undefined),
    };
    const fakeChatClient = {
      onMessage: jest.fn(),
      onSub: jest.fn(),
      onResub: jest.fn(),
      onSubGift: jest.fn(),
      onRaid: jest.fn(),
      onDisconnect: jest.fn(),
      onConnect: jest.fn(),
      connect: jest.fn().mockResolvedValue(undefined),
      join: jest.fn().mockResolvedValue(undefined),
      part: jest.fn().mockResolvedValue(undefined),
      quit: jest.fn(),
    };

    (importTwurpleAuth as jest.Mock).mockResolvedValue({
      RefreshingAuthProvider: jest.fn().mockImplementation(() => provider),
    });
    (importTwurpleChat as jest.Mock).mockResolvedValue({
      ChatClient: jest.fn().mockImplementation(() => fakeChatClient),
    });

    await service.initialize();
    await refreshCallback?.("u2", {
      accessToken: "new-access-2",
    });

    expect(prisma.twitchToken.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          refreshToken: "r1",
          expiresAt: null,
        }),
      })
    );
    await service.disconnect();
  });

  it("setupEventHandlers returns immediately when chat client is null", async () => {
    const service = new TwurpleChatService();
    (service as any).chatClient = null;

    expect(() => (service as any).setupEventHandlers()).not.toThrow();
    await service.disconnect();
  });

  it("disconnect handler does not warn on manual disconnect", async () => {
    const service = new TwurpleChatService();
    let onDisconnect: ((manually: boolean, reason: Error | undefined) => void) | undefined;
    const fakeChatClient = {
      onMessage: jest.fn(),
      onSub: jest.fn(),
      onResub: jest.fn(),
      onSubGift: jest.fn(),
      onRaid: jest.fn(),
      onDisconnect: jest.fn((cb: (manually: boolean, reason: Error | undefined) => void) => {
        onDisconnect = cb;
      }),
      onConnect: jest.fn(),
      connect: jest.fn(),
      join: jest.fn(),
      part: jest.fn(),
      quit: jest.fn(),
    };

    (service as any).chatClient = fakeChatClient;
    (service as any).setupEventHandlers();

    onDisconnect?.(true, new Error("manual"));

    expect(logger.warn).not.toHaveBeenCalledWith("Twurple Chat", expect.stringContaining("已斷線"));
    await service.disconnect();
  });

  it("joinChannel skips when channel already joined", async () => {
    const service = new TwurpleChatService();
    const join = jest.fn();

    (service as any).chatClient = { join, quit: jest.fn() };
    (service as any).channels.add("abc");

    await service.joinChannel("#AbC");

    expect(join).not.toHaveBeenCalled();
    await service.disconnect();
  });

  it("leaveChannel returns early when chat client is missing", async () => {
    const service = new TwurpleChatService();

    await expect(service.leaveChannel("abc")).resolves.toBeUndefined();
    await service.disconnect();
  });

  it("leaveChannel does not call part when channel not joined", async () => {
    const service = new TwurpleChatService();
    const part = jest.fn();

    (service as any).chatClient = { part, quit: jest.fn() };

    await service.leaveChannel("abc");

    expect(part).not.toHaveBeenCalled();
    await service.disconnect();
  });

  it("parses cheer message type and bits amount", async () => {
    const service = new TwurpleChatService();
    const heatSpy = jest.spyOn(service as any, "checkChatHeat").mockResolvedValue(undefined);

    (service as any).handleMessage("#demo", "u", "cheer", {
      userInfo: {
        userId: "u1",
        displayName: "U",
        badges: new Map<string, string>(),
      },
      bits: 100,
      date: new Date("2026-02-26T10:00:00.000Z"),
      emoteOffsets: new Map<string, unknown>(),
    });

    expect(viewerMessageRepository.saveMessage).toHaveBeenCalledWith(
      "demo",
      expect.objectContaining({
        messageType: "CHEER",
        bitsAmount: 100,
      })
    );
    expect(heatSpy).toHaveBeenCalledWith("demo", "cheer");
    await service.disconnect();
  });

  it("extract helpers return null for empty collections", async () => {
    const service = new TwurpleChatService();

    const badges = (service as any).extractBadges({
      userInfo: { badges: new Map<string, string>() },
    });
    const emotes = (service as any).extractEmotes({ emoteOffsets: new Map<string, unknown>() });

    expect(badges).toBeNull();
    expect(emotes).toBeNull();
    await service.disconnect();
  });

  it("disconnect clears cleanup interval and maps even without chat client", async () => {
    const service = new TwurpleChatService();

    (service as any).messageTimestamps.set("a", [1]);
    (service as any).lastHeatAlert.set("a", 1);
    (service as any).channelIdCache.set("a", "id");
    (service as any).chatClient = null;

    await service.disconnect();

    expect((service as any).cleanupInterval).toBeNull();
    expect((service as any).messageTimestamps.size).toBe(1);
    expect((service as any).lastHeatAlert.size).toBe(1);
    expect((service as any).channelIdCache.size).toBe(1);
  });

  it("startCleanupInterval works when timer has no unref", async () => {
    const setIntervalSpy = jest
      .spyOn(global, "setInterval")
      .mockImplementation((cb: TimerHandler) => {
        if (typeof cb === "function") cb();
        return {} as unknown as NodeJS.Timeout;
      });

    const service = new TwurpleChatService();

    expect(setIntervalSpy).toHaveBeenCalled();
    await service.disconnect();
    setIntervalSpy.mockRestore();
  });

  it("cleanupStaleHeatData keeps active channels and does not log when no cleanup", async () => {
    const service = new TwurpleChatService();
    const activeNow = Date.now();

    (service as any).messageTimestamps.set("active", [activeNow]);
    (service as any).lastHeatAlert.set("active", activeNow);

    (service as any).cleanupStaleHeatData();

    expect((service as any).messageTimestamps.has("active")).toBe(true);
    expect((service as any).lastHeatAlert.has("active")).toBe(true);
    expect(logger.debug).not.toHaveBeenCalledWith(
      "Twurple Chat",
      expect.stringContaining("Cleaned up heat data")
    );
    await service.disconnect();
  });

  it("cleanupStaleHeatData removes empty timestamp channels", async () => {
    const service = new TwurpleChatService();

    (service as any).messageTimestamps.set("empty", { length: 0 });
    (service as any).lastHeatAlert.set("empty", Date.now());

    (service as any).cleanupStaleHeatData();

    expect((service as any).messageTimestamps.has("empty")).toBe(false);
    expect((service as any).lastHeatAlert.has("empty")).toBe(false);
    await service.disconnect();
  });

  it("getChannelId still caches when oldest key is undefined", async () => {
    const service = new TwurpleChatService();
    const fakeCache = {
      size: 500,
      get: jest.fn().mockReturnValue(undefined),
      set: jest.fn(),
      delete: jest.fn(),
      keys: jest.fn(() => ({ next: () => ({ value: undefined }) })),
    };

    (service as any).channelIdCache = fakeCache;
    (prisma.channel.findFirst as jest.Mock).mockResolvedValueOnce({ id: "cached-id" });

    const id = await (service as any).getChannelId("Demo");

    expect(id).toBe("cached-id");
    expect(fakeCache.delete).not.toHaveBeenCalled();
    expect(fakeCache.set).toHaveBeenCalledWith("demo", "cached-id");
    await service.disconnect();
  });

  it("initialize logs error after exhausting retryable attempts", async () => {
    const service = new TwurpleChatService();
    const timeoutSpy = jest
      .spyOn(global, "setTimeout")
      .mockImplementation((cb: TimerHandler) => {
        if (typeof cb === "function") cb();
        return 0 as unknown as NodeJS.Timeout;
      });
    const initSpy = jest
      .spyOn(service as any, "initializeInternal")
      .mockRejectedValue(new Error("ETIMEDOUT"));

    await service.initialize(2, 1);

    expect(initSpy).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledWith(
      "Twurple Chat",
      "連接 Twitch Chat 失敗 (嘗試 2 次)",
      expect.any(Error)
    );

    timeoutSpy.mockRestore();
    await service.disconnect();
  });

  it("initialize handles non-Error thrown values", async () => {
    const service = new TwurpleChatService();
    jest.spyOn(service as any, "initializeInternal").mockRejectedValue("UND_ERR timeout");

    await service.initialize(1, 1);

    expect(logger.error).toHaveBeenCalledWith(
      "Twurple Chat",
      "連接 Twitch Chat 失敗 (嘗試 1 次)",
      "UND_ERR timeout"
    );
    await service.disconnect();
  });

  it("initializeInternal passes null expiresIn and skips auto-join when no channel", async () => {
    const service = new TwurpleChatService();
    const fakeChatClient = {
      onMessage: jest.fn(),
      onSub: jest.fn(),
      onResub: jest.fn(),
      onSubGift: jest.fn(),
      onRaid: jest.fn(),
      onDisconnect: jest.fn(),
      onConnect: jest.fn(),
      connect: jest.fn().mockResolvedValue(undefined),
      join: jest.fn(),
      part: jest.fn(),
      quit: jest.fn(),
    };
    const provider = {
      onRefresh: jest.fn(),
      addUserForToken: jest.fn().mockResolvedValue(undefined),
    };

    (prisma.twitchToken.findFirst as jest.Mock).mockResolvedValueOnce({
      id: "token-3",
      accessToken: "a3",
      refreshToken: "r3",
      expiresAt: null,
      updatedAt: new Date(),
      streamer: { displayName: "Owner", channels: [] },
    });
    (importTwurpleAuth as jest.Mock).mockResolvedValue({
      RefreshingAuthProvider: jest.fn().mockImplementation(() => provider),
    });
    (importTwurpleChat as jest.Mock).mockResolvedValue({
      ChatClient: jest.fn().mockImplementation(() => fakeChatClient),
    });

    await (service as any).initializeInternal();

    expect(provider.addUserForToken).toHaveBeenCalledWith(
      expect.objectContaining({ expiresIn: null }),
      ["chat"]
    );
    expect(fakeChatClient.join).not.toHaveBeenCalled();
    await service.disconnect();
  });

  it("uses fallback fields in subscription/gift/raid parsing", async () => {
    const service = new TwurpleChatService();
    const heatSpy = jest.spyOn(service as any, "checkChatHeat").mockResolvedValue(undefined);
    jest.spyOn(service as any, "getChannelId").mockResolvedValue("channel-xyz");

    (service as any).handleSubscription("#demo", "fallback-user", {} as any, {
      userInfo: { userId: "msg-user" },
    });
    (service as any).handleGiftSub("#demo", "gift-user", {} as any, {
      userInfo: { userId: "gift-msg-user" },
    });
    await (service as any).handleRaid("#demo", "raid-user", { viewerCount: 7 } as any, null);

    expect(viewerMessageRepository.saveMessage).toHaveBeenCalledWith(
      "demo",
      expect.objectContaining({
        viewerId: "msg-user",
        displayName: "fallback-user",
        messageText: "",
      })
    );
    expect(viewerMessageRepository.saveMessage).toHaveBeenCalledWith(
      "demo",
      expect.objectContaining({
        viewerId: "gift-msg-user",
        displayName: "gift-user",
        messageText: "Gifted sub to undefined",
      })
    );
    expect(viewerMessageRepository.saveMessage).toHaveBeenCalledWith(
      "demo",
      expect.objectContaining({
        displayName: "raid-user",
      })
    );
    expect(heatSpy).toHaveBeenCalledWith("demo", "Raid from raid-user");
    await service.disconnect();
  });

  it("extract helpers handle missing badge/emote data", async () => {
    const service = new TwurpleChatService();

    const badges = (service as any).extractBadges({ userInfo: {} });
    const emotes = (service as any).extractEmotes({});

    expect(badges).toBeNull();
    expect(emotes).toBeNull();
    await service.disconnect();
  });

  it("extractEmotes returns null when size positive but forEach yields no ids", async () => {
    const service = new TwurpleChatService();
    const emotes = (service as any).extractEmotes({
      emoteOffsets: {
        size: 1,
        forEach: () => undefined,
      },
    });

    expect(emotes).toBeNull();
    await service.disconnect();
  });

  it("checkChatHeat handles zero overflowCount branch", async () => {
    const service = new TwurpleChatService();
    const channelName = "zero-overflow";
    let lengthRead = 0;
    const fakeTimestamps: any = {
      0: Date.now(),
      push: jest.fn(),
      splice: jest.fn(),
      get length() {
        lengthRead += 1;
        if (lengthRead === 1) return 1001;
        if (lengthRead === 2) return 1000;
        return 1;
      },
    };

    (service as any).messageTimestamps.set(channelName, fakeTimestamps);
    (service as any).heatWindowStartIndex.set(channelName, 0);

    await (service as any).checkChatHeat(channelName, "x");

    expect(fakeTimestamps.splice).not.toHaveBeenCalled();
    await service.disconnect();
  });

  it("checkChatHeat uses default start index when overflow occurs and index missing", async () => {
    const service = new TwurpleChatService();
    const channelName = "overflow-default-index";
    const timestamps = Array.from({ length: 1001 }, (_, i) => Date.now() - 1000 + i);

    (service as any).messageTimestamps.set(channelName, timestamps);
    (service as any).heatWindowStartIndex.delete(channelName);

    await (service as any).checkChatHeat(channelName, "x");

    expect((service as any).heatWindowStartIndex.get(channelName)).toBe(0);
    await service.disconnect();
  });

  it("disconnect skips interval clear when cleanupInterval is null", async () => {
    const service = new TwurpleChatService();

    (service as any).cleanupInterval = null;
    (service as any).chatClient = { quit: jest.fn() };

    await service.disconnect();

    expect((service as any).chatClient.quit).toHaveBeenCalledTimes(1);
  });

  it("getStatus reflects channels and connected flag", async () => {
    const service = new TwurpleChatService();

    (service as any).isConnected = true;
    (service as any).channels.add("a");
    (service as any).channels.add("b");

    expect(service.getStatus()).toEqual({
      connected: true,
      channels: ["a", "b"],
      channelCount: 2,
    });
    await service.disconnect();
  });
});
