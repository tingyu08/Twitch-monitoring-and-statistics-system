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
    // 1. 如果沒有使用者，清空狀態並返回
    if (!user) {
      setSocket(null);
      setConnected(false);
      return;
    }

    // 2. 建立新連線 (使用局部變數，不依賴 state)
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

      // 3. Cleanup: 當 user 改變或組件卸載時，斷開這個特定的連線
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
