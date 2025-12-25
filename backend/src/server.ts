// 過濾 Twurple rate-limiter 警告（來自底層套件，無法通過 logger 配置隱藏）
const originalWarn = console.warn;
console.warn = (...args: unknown[]) => {
  const message = args[0];
  if (typeof message === "string" && message.includes("rate-limit")) {
    return; // 忽略 rate-limit 相關警告
  }
  originalWarn.apply(console, args);
};

import app from "./app";
import { unifiedTwitchService } from "./services/unified-twitch.service";
import { chatListenerManager } from "./services/chat-listener-manager";
import { startAllJobs } from "./jobs";
import { twurpleEventSubService } from "./services/twurple-eventsub.service";
import { logger } from "./utils/logger";

const PORT = process.env.PORT || 4000;

app.listen(PORT, async () => {
  console.log(`伺服器運行於 http://localhost:${PORT}`);

  // 延遲初始化：使用 setImmediate 避免啟動時記憶體峰值
  // 先讓 Express 伺服器完全啟動，再逐步載入背景服務
  setImmediate(async () => {
    try {
      // 1. 先啟動定時任務（輕量級）
      startAllJobs();

      // 2. 延遲 3 秒後初始化 Twitch 服務（避免同時載入太多東西）
      setTimeout(async () => {
        try {
          logger.info("Server", "正在初始化 Twitch 服務...");
          await unifiedTwitchService.initialize();
          await chatListenerManager.start();
          logger.info("Server", "Twitch 服務初始化完成");
        } catch (error) {
          logger.error("Server", "Twitch 服務初始化失敗", error);
        }
      }, 3000);

      // 3. 延遲 10 秒後初始化 EventSub（如果啟用）
      const eventsubEnabled = process.env.EVENTSUB_ENABLED === "true";
      const eventsubSecret = process.env.EVENTSUB_SECRET;
      const eventsubCallbackUrl = process.env.EVENTSUB_CALLBACK_URL;

      if (eventsubEnabled && eventsubSecret && eventsubCallbackUrl) {
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
        }, 10000);
      } else {
        logger.info(
          "Server",
          "EventSub 未啟用 (請設定 EVENTSUB_ENABLED=true 以啟用)"
        );
      }
    } catch (error) {
      logger.error("Server", "背景服務初始化失敗", error);
    }
  });
});
