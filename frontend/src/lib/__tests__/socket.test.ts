import React from "react";
import { render } from "@testing-library/react";
import type { Socket } from "socket.io-client";

import { SocketContext, socketRooms, useSocket } from "../socket";

type UseSocketValue = ReturnType<typeof useSocket>;

const createMockSocket = (connected = true): Socket => {
  return {
    connected,
    emit: jest.fn(),
  } as unknown as Socket;
};

const HookConsumer = ({
  onRead,
}: {
  onRead: (value: UseSocketValue) => void;
}) => {
  const value = useSocket();
  onRead(value);
  return null;
};

describe("socket.ts", () => {
  let consoleLogSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  describe("useSocket", () => {
    it("returns default context value and keeps default handlers error-safe", () => {
      const onRead = jest.fn();

      render(React.createElement(HookConsumer, { onRead }));

      const value = onRead.mock.calls[0]?.[0] as UseSocketValue;
      expect(value.socket).toBeNull();
      expect(value.connected).toBe(false);
      expect(() => value.joinChannel("ch-1")).not.toThrow();
      expect(() => value.leaveChannel("ch-1")).not.toThrow();
    });

    it("returns provider value when wrapped by SocketContext.Provider", () => {
      const mockSocket = createMockSocket(true);
      const providedValue = {
        socket: mockSocket,
        connected: true,
        joinChannel: jest.fn(),
        leaveChannel: jest.fn(),
      };
      const onRead = jest.fn();

      render(
        React.createElement(
          SocketContext.Provider,
          { value: providedValue },
          React.createElement(HookConsumer, { onRead }),
        ),
      );

      expect(onRead).toHaveBeenCalledWith(providedValue);
    });
  });

  describe("socketRooms", () => {
    it("joinChannel emits and logs when socket is connected", () => {
      const socket = createMockSocket(true);

      socketRooms.joinChannel(socket, "channel-1");

      expect(socket.emit).toHaveBeenCalledWith("join-channel", "channel-1");
      expect(consoleLogSpy).toHaveBeenCalledWith("[Socket] Joined channel room: channel-1");
    });

    it("leaveChannel emits and logs when socket is connected", () => {
      const socket = createMockSocket(true);

      socketRooms.leaveChannel(socket, "channel-1");

      expect(socket.emit).toHaveBeenCalledWith("leave-channel", "channel-1");
      expect(consoleLogSpy).toHaveBeenCalledWith("[Socket] Left channel room: channel-1");
    });

    it("joinViewer emits and logs when socket is connected", () => {
      const socket = createMockSocket(true);

      socketRooms.joinViewer(socket, "viewer-1");

      expect(socket.emit).toHaveBeenCalledWith("join-viewer", "viewer-1");
      expect(consoleLogSpy).toHaveBeenCalledWith("[Socket] Joined viewer room: viewer-1");
    });

    it("does not emit or log when socket is disconnected", () => {
      const socket = createMockSocket(false);

      socketRooms.joinChannel(socket, "channel-1");
      socketRooms.leaveChannel(socket, "channel-1");
      socketRooms.joinViewer(socket, "viewer-1");

      expect(socket.emit).not.toHaveBeenCalled();
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it("is error-safe when socket is null", () => {
      expect(() => socketRooms.joinChannel(null, "channel-1")).not.toThrow();
      expect(() => socketRooms.leaveChannel(null, "channel-1")).not.toThrow();
      expect(() => socketRooms.joinViewer(null, "viewer-1")).not.toThrow();

      expect(consoleLogSpy).not.toHaveBeenCalled();
    });
  });
});
