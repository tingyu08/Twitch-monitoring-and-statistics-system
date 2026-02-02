"use client";

import React, { useEffect, useCallback, useRef } from "react";
import type { Socket } from "socket.io-client";
import { SocketContext } from "@/lib/socket";
import { useAuthSession } from "@/features/auth/AuthContext";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { useWebSocket } from "@/hooks/useWebSocket";

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuthSession();
  const t = useTranslations("common.notifications");
  const joinedChannelsRef = useRef<Set<string>>(new Set());
  const joinedViewerRef = useRef<string | null>(null);
  const prevUserRef = useRef<typeof user>(null);

  // Event handlers for WebSocket lifecycle
  const handleConnect = useCallback(
    (socket: Socket) => {
      console.log("[SocketProvider] Connected:", socket.id);

      // Re-join rooms on reconnect
      if (user?.viewerId) {
        socket.emit("join-viewer", { viewerId: user.viewerId });
        joinedViewerRef.current = user.viewerId;
      }

      // Re-join any previously joined channels
      joinedChannelsRef.current.forEach((channelId) => {
        socket.emit("join-channel", channelId);
      });
    },
    [user?.viewerId]
  );

  const handleDisconnect = useCallback((reason: string) => {
    console.log("[SocketProvider] Disconnected:", reason);
  }, []);

  const handleReconnecting = useCallback((attempt: number, delayMs: number) => {
    console.log(`[SocketProvider] Reconnecting in ${delayMs}ms (attempt ${attempt})`);
  }, []);

  const handleError = useCallback((error: Error) => {
    console.error("[SocketProvider] Connection error:", error.message);
  }, []);

  // Initialize WebSocket with exponential backoff
  const { socket, connected, reconnectAttempt, connect, disconnect } = useWebSocket({
    autoConnect: false, // We'll connect manually when user is available
    onConnect: handleConnect,
    onDisconnect: handleDisconnect,
    onReconnecting: handleReconnecting,
    onError: handleError,
  });

  // Implement join/leave channel methods
  const joinChannel = useCallback(
    (channelId: string) => {
      if (!channelId) return;

      // Track joined channels locally
      if (!joinedChannelsRef.current.has(channelId)) {
        joinedChannelsRef.current.add(channelId);
        console.log(`[SocketProvider] Tracking channel join: ${channelId}`);

        if (socket?.connected) {
          // Backend expects a string ID, not an object
          socket.emit("join-channel", channelId);
        }
      }
    },
    [socket]
  );

  const leaveChannel = useCallback(
    (channelId: string) => {
      if (!channelId) return;

      if (joinedChannelsRef.current.has(channelId)) {
        joinedChannelsRef.current.delete(channelId);
        console.log(`[SocketProvider] Tracking channel leave: ${channelId}`);

        if (socket?.connected) {
          socket.emit("leave-channel", channelId);
        }
      }
    },
    [socket]
  );

  // Connect/disconnect based on user authentication - only when user actually changes
  useEffect(() => {
    const userChanged = prevUserRef.current !== user;
    const wasLoggedIn = !!prevUserRef.current;
    const isLoggedIn = !!user;

    prevUserRef.current = user;

    // Only act on actual user state changes
    if (!userChanged) return;

    if (isLoggedIn && !wasLoggedIn) {
      // User logged in
      connect();
    } else if (!isLoggedIn && wasLoggedIn) {
      // User logged out
      joinedChannelsRef.current.clear();
      joinedViewerRef.current = null;
      disconnect();
    }
  }, [user, connect, disconnect]);

  // Set up event listeners when socket is available
  useEffect(() => {
    if (!socket) return;

    // 監聽直播事件
    const handleStreamOnline = (data: {
      channelId: string;
      channelName: string;
      startedAt: string;
    }) => {
      console.log("Stream Online:", data);
      toast.success(`${data.channelName} ${t("streamOnline")}`, {
        description: t("clickToWatch"),
        action: {
          label: t("watchBtn"),
          onClick: () => window.open(`https://twitch.tv/${data.channelName}`, "_blank"),
        },
        duration: 10000,
      });
    };

    const handleStreamOffline = (data: { channelId: string; channelName: string }) => {
      console.log("Stream Offline:", data);
      toast.info(`${data.channelName} ${t("streamOffline")}`);
    };

    // P1 Optimization: channel.update removed - now handled by React Query refetchInterval

    // 監聯聊天室熱度
    const handleChatHeat = (data: { channelName: string; heatLevel: number; message: string }) => {
      console.log("Chat Heat:", data);
      toast.warning(`${data.channelName} ${t("chatHeat")} 🔥 (${data.heatLevel}+ / 5s)`, {
        description: data.message,
        duration: 5000,
        className: "border-orange-500 bg-orange-50 dark:bg-orange-900/20",
      });
    };

    // 監聽 Raid 事件
    const handleStreamRaid = (data: { channelName: string; raider: string; viewers: number }) => {
      console.log("Raid:", data);
      toast.success(`🚀 ${data.raider} → ${data.channelName}`, {
        description: `${t("raidAlert", {
          raider: data.raider,
          target: data.channelName,
        })} (${data.viewers} ${t("viewers")})`,
        duration: 8000,
        className: "border-purple-500 bg-purple-50 dark:bg-purple-900/20",
      });
    };

    // Register event listeners
    socket.on("stream.online", handleStreamOnline);
    socket.on("stream.offline", handleStreamOffline);
    socket.on("chat.heat", handleChatHeat);
    socket.on("stream.raid", handleStreamRaid);

    // Cleanup
    return () => {
      socket.off("stream.online", handleStreamOnline);
      socket.off("stream.offline", handleStreamOffline);
      socket.off("chat.heat", handleChatHeat);
      socket.off("stream.raid", handleStreamRaid);
    };
  }, [socket, t]);

  // Join viewer room when user changes
  useEffect(() => {
    if (socket && connected && user?.viewerId && joinedViewerRef.current !== user.viewerId) {
      socket.emit("join-viewer", { viewerId: user.viewerId });
      joinedViewerRef.current = user.viewerId;
    }
  }, [socket, connected, user?.viewerId]);

  // Log reconnection attempts for debugging
  useEffect(() => {
    if (reconnectAttempt > 0) {
      console.log(`[SocketProvider] Reconnection attempt: ${reconnectAttempt}`);
    }
  }, [reconnectAttempt]);

  return (
    <SocketContext.Provider value={{ socket, connected, joinChannel, leaveChannel }}>
      {children}
    </SocketContext.Provider>
  );
}
