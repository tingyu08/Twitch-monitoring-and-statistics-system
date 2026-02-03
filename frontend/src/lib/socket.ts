import { createContext, useContext } from "react";
import type { Socket } from "socket.io-client";

// 使用環境變數或默認後端地址
export const SOCKET_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000";

interface SocketContextType {
  socket: Socket | null;
  connected: boolean;
  joinChannel: (channelId: string) => void;
  leaveChannel: (channelId: string) => void;
}

export const SocketContext = createContext<SocketContextType>({
  socket: null,
  connected: false,
  joinChannel: () => {},
  leaveChannel: () => {},
});

export const useSocket = () => useContext(SocketContext);

/**
 * Helper functions for room management
 * Used with the new Socket.IO room-based architecture
 */
export const socketRooms = {
  /**
   * Join a channel room to receive channel-specific events
   */
  joinChannel: (socket: Socket | null, channelId: string) => {
    if (socket?.connected) {
      socket.emit("join-channel", channelId);
      console.log(`[Socket] Joined channel room: ${channelId}`);
    }
  },

  /**
   * Leave a channel room
   */
  leaveChannel: (socket: Socket | null, channelId: string) => {
    if (socket?.connected) {
      socket.emit("leave-channel", channelId);
      console.log(`[Socket] Left channel room: ${channelId}`);
    }
  },

  /**
   * Join a viewer room to receive viewer-specific events
   */
  joinViewer: (socket: Socket | null, viewerId: string) => {
    if (socket?.connected) {
      socket.emit("join-viewer", viewerId);
      console.log(`[Socket] Joined viewer room: ${viewerId}`);
    }
  },
};
