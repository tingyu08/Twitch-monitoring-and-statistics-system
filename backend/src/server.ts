import app from "./app";
import { unifiedTwitchService } from "./services/unified-twitch.service";
import { chatListenerManager } from "./services/chat-listener-manager";
import { startAllJobs } from "./jobs";

const PORT = process.env.PORT || 4000;

app.listen(PORT, async () => {
  console.log(`Server is running on http://localhost:${PORT}`);

  // 初始化所有 Twitch 服務（Chat + Helix API + DecAPI）
  await unifiedTwitchService.initialize();

  // 啟動聊天監聽器管理器（包含分佈式協調）
  await chatListenerManager.start();

  // 啟動所有定時任務（Cron Jobs）
  startAllJobs();
});
