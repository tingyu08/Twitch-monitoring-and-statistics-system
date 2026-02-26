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
});
