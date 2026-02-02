// ========== Sentry 初始化（必須在最開始）==========
import * as Sentry from "@sentry/node";

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || "development",
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
    // 過濾不需要追蹤的錯誤
    ignoreErrors: ["ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND"],
  });
  console.log("✅ Sentry 錯誤追蹤已啟用");
}

// 過濾 Twurple rate-limiter 警告（來自底層套件，無法通過 logger 配置隱藏）
const originalWarn = console.warn;
console.warn = (...args: unknown[]) => {
  const message = args[0];
  if (typeof message === "string" && message.includes("rate-limit")) {
    return; // 忽略 rate-limit 相關警告
  }
  originalWarn.apply(console, args);
};

import http from "http";
import app from "./app";
import { unifiedTwitchService } from "./services/unified-twitch.service";
import { chatListenerManager } from "./services/chat-listener-manager";
import { webSocketGateway } from "./services/websocket.gateway";
import { startAllJobs } from "./jobs";
import { twurpleEventSubService } from "./services/twurple-eventsub.service";
import { logger } from "./utils/logger";
import { memoryMonitor } from "./utils/memory-monitor";

const PORT = parseInt(process.env.PORT || '4000', 10);

const httpServer = http.createServer(app);

// 初始化 WebSocket
webSocketGateway.initialize(httpServer);

httpServer.listen(PORT, '0.0.0.0', async () => {
  console.log(`伺服器運行於 http://0.0.0.0:${PORT}`);
  console.log(`🚀 環境: ${process.env.NODE_ENV || "development"}`);
  console.log(`⚡ 記憶體優化: ${process.env.NODE_ENV === "production" ? "啟用" : "關閉"}`);

  // 優化：記錄啟動時記憶體使用
  const initialMemory = process.memoryUsage();
  console.log(`📊 初始記憶體: ${(initialMemory.heapUsed / 1024 / 1024).toFixed(2)}MB`);

  // 啟動記憶體監控（生產環境自動啟動，開發環境手動啟動）
  if (process.env.NODE_ENV !== "production") {
    memoryMonitor.start(60000); // 開發環境每分鐘檢查一次
  }

  // 延遲初始化：使用 setImmediate 避免啟動時記憶體峰值
  // 先讓 Express 伺服器完全啟動，再逐步載入背景服務
  setImmediate(async () => {
    try {
      // 0. 預熱 Prisma/Turso 連線（最重要，必須在 Job 啟動前完成）
      const { warmupConnection } = await import("./db/prisma");
      const connectionReady = await warmupConnection(3, 15000);
      if (!connectionReady) {
        logger.warn("Server", "Prisma 連線預熱失敗，Job 可能會遇到超時問題");
      }

      // 1. 先啟動定時任務（輕量級）- 但在生產環境延遲啟動
      if (process.env.NODE_ENV === "production") {
        // 生產環境：延遲 60 秒啟動定時任務，讓伺服器完全穩定後再啟動背景任務
        setTimeout(() => {
          // 檢查記憶體狀況，如果記憶體已經很高則跳過
          if (!memoryMonitor.isOverLimit()) {
            startAllJobs();
            logger.info("Server", "定時任務已啟動（延遲啟動）");
          } else {
            logger.warn("Server", "記憶體不足，跳過定時任務啟動");
          }
        }, 60000); // 從 30 秒增加到 60 秒
      } else {
        startAllJobs();
      }

      // 2. 初始化 Token 管理系統（必須在 Twitch 服務之前）
      setTimeout(async () => {
        try {
          const { initializeTokenManagement } = await import("./services/token-management.init");
          await initializeTokenManagement();
          logger.info("Server", "Token 管理系統初始化完成");
        } catch (error) {
          logger.error("Server", "Token 管理系統初始化失敗", error);
        }
      }, 1000);

      // 3. 延遲初始化 Twitch 服務
      // 生產環境：延遲 5 秒（讓健康檢查快速通過）
      // 開發環境：延遲 3 秒
      const twitchInitDelay = process.env.NODE_ENV === "production" ? 5000 : 3000;
      setTimeout(async () => {
        try {
          logger.info("Server", "正在初始化 Twitch 服務...");
          await unifiedTwitchService.initialize();
          await chatListenerManager.start();
          logger.info("Server", "Twitch 服務初始化完成");

          // 記錄初始化後的記憶體使用
          const afterInitMemory = process.memoryUsage();
          logger.info(
            "Server",
            `📊 初始化後記憶體: ${(afterInitMemory.heapUsed / 1024 / 1024).toFixed(2)}MB`
          );
        } catch (error) {
          logger.error("Server", "Twitch 服務初始化失敗", error);
        }
      }, twitchInitDelay);

      // 4. 延遲初始化 EventSub（如果啟用）
      const eventsubEnabled = process.env.EVENTSUB_ENABLED === "true";
      const eventsubSecret = process.env.EVENTSUB_SECRET;
      const eventsubCallbackUrl = process.env.EVENTSUB_CALLBACK_URL;

      if (eventsubEnabled && eventsubSecret && eventsubCallbackUrl) {
        // 生產環境：進一步延遲（15 秒），開發環境：10 秒
        const eventsubDelay = process.env.NODE_ENV === "production" ? 15000 : 10000;
        setTimeout(async () => {
          try {
            await twurpleEventSubService.initialize(app, {
              secret: eventsubSecret,
              hostName: eventsubCallbackUrl,
              pathPrefix: "/api/eventsub",
            });
            logger.info("Server", "Twurple EventSub 初始化成功");
          } catch (error) {
            logger.error("Server", "EventSub 初始化失敗", error);
          }
        }, eventsubDelay);
      } else {
        logger.info("Server", "EventSub 未啟用 (請設定 EVENTSUB_ENABLED=true 以啟用)");
      }
    } catch (error) {
      logger.error("Server", "背景服務初始化失敗", error);
    }
  });
});
