"use client";

import React, { useEffect, useState } from "react";
import { Socket } from "socket.io-client";
import { SocketContext, socketService } from "@/lib/socket";
import { useAuthSession } from "@/features/auth/AuthContext";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const { user } = useAuthSession();
  const t = useTranslations("common.notifications");

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
        const transport = newSocket.io.engine.transport.name;
        // 僅在第一次連線時顯示通知，避免過度干擾
        // toast.success(`已連線到即時服務 (${transport})`);
        setConnected(true);

        // 更換傳輸方式時記錄（通常是 polling -> websocket 升級）
        newSocket.io.engine.on("upgrade", (transport) => {
          console.log("Socket transport upgraded to:", transport.name);
        });
      });

      newSocket.on("disconnect", (reason) => {
        console.log("Socket disconnected:", reason);
        setConnected(false);
        if (reason === "io server disconnect") {
          // 伺服器主動斷線，需要手動重連
          newSocket.connect();
        }
      });

      newSocket.on("connect_error", (err) => {
        console.error("Socket connection error:", err.message);
        // 可以在這裡顯示連線錯誤通知
      });

      // 監聽直播事件
      newSocket.on(
        "stream.online",
        (data: {
          channelId: string;
          channelName: string;
          startedAt: string;
        }) => {
          console.log("Stream Online:", data);
          toast.success(`${data.channelName} ${t("streamOnline")}`, {
            description: t("clickToWatch"),
            action: {
              label: t("watchBtn"),
              onClick: () =>
                window.open(`https://twitch.tv/${data.channelName}`, "_blank"), // 使用 window.open
            },
            duration: 10000, // 顯示 10 秒
          });
        }
      );

      newSocket.on(
        "stream.offline",
        (data: { channelId: string; channelName: string }) => {
          console.log("Stream Offline:", data);
          toast.info(`${data.channelName} ${t("streamOffline")}`);
        }
      );

      newSocket.on(
        "channel.update",
        (data: {
          channelId: string;
          channelName: string;
          title: string;
          category: string;
        }) => {
          console.log("Channel Update:", data);
        }
      );

      // 監聽聊天室熱度
      newSocket.on(
        "chat.heat",
        (data: { channelName: string; heatLevel: number; message: string }) => {
          console.log("Chat Heat:", data);
          toast.warning(
            `${data.channelName} ${t("chatHeat")} 🔥 (${data.heatLevel}+ / 5s)`,
            {
              description: data.message, // 顯示最新的熱門訊息
              duration: 5000,
              className: "border-orange-500 bg-orange-50 dark:bg-orange-900/20", // 橙色邊框與背景
            }
          );
        }
      );

      // 監聽 Raid 事件
      newSocket.on(
        "stream.raid",
        (data: { channelName: string; raider: string; viewers: number }) => {
          console.log("Raid:", data);
          toast.success(`🚀 ${data.raider} → ${data.channelName}`, {
            description: `${t("raidAlert", {
              raider: data.raider,
              target: data.channelName,
            })} (${data.viewers} ${t("viewers")})`,
            duration: 8000,
            className: "border-purple-500 bg-purple-50 dark:bg-purple-900/20",
          });
        }
      );

      setSocket(newSocket);

      // 3. Cleanup: 當 user 改變或組件卸載時，斷開這個特定的連線
      return () => {
        newSocket.disconnect();
      };
    }
  }, [user, t]); // 加入 t 作為依賴

  return (
    <SocketContext.Provider value={{ socket, connected }}>
      {children}
    </SocketContext.Provider>
  );
}
