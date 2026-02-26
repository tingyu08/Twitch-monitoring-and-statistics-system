jest.mock("../../utils/logger", () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import { logger } from "../../utils/logger";
import { WebSocketGateway } from "../websocket.gateway";

describe("WebSocketGateway", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("emits batch updates to viewer room", () => {
    const emit = jest.fn();
    const to = jest.fn().mockReturnValue({ emit });
    const gateway = new WebSocketGateway();

    (gateway as any).io = { to };

    gateway.emitViewerStatsBatch("viewer-1", [
      { channelId: "c1", messageCountDelta: 2 },
      { channelId: "c2", messageCountDelta: 1 },
    ]);

    expect(to).toHaveBeenCalledWith("viewer:viewer-1");
    expect(emit).toHaveBeenCalledWith("stats-update-batch", {
      updates: [
        { channelId: "c1", messageCountDelta: 2 },
        { channelId: "c2", messageCountDelta: 1 },
      ],
    });
  });

  it("does nothing for empty batch", () => {
    const emit = jest.fn();
    const to = jest.fn().mockReturnValue({ emit });
    const gateway = new WebSocketGateway();

    (gateway as any).io = { to };

    gateway.emitViewerStatsBatch("viewer-1", []);

    expect(to).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it("broadcasts stream status to both room keys", () => {
    const events: Array<{ room: string; event: string; data: unknown }> = [];
    const to = jest.fn().mockImplementation((room: string) => ({
      emit: (event: string, data: unknown) => events.push({ room, event, data }),
    }));
    const gateway = new WebSocketGateway();
    (gateway as any).io = { to };

    gateway.broadcastStreamStatus("stream.online", {
      channelId: "ch-1",
      twitchChannelId: "tw-1",
      title: "live",
    });

    expect(events).toEqual([
      {
        room: "channel:ch-1",
        event: "stream.online",
        data: { channelId: "ch-1", twitchChannelId: "tw-1", title: "live" },
      },
      {
        room: "channel:tw-1",
        event: "stream.online",
        data: { channelId: "ch-1", twitchChannelId: "tw-1", title: "live" },
      },
    ]);
  });

  it("debounces channel.update and keeps latest payload per channel", () => {
    jest.useFakeTimers();

    const events: Array<{ room: string; event: string; data: unknown }> = [];
    const to = jest.fn().mockImplementation((room: string) => ({
      emit: (event: string, data: unknown) => events.push({ room, event, data }),
    }));
    const gateway = new WebSocketGateway();
    (gateway as any).io = { to };
    (gateway as any).CHANNEL_UPDATE_DEBOUNCE_MS = 10;

    gateway.broadcastStreamStatus("channel.update", { channelId: "ch-1", title: "old" });
    gateway.broadcastStreamStatus("channel.update", { channelId: "ch-1", title: "new" });

    expect(events).toHaveLength(0);

    jest.advanceTimersByTime(11);

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      room: "channel:ch-1",
      event: "channel.update",
      data: { channelId: "ch-1", title: "new" },
    });
  });

  it("broadcasts chat heat and raid to channel room", () => {
    const events: Array<{ room: string; event: string; data: unknown }> = [];
    const to = jest.fn().mockImplementation((room: string) => ({
      emit: (event: string, data: unknown) => events.push({ room, event, data }),
    }));
    const gateway = new WebSocketGateway();
    (gateway as any).io = { to };

    gateway.broadcastChatHeat({
      channelId: "ch-1",
      channelName: "demo",
      heatLevel: 88,
      message: "wow",
    });
    gateway.broadcastRaid({
      channelId: "ch-1",
      channelName: "demo",
      raider: "raider",
      viewers: 120,
    });

    expect(events).toEqual([
      {
        room: "channel:ch-1",
        event: "chat.heat",
        data: { channelId: "ch-1", channelName: "demo", heatLevel: 88, message: "wow" },
      },
      {
        room: "channel:ch-1",
        event: "stream.raid",
        data: { channelId: "ch-1", channelName: "demo", raider: "raider", viewers: 120 },
      },
    ]);
  });

  it("returns connection count and shuts down resources", async () => {
    const close = jest.fn().mockResolvedValue(undefined);
    const pubQuit = jest.fn().mockResolvedValue(undefined);
    const subQuit = jest.fn().mockResolvedValue(undefined);
    const gateway = new WebSocketGateway();

    (gateway as any).io = {
      sockets: { sockets: new Map([['a', {}], ['b', {}]]) },
      close,
    };
    (gateway as any).pubClient = { quit: pubQuit };
    (gateway as any).subClient = { quit: subQuit };

    expect(gateway.getConnectionCount()).toBe(2);
    await gateway.shutdown();

    expect(close).toHaveBeenCalledTimes(1);
    expect(pubQuit).toHaveBeenCalledTimes(1);
    expect(subQuit).toHaveBeenCalledTimes(1);
    expect(gateway.getConnectionCount()).toBe(0);
  });

  it("supports direct emit helpers and channel stats broadcast", () => {
    const emit = jest.fn();
    const to = jest.fn().mockReturnValue({ emit });
    const gateway = new WebSocketGateway();

    (gateway as any).io = { to, emit };

    gateway.broadcastChannelStats("ch-2", { messageCount: 3 });
    gateway.emitToViewer("v-1", "custom.event", { ok: true });
    gateway.emit("global.event", { hello: "world" });

    expect(to).toHaveBeenCalledWith("channel:ch-2");
    expect(to).toHaveBeenCalledWith("viewer:v-1");
    expect(emit).toHaveBeenCalledWith("stats-update", { channelId: "ch-2", messageCount: 3 });
    expect(emit).toHaveBeenCalledWith("custom.event", { ok: true });
    expect(emit).toHaveBeenCalledWith("global.event", { hello: "world" });
  });

  it("falls back to global emit when channel.update payload has no keys", () => {
    const emit = jest.fn();
    const to = jest.fn().mockReturnValue({ emit });
    const gateway = new WebSocketGateway();

    (gateway as any).io = { to, emit };

    gateway.broadcastStreamStatus("channel.update", { title: "no-id-update" });

    expect(emit).toHaveBeenCalledWith("channel.update", { title: "no-id-update" });
  });

  it("emits single viewer stats update", () => {
    const emit = jest.fn();
    const to = jest.fn().mockReturnValue({ emit });
    const gateway = new WebSocketGateway();

    (gateway as any).io = { to };

    gateway.emitViewerStats("viewer-2", { channelId: "c9", messageCountDelta: 7 });

    expect(to).toHaveBeenCalledWith("viewer:viewer-2");
    expect(emit).toHaveBeenCalledWith("stats-update", {
      channelId: "c9",
      messageCountDelta: 7,
    });
  });

  it("drops oldest pending channel updates when queue exceeds max", () => {
    jest.useFakeTimers();

    const events: Array<{ room: string; event: string; data: unknown }> = [];
    const to = jest.fn().mockImplementation((room: string) => ({
      emit: (event: string, data: unknown) => events.push({ room, event, data }),
    }));
    const gateway = new WebSocketGateway();

    (gateway as any).io = { to };
    (gateway as any).CHANNEL_UPDATE_DEBOUNCE_MS = 10;
    (gateway as any).MAX_PENDING_UPDATES = 2;

    gateway.broadcastStreamStatus("channel.update", { channelId: "ch-1", title: "first" });
    gateway.broadcastStreamStatus("channel.update", { channelId: "ch-2", title: "second" });
    gateway.broadcastStreamStatus("channel.update", { channelId: "ch-3", title: "third" });

    jest.advanceTimersByTime(11);

    const emittedChannelIds = events.map((entry) => (entry.data as { channelId: string }).channelId);
    expect(emittedChannelIds).toEqual(["ch-2", "ch-3"]);
  });

  it("clears pending channel updates when flush runs without io", () => {
    jest.useFakeTimers();

    const gateway = new WebSocketGateway();

    (gateway as any).pendingChannelUpdates.set("ch-1", { channelId: "ch-1" });
    (gateway as any).channelUpdateFlushTimer = setTimeout(() => undefined, 1000);
    (gateway as any).io = null;

    (gateway as any).flushChannelUpdates();

    expect((gateway as any).pendingChannelUpdates.size).toBe(0);
    expect((gateway as any).channelUpdateFlushTimer).toBeNull();
  });

  it("handles join/leave/viewer events and emits connected ack", () => {
    const handlers: Record<string, (...args: unknown[]) => void> = {};
    const socket = {
      id: "sock-1",
      on: jest.fn((event: string, cb: (...args: unknown[]) => void) => {
        handlers[event] = cb;
      }),
      join: jest.fn(),
      leave: jest.fn(),
      emit: jest.fn(),
    };
    const gateway = new WebSocketGateway();

    (gateway as any).handleConnection(socket);

    expect(socket.emit).toHaveBeenCalledWith("connected", { socketId: "sock-1" });

    handlers["join-channel"]("c1");
    handlers["join-channel"]({ channelId: "c2" });
    handlers["join-channel"]({});

    handlers["leave-channel"]("c1");
    handlers["leave-channel"]({ channelId: "c2" });
    handlers["leave-channel"]({});

    handlers["join-viewer"]("v1");
    handlers["join-viewer"]({ viewerId: "v2" });
    handlers["join-viewer"]({});

    handlers.disconnect("transport close");

    expect(socket.join).toHaveBeenCalledWith("channel:c1");
    expect(socket.join).toHaveBeenCalledWith("channel:c2");
    expect(socket.leave).toHaveBeenCalledWith("channel:c1");
    expect(socket.leave).toHaveBeenCalledWith("channel:c2");
    expect(socket.join).toHaveBeenCalledWith("viewer:v1");
    expect(socket.join).toHaveBeenCalledWith("viewer:v2");
    expect(logger.debug).toHaveBeenCalledWith("WebSocket", "Client connected: sock-1");
    expect(logger.debug).toHaveBeenCalledWith(
      "WebSocket",
      "Client disconnected: sock-1, reason: transport close"
    );
  });

  it("broadcastStreamStatus ignores stream events without identifiers", () => {
    const emit = jest.fn();
    const to = jest.fn().mockReturnValue({ emit });
    const gateway = new WebSocketGateway();

    (gateway as any).io = { to };

    gateway.broadcastStreamStatus("stream.online", { title: "noop" });

    expect(to).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it("flushes channel.update to both channelId and twitchChannelId rooms", () => {
    jest.useFakeTimers();

    const events: Array<{ room: string; event: string; data: unknown }> = [];
    const to = jest.fn().mockImplementation((room: string) => ({
      emit: (event: string, data: unknown) => events.push({ room, event, data }),
    }));
    const gateway = new WebSocketGateway();
    (gateway as any).io = { to };
    (gateway as any).CHANNEL_UPDATE_DEBOUNCE_MS = 10;

    gateway.broadcastStreamStatus("channel.update", {
      channelId: "ch-main",
      twitchChannelId: "tw-main",
      title: "update",
    });

    jest.advanceTimersByTime(11);

    expect(events).toEqual([
      {
        room: "channel:ch-main",
        event: "channel.update",
        data: { channelId: "ch-main", twitchChannelId: "tw-main", title: "update" },
      },
      {
        room: "channel:tw-main",
        event: "channel.update",
        data: { channelId: "ch-main", twitchChannelId: "tw-main", title: "update" },
      },
    ]);
  });

  it("handles pending-queue overflow when oldest key is missing", async () => {
    jest.useFakeTimers();

    const gateway = new WebSocketGateway();
    (gateway as any).io = {
      to: jest.fn().mockReturnValue({ emit: jest.fn() }),
      close: jest.fn().mockResolvedValue(undefined),
    };
    (gateway as any).MAX_PENDING_UPDATES = 2;

    const fakePending = {
      size: 3,
      set: jest.fn(),
      keys: jest.fn(() => ({ next: () => ({ value: undefined }) })),
      delete: jest.fn(),
      clear: jest.fn(),
      values: jest.fn(() => []),
    };
    (gateway as any).pendingChannelUpdates = fakePending;

    gateway.broadcastStreamStatus("channel.update", { channelId: "ch-x", title: "x" });

    expect(fakePending.set).toHaveBeenCalledWith("ch-x", { channelId: "ch-x", title: "x" });
    expect(fakePending.delete).not.toHaveBeenCalled();

    await gateway.shutdown();
  });

  it("shutdown clears flush timer and tolerates redis quit failures", async () => {
    jest.useFakeTimers();

    const clearTimeoutSpy = jest.spyOn(global, "clearTimeout");
    const gateway = new WebSocketGateway();
    const timer = setTimeout(() => undefined, 1000);

    (gateway as any).channelUpdateFlushTimer = timer;
    (gateway as any).pendingChannelUpdates.set("ch-1", { channelId: "ch-1" });
    (gateway as any).io = null;
    (gateway as any).pubClient = { quit: jest.fn().mockRejectedValue(new Error("pub fail")) };
    (gateway as any).subClient = { quit: jest.fn().mockRejectedValue(new Error("sub fail")) };

    await expect(gateway.shutdown()).resolves.toBeUndefined();

    expect(clearTimeoutSpy).toHaveBeenCalledWith(timer);
    expect((gateway as any).channelUpdateFlushTimer).toBeNull();
    expect((gateway as any).pendingChannelUpdates.size).toBe(0);
    expect((gateway as any).pubClient).toBeNull();
    expect((gateway as any).subClient).toBeNull();

    clearTimeoutSpy.mockRestore();
  });

  it("no-ops for guarded emit and broadcast methods when io is missing", () => {
    const gateway = new WebSocketGateway();
    (gateway as any).io = null;

    expect(() => gateway.broadcastChannelStats("ch-x", { messageCount: 1 })).not.toThrow();
    expect(() =>
      gateway.emitViewerStats("viewer-x", { channelId: "ch-x", messageCountDelta: 1 })
    ).not.toThrow();
    expect(() => gateway.emitToViewer("viewer-x", "custom", { ok: true })).not.toThrow();
    expect(() => gateway.broadcastStreamStatus("stream.offline", { channelId: "ch-x" })).not.toThrow();
    expect(() =>
      gateway.broadcastChatHeat({ channelId: "ch-x", channelName: "demo", heatLevel: 1, message: "m" })
    ).not.toThrow();
    expect(() =>
      gateway.broadcastRaid({ channelId: "ch-x", channelName: "demo", raider: "r", viewers: 1 })
    ).not.toThrow();
    expect(() => gateway.emit("evt", { x: 1 })).not.toThrow();
  });

  it("flushes channel.update to twitchChannelId room when channelId is absent", () => {
    jest.useFakeTimers();

    const events: Array<{ room: string; event: string; data: unknown }> = [];
    const to = jest.fn().mockImplementation((room: string) => ({
      emit: (event: string, data: unknown) => events.push({ room, event, data }),
    }));
    const gateway = new WebSocketGateway();
    (gateway as any).io = { to };
    (gateway as any).CHANNEL_UPDATE_DEBOUNCE_MS = 10;

    gateway.broadcastStreamStatus("channel.update", {
      twitchChannelId: "tw-only",
      title: "update",
    });

    jest.advanceTimersByTime(11);

    expect(events).toEqual([
      {
        room: "channel:tw-only",
        event: "channel.update",
        data: { twitchChannelId: "tw-only", title: "update" },
      },
    ]);
  });
});
