/**
 * Extension Sync Hook
 * 負責偵測擴充功能並同步用戶資訊
 *
 * P0 Security: Now fetches dedicated JWT token instead of passing raw viewerId
 */

import { useEffect, useState, useCallback } from "react";
import { httpClient } from "@/lib/api/httpClient";

// P0 Security: Allowed origins for postMessage
const ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "https://twitch-monitoring-and-statistics-sy.vercel.app",
  "https://twitch-monitoring-and-statistics-system.vercel.app",
];

interface ExtensionStatus {
  isInstalled: boolean;
  isConnected: boolean;
}

interface ExtensionTokenResponse {
  token: string;
  expiresIn: number;
}

/**
 * 偵測並同步 Extension
 * @param userId 用戶 ID (viewerId) - used to trigger token fetch
 */
export function useExtensionSync(userId: string | null) {
  const [status, setStatus] = useState<ExtensionStatus>({
    isInstalled: false,
    isConnected: false,
  });

  // 監聽 Extension 回應
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // P0 Security: Validate origin instead of just checking source
      if (event.source !== window) return;
      // Only process messages from our own page context
      if (!ALLOWED_ORIGINS.includes(window.location.origin)) return;

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

  // P0 Security: Fetch dedicated JWT token and sync to extension
  const syncToExtension = useCallback(async () => {
    try {
      // Fetch dedicated extension JWT from backend
      const response = await httpClient<ExtensionTokenResponse>("/api/extension/token", {
        method: "POST",
      });

      if (response.token) {
        // P0 Security: Use specific origin instead of "*"
        window.postMessage(
          {
            type: "BMAD_SYNC_TOKEN",
            token: response.token, // Now sending JWT instead of raw viewerId
          },
          window.location.origin
        );
        console.log("[Bmad] Sent extension JWT to Extension");
      }
    } catch (error) {
      console.error("[Bmad] Failed to fetch extension token:", error);
    }
  }, []);

  // 當用戶登入且 Extension 已安裝時，同步 JWT token
  useEffect(() => {
    if (userId && status.isInstalled) {
      syncToExtension();
    }
  }, [userId, status.isInstalled, syncToExtension]);

  return {
    ...status,
    syncToExtension,
  };
}
