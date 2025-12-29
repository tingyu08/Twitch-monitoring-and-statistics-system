"use client";

import React, { useEffect, useState } from "react";
import { Socket } from "socket.io-client";
import { SocketContext, socketService } from "@/lib/socket";
import { useAuthSession } from "@/features/auth/AuthContext";

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const { user } = useAuthSession();

  useEffect(() => {
    // 只有登入用戶才連線 Socket
    if (!user) {
      if (socket) {
        socket.disconnect();
        setSocket(null);
        setConnected(false);
      }
      return;
    }

    // 如果已經有 socket 且已連接，不重複連線
    if (socket && socket.connected) return;

    const newSocket = socketService.connect();

    if (newSocket) {
      newSocket.on("connect", () => {
        console.log("Socket connected:", newSocket.id);
        setConnected(true);
      });

      newSocket.on("disconnect", () => {
        console.log("Socket disconnected");
        setConnected(false);
      });

      newSocket.on("connect_error", (err) => {
        console.error("Socket connection error:", err);
      });

      setSocket(newSocket);

      return () => {
        newSocket.disconnect();
      };
    }
  }, [user]);

  return (
    <SocketContext.Provider value={{ socket, connected }}>
      {children}
    </SocketContext.Provider>
  );
}
