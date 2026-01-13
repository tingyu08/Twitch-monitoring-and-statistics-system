/**
 * Extension Sync Hook
 * 負責偵測擴充功能並同步用戶資訊
 */

import { useEffect, useState, useCallback } from "react";

interface ExtensionStatus {
  isInstalled: boolean;
  isConnected: boolean;
}

/**
 * 偵測並同步 Extension
 * @param userId 用戶 ID (viewerId)
 */
export function useExtensionSync(userId: string | null) {
  const [status, setStatus] = useState<ExtensionStatus>({
    isInstalled: false,
    isConnected: false,
  });

  // 監聽 Extension 回應
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // 只接受來自同源的訊息
      if (event.source !== window) return;

      if (event.data?.type === "BMAD_EXTENSION_READY") {
        console.log("[Bmad] Extension detected");
        setStatus((prev) => ({ ...prev, isInstalled: true }));
      }

      if (event.data?.type === "BMAD_SYNC_SUCCESS") {
        console.log("[Bmad] Extension sync successful");
        setStatus((prev) => ({ ...prev, isConnected: true }));
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  // 當用戶登入且 Extension 已安裝時，同步 userId
  useEffect(() => {
    if (userId && status.isInstalled) {
      syncToExtension(userId);
    }
  }, [userId, status.isInstalled]);

  // 同步函數
  const syncToExtension = useCallback((id: string) => {
    window.postMessage(
      {
        type: "BMAD_SYNC_TOKEN",
        token: id, // 這裡傳送 viewerId 作為 token
      },
      "*"
    );
    console.log("[Bmad] Sent userId to Extension:", id);
  }, []);

  return {
    ...status,
    syncToExtension,
  };
}
