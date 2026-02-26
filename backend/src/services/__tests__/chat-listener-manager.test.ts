jest.mock("../twitch-chat.service", () => ({
  twurpleChatService: {
    joinChannel: jest.fn(),
    leaveChannel: jest.fn(),
    getStatus: jest.fn(),
  },
}));

jest.mock("../distributed-coordinator", () => ({
  distributedCoordinator: {
    start: jest.fn(),
    getInstanceId: jest.fn().mockReturnValue("inst-1"),
  },
}));

jest.mock("../../utils/logger", () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import { distributedCoordinator } from "../distributed-coordinator";
import { twurpleChatService } from "../twitch-chat.service";
import { logger } from "../../utils/logger";
import { ChatListenerManager } from "../chat-listener-manager";

describe("ChatListenerManager", () => {
  let manager: ChatListenerManager;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    (twurpleChatService.getStatus as jest.Mock).mockReturnValue({ connected: true });
    (twurpleChatService.joinChannel as jest.Mock).mockResolvedValue(undefined);
    (twurpleChatService.leaveChannel as jest.Mock).mockResolvedValue(undefined);
    manager = new ChatListenerManager();
  });

  afterEach(() => {
    manager.stop();
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it("starts and stops health check in standalone mode", async () => {
    await manager.start();

    expect(distributedCoordinator.start).not.toHaveBeenCalled();
    expect((manager as any).healthCheckInterval).not.toBeNull();

    manager.stop();
    expect((manager as any).healthCheckInterval).toBeNull();
  });

  it("starts distributed coordinator when distributed mode is enabled", async () => {
    const previousMode = process.env.ENABLE_DISTRIBUTED_MODE;
    try {
      process.env.ENABLE_DISTRIBUTED_MODE = "true";
      jest.resetModules();

      const freshModule = require("../chat-listener-manager");
      const freshCoordinatorModule = require("../distributed-coordinator");
      const freshManager = new freshModule.ChatListenerManager();

      await freshManager.start();

      expect(freshCoordinatorModule.distributedCoordinator.start).toHaveBeenCalledTimes(1);
      freshManager.stop();
    } finally {
      if (previousMode === undefined) {
        delete process.env.ENABLE_DISTRIBUTED_MODE;
      } else {
        process.env.ENABLE_DISTRIBUTED_MODE = previousMode;
      }

      jest.resetModules();
    }
  });

  it("requestListen updates existing channel info", async () => {
    await manager.requestListen("demo", { priority: 1, isLive: true });
    const ok = await manager.requestListen("#Demo", { priority: 5, isLive: false });

    expect(ok).toBe(true);
    expect(twurpleChatService.joinChannel).toHaveBeenCalledTimes(1);
    const channels = manager.getChannels();
    expect(channels).toHaveLength(1);
    expect(channels[0].priority).toBe(5);
    expect(channels[0].isLive).toBe(false);
  });

  it("requestListen keeps existing values when update options are omitted", async () => {
    await manager.requestListen("demo", { priority: 3, isLive: true });

    const ok = await manager.requestListen("demo");

    expect(ok).toBe(true);
    expect(twurpleChatService.joinChannel).toHaveBeenCalledTimes(1);
    const [info] = manager.getChannels();
    expect(info.priority).toBe(3);
    expect(info.isLive).toBe(true);
  });

  it("requestListen returns false when full and eviction fails", async () => {
    for (let i = 0; i < 80; i += 1) {
      (manager as any).channels.set(`c${i}`, {
        channelName: `c${i}`,
        isLive: true,
        lastActivity: new Date(),
        priority: 1,
        viewerCount: 0,
      });
    }

    const ok = await manager.requestListen("overflow");

    expect(ok).toBe(false);
    expect(twurpleChatService.leaveChannel).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      "ListenerManager",
      expect.stringContaining("無法加入頻道 overflow")
    );
  });

  it("requestListen evicts lowest-priority offline channel when full", async () => {
    for (let i = 0; i < 80; i += 1) {
      (manager as any).channels.set(`c${i}`, {
        channelName: `c${i}`,
        isLive: i !== 0,
        lastActivity: new Date(),
        priority: i === 0 ? 0 : 5,
        viewerCount: 0,
      });
    }

    const ok = await manager.requestListen("new-channel", { isLive: true });

    expect(ok).toBe(true);
    expect(twurpleChatService.leaveChannel).toHaveBeenCalledWith("c0");
    expect(twurpleChatService.joinChannel).toHaveBeenCalledWith("new-channel");
  });

  it("requestListen handles joinChannel failure", async () => {
    (twurpleChatService.joinChannel as jest.Mock).mockRejectedValueOnce(new Error("join failed"));

    const ok = await manager.requestListen("demo");

    expect(ok).toBe(false);
    expect(logger.error).toHaveBeenCalledWith(
      "ListenerManager",
      "加入頻道失敗: demo",
      expect.any(Error)
    );
  });

  it("stopListening removes known channel and ignores unknown channel", async () => {
    await manager.requestListen("demo");
    await manager.stopListening("#demo");
    await manager.stopListening("unknown");

    expect(twurpleChatService.leaveChannel).toHaveBeenCalledTimes(1);
    expect(manager.getChannels()).toHaveLength(0);
  });

  it("updateChannelStatus updates status and decrements offline priority", async () => {
    await manager.requestListen("demo", { priority: 2, isLive: true });

    manager.updateChannelStatus("#demo", false, 123);

    const [info] = manager.getChannels();
    expect(info.isLive).toBe(false);
    expect(info.viewerCount).toBe(123);
    expect(info.priority).toBe(1);
  });

  it("updateChannelStatus ignores unknown channel", () => {
    manager.updateChannelStatus("missing", false, 999);

    expect(manager.getChannels()).toHaveLength(0);
  });

  it("updateChannelStatus does not change priority for live status or zero-priority offline", async () => {
    await manager.requestListen("live-channel", { priority: 2, isLive: false });
    await manager.requestListen("offline-zero", { priority: 0, isLive: false });

    manager.updateChannelStatus("live-channel", true);
    manager.updateChannelStatus("offline-zero", false);

    const channels = manager.getChannels();
    const liveInfo = channels.find((channel) => channel.channelName === "live-channel");
    const zeroInfo = channels.find((channel) => channel.channelName === "offline-zero");

    expect(liveInfo?.priority).toBe(2);
    expect(liveInfo?.viewerCount).toBe(0);
    expect(liveInfo?.isLive).toBe(true);
    expect(zeroInfo?.priority).toBe(0);
    expect(zeroInfo?.isLive).toBe(false);
  });

  it("performHealthCheck removes inactive offline channels", async () => {
    await manager.requestListen("offline-old", { isLive: false });
    await manager.requestListen("live-keep", { isLive: true });

    const old = new Date(Date.now() - 31 * 60 * 1000);
    (manager as any).channels.get("offline-old").lastActivity = old;

    (manager as any).performHealthCheck();
    await Promise.resolve();

    expect(twurpleChatService.leaveChannel).toHaveBeenCalledWith("offline-old");
    expect(logger.info).toHaveBeenCalledWith("ListenerManager", "自動停止非活躍頻道: offline-old");
    expect(logger.info).toHaveBeenCalledWith("ListenerManager", "健康檢查: 已移除 1 個非活躍頻道");
  });

  it("performHealthCheck marks unhealthy when service throws", () => {
    (twurpleChatService.getStatus as jest.Mock).mockImplementationOnce(() => {
      throw new Error("status failed");
    });

    (manager as any).performHealthCheck();

    expect((manager as any).isHealthy).toBe(false);
    expect(logger.error).toHaveBeenCalledWith("ListenerManager", "健康檢查失敗", expect.any(Error));
  });

  it("logs error when async stopListening fails in health check", async () => {
    await manager.requestListen("offline-old", { isLive: false });
    const old = new Date(Date.now() - 31 * 60 * 1000);
    (manager as any).channels.get("offline-old").lastActivity = old;

    jest.spyOn(manager, "stopListening").mockRejectedValueOnce(new Error("stop failed"));

    (manager as any).performHealthCheck();
    await Promise.resolve();

    expect(logger.error).toHaveBeenCalledWith(
      "ListenerManager",
      "停止頻道失敗: offline-old",
      expect.any(Error)
    );
  });

  it("startHealthCheck returns early when interval already exists", () => {
    const setIntervalSpy = jest.spyOn(global, "setInterval");

    (manager as any).startHealthCheck();
    (manager as any).startHealthCheck();

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
  });

  it("health check interval callback invokes performHealthCheck", () => {
    const performHealthCheckSpy = jest
      .spyOn(manager as any, "performHealthCheck")
      .mockImplementation(() => undefined);

    (manager as any).startHealthCheck();
    expect(performHealthCheckSpy).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(5 * 60 * 1000);

    expect(performHealthCheckSpy).toHaveBeenCalledTimes(2);
  });

  it("getStats and getHealthStatus return expected summary", async () => {
    await manager.requestListen("a", { isLive: true });
    await manager.requestListen("b", { isLive: false });

    const stats = manager.getStats();
    expect(stats.totalChannels).toBe(2);
    expect(stats.activeChannels).toBe(1);
    expect(stats.pausedChannels).toBe(1);
    expect(stats.instanceId).toBe("standalone");

    (twurpleChatService.getStatus as jest.Mock).mockReturnValueOnce({ connected: false });
    expect(manager.getHealthStatus().status).toBe("unhealthy");

    (twurpleChatService.getStatus as jest.Mock).mockReturnValueOnce({ connected: true });
    for (let i = 0; i < 71; i += 1) {
      (manager as any).channels.set(`d${i}`, {
        channelName: `d${i}`,
        isLive: true,
        lastActivity: new Date(),
        priority: 1,
        viewerCount: 0,
      });
    }
    expect(manager.getHealthStatus().status).toBe("degraded");
  });

  it("returns healthy status when connected and listener count is below threshold", async () => {
    await manager.requestListen("healthy-channel", { isLive: true });
    (twurpleChatService.getStatus as jest.Mock).mockReturnValueOnce({ connected: true });

    const health = manager.getHealthStatus();

    expect(health.status).toBe("healthy");
    expect(health.details.connected).toBe(true);
  });

  it("getStats uses distributed instance id when distributed mode is enabled", async () => {
    const previousMode = process.env.ENABLE_DISTRIBUTED_MODE;
    try {
      process.env.ENABLE_DISTRIBUTED_MODE = "true";
      jest.resetModules();

      const freshModule = require("../chat-listener-manager");
      const freshManager = new freshModule.ChatListenerManager();

      const stats = freshManager.getStats();

      expect(stats.instanceId).toBe("inst-1");
    } finally {
      if (previousMode === undefined) {
        delete process.env.ENABLE_DISTRIBUTED_MODE;
      } else {
        process.env.ENABLE_DISTRIBUTED_MODE = previousMode;
      }

      jest.resetModules();
    }
  });
});
