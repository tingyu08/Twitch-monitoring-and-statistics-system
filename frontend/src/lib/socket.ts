import { createContext, useContext, useEffect, useState } from "react";
import { io, Socket } from "socket.io-client";

// 使用環境變數或默認後端地址
// 注意：Socket.IO 路徑默認為 /socket.io，會自動附加到 URL 後面
const SOCKET_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

interface SocketContextType {
  socket: Socket | null;
  connected: boolean;
}

export const SocketContext = createContext<SocketContextType>({
  socket: null,
  connected: false,
});

export const useSocket = () => useContext(SocketContext);

export const socketService = {
  connect: () => {
    // 確保只在客戶端執行
    if (typeof window === "undefined") return null;

    // 如果已經有連線，則復用（這裡只做簡單示範，實際應該用 Context 管理單例）
    return io(SOCKET_URL, {
      withCredentials: true,
      transports: ["websocket", "polling"], // 優先使用 WebSocket
      path: "/socket.io",
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });
  },
};
