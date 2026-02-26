jest.mock("socket.io", () => ({
  Server: jest.fn(),
}));

jest.mock("@socket.io/redis-adapter", () => ({
  createAdapter: jest.fn(),
}));

jest.mock("../../utils/logger", () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import { createAdapter } from "@socket.io/redis-adapter";
import { Server } from "socket.io";
import * as redisClient from "../../utils/redis-client";
import { logger } from "../../utils/logger";
import { WebSocketGateway } from "../websocket.gateway";

describe("WebSocketGateway initialize/setupRedisAdapter", () => {
  const createIo = () => ({
    on: jest.fn(),
    to: jest.fn(),
    emit: jest.fn(),
    adapter: jest.fn(),
    sockets: { sockets: new Map() },
    close: jest.fn().mockResolvedValue(undefined),
  });

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it("initialize wires socket server, connection handler, and setup warning path", async () => {
    const io = createIo();
    (Server as unknown as jest.Mock).mockReturnValue(io);

    const gateway = new WebSocketGateway();
    const setupSpy = jest
      .spyOn(gateway as any, "setupRedisAdapter")
      .mockRejectedValueOnce(new Error("redis init failed"));
    const handleSpy = jest.spyOn(gateway as any, "handleConnection");

    gateway.initialize({} as any);

    expect(Server).toHaveBeenCalledTimes(1);
    expect(io.on).toHaveBeenCalledWith("connection", expect.any(Function));
    expect(setupSpy).toHaveBeenCalledTimes(1);

    const fakeSocket = {
      id: "sock-1",
      on: jest.fn(),
      join: jest.fn(),
      leave: jest.fn(),
      emit: jest.fn(),
    } as any;
    const connectionHandler = io.on.mock.calls[0][1] as (socket: unknown) => void;
    connectionHandler(fakeSocket);
    expect(handleSpy).toHaveBeenCalledWith(fakeSocket);

    await Promise.resolve();

    expect(logger.warn).toHaveBeenCalledWith(
      "WebSocket",
      "setupRedisAdapter failed",
      expect.any(Error)
    );
    expect(logger.info).toHaveBeenCalledWith(
      "WebSocket",
      "Socket.IO Gateway initialized with room support"
    );
  });

  it("setupRedisAdapter enables redis adapter when redis is available", async () => {
    const io = createIo();
    const gateway = new WebSocketGateway();
    (gateway as any).io = io;

    const pubClient = {
      on: jest.fn(),
      connect: jest.fn().mockResolvedValue(undefined),
      quit: jest.fn().mockResolvedValue(undefined),
    };
    const subClient = {
      on: jest.fn(),
      connect: jest.fn().mockResolvedValue(undefined),
      quit: jest.fn().mockResolvedValue(undefined),
    };
    const baseClient = {
      duplicate: jest
        .fn()
        .mockImplementationOnce(() => pubClient)
        .mockImplementationOnce(() => subClient),
    };

    jest.spyOn(redisClient, "initRedis").mockResolvedValueOnce(true);
    jest.spyOn(redisClient, "getRedisClient").mockReturnValueOnce(baseClient as any);
    (createAdapter as jest.Mock).mockReturnValueOnce("adapter-instance");

    await (gateway as any).setupRedisAdapter();

    expect(redisClient.initRedis).toHaveBeenCalledTimes(1);
    expect(baseClient.duplicate).toHaveBeenCalledTimes(2);
    expect(pubClient.on).toHaveBeenCalledWith("error", expect.any(Function));
    expect(subClient.on).toHaveBeenCalledWith("error", expect.any(Function));
    expect(pubClient.connect).toHaveBeenCalledTimes(1);
    expect(subClient.connect).toHaveBeenCalledTimes(1);
    expect(createAdapter).toHaveBeenCalledWith(pubClient, subClient);
    expect(io.adapter).toHaveBeenCalledWith("adapter-instance");
    expect((gateway as any).pubClient).toBe(pubClient);
    expect((gateway as any).subClient).toBe(subClient);
  });

  it("setupRedisAdapter exits when redis is unavailable", async () => {
    const io = createIo();
    const gateway = new WebSocketGateway();
    (gateway as any).io = io;

    jest.spyOn(redisClient, "initRedis").mockResolvedValueOnce(false);
    const getRedisClientSpy = jest.spyOn(redisClient, "getRedisClient");

    await (gateway as any).setupRedisAdapter();

    expect(getRedisClientSpy).not.toHaveBeenCalled();
    expect(io.adapter).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      "WebSocket",
      "Redis adapter not enabled (Redis unavailable)"
    );
  });

  it("setupRedisAdapter handles duplicate/connect failures gracefully", async () => {
    const io = createIo();
    const gateway = new WebSocketGateway();
    (gateway as any).io = io;

    const pubClient = {
      on: jest.fn(),
      connect: jest.fn().mockRejectedValue(new Error("connect failed")),
      quit: jest.fn().mockResolvedValue(undefined),
    };
    const subClient = {
      on: jest.fn(),
      connect: jest.fn().mockResolvedValue(undefined),
      quit: jest.fn().mockResolvedValue(undefined),
    };
    const baseClient = {
      duplicate: jest
        .fn()
        .mockImplementationOnce(() => pubClient)
        .mockImplementationOnce(() => subClient),
    };

    jest.spyOn(redisClient, "initRedis").mockResolvedValueOnce(true);
    jest.spyOn(redisClient, "getRedisClient").mockReturnValueOnce(baseClient as any);

    await (gateway as any).setupRedisAdapter();

    expect(io.adapter).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      "WebSocket",
      "Failed to enable Redis adapter, using standalone mode",
      expect.any(Error)
    );
  });
});
