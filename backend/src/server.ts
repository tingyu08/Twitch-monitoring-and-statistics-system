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

// ========== 優雅關閉處理 ==========
let isShuttingDown = false;

function gracefulShutdown(signal: string) {
  if (isShuttingDown) {
    console.log(`⚠️ 已經在關閉中，忽略 ${signal}`);
    return;
  }
  isShuttingDown = true;
  console.log(`\n🛑 收到 ${signal}，開始優雅關閉...`);

  // 給予 10 秒完成關閉
  const forceExitTimeout = setTimeout(() => {
    console.log("⚠️ 強制關閉（超時 10 秒）");
    process.exit(1);
  }, 10000);

  // 停止接受新連線
  httpServer.close(async () => {
    console.log("✅ HTTP 伺服器已關閉");
    
    try {
      // 停止聊天監聽器
      await chatListenerManager.stop();
      console.log("✅ 聊天監聽器已停止");
    } catch (error) {
      console.error("❌ 停止聊天監聽器失敗", error);
    }

    try {
      // 關閉資料庫連線
      const { prisma } = await import("./db/prisma");
      await prisma.$disconnect();
      console.log("✅ 資料庫連線已關閉");
    } catch (error) {
      console.error("❌ 關閉資料庫連線失敗", error);
    }

    clearTimeout(forceExitTimeout);
    console.log("🏁 優雅關閉完成");
    process.exit(0);
  });
}

// 註冊信號處理器
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// 處理未捕獲的錯誤
process.on("uncaughtException", (error) => {
  logger.error("Server", "未捕獲的例外", error);
  gracefulShutdown("uncaughtException");
});

process.on("unhandledRejection", (reason) => {
  logger.error("Server", "未處理的 Promise 拒絕", reason);
  // 不關閉，只記錄
});

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
      // 0. 預熱 Prisma/Turso 連線（在背景執行，不阻塞啟動）
      // 減少重試次數和超時時間，避免阻塞太久
      const { warmupConnection } = await import("./db/prisma");
      const connectionReady = await warmupConnection(2, 8000);
      if (!connectionReady) {
        logger.warn("Server", "Prisma 連線預熱失敗，將在首次請求時重試");
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
