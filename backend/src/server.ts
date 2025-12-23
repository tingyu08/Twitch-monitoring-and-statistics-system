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

  // 初始化所有 Twitch 服務（Chat + Helix API + DecAPI）
  await unifiedTwitchService.initialize();

  // 啟動聊天監聯器管理器（包含分佈式協調）
  await chatListenerManager.start();

  // 啟動所有定時任務（Cron Jobs）
  startAllJobs();

  // 初始化 Twurple EventSub（如果啟用）
  const eventsubEnabled = process.env.EVENTSUB_ENABLED === "true";
  const eventsubSecret = process.env.EVENTSUB_SECRET;
  const eventsubCallbackUrl = process.env.EVENTSUB_CALLBACK_URL;

  if (eventsubEnabled && eventsubSecret && eventsubCallbackUrl) {
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
  } else {
    logger.info(
      "Server",
      "EventSub 未啟用 (請設定 EVENTSUB_ENABLED=true 以啟用)"
    );
  }
});
