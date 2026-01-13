/**
 * Bmad Extension - Content Script
 *
 * 職責：
 * 1. 接收網頁傳來的 Token (透過 postMessage)
 * 2. 偵測 Twitch 頻道與播放狀態
 * 3. 定時發送 Heartbeat 給 Background
 */

// ============ 常數定義 ============
const ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "https://twitch-monitoring-and-statistics-sy.vercel.app",
  "https://twitch-monitoring-and-statistics-system.vercel.app",
];

const HEARTBEAT_INTERVAL_MS = 30 * 1000; // 30 秒

// ============ Token Sync ============
window.addEventListener("message", (event) => {
  // 驗證來源
  if (!ALLOWED_ORIGINS.includes(event.origin)) return;

  const data = event.data;
  if (data?.type === "BMAD_SYNC_TOKEN" && data.token) {
    console.log("[Bmad] Received token from web app");

    // 轉發給 Background
    chrome.runtime.sendMessage(
      {
        type: "SYNC_TOKEN",
        token: data.token,
      },
      () => {
        // 通知網頁同步成功
        window.postMessage({ type: "BMAD_SYNC_SUCCESS" }, "*");
      }
    );
  }
});

// ============ Twitch 偵測 ============
function getTwitchChannel(): string | null {
  // URL 格式: https://www.twitch.tv/channelName
  const match = window.location.pathname.match(/^\/([a-zA-Z0-9_]+)$/);
  if (match) {
    const channelName = match[1].toLowerCase();
    // 排除非頻道頁面
    const excludedPaths = [
      "directory",
      "settings",
      "inventory",
      "drops",
      "wallet",
      "subscriptions",
    ];
    if (!excludedPaths.includes(channelName)) {
      return channelName;
    }
  }
  return null;
}

function isVideoPlaying(): boolean {
  const video = document.querySelector("video");
  if (!video) return false;
  return !video.paused && !video.ended && video.readyState > 2;
}

// ============ Heartbeat 發送 ============
let lastChannel: string | null = null;

function sendHeartbeat() {
  // 只在 Twitch 網域執行
  if (!window.location.hostname.includes("twitch.tv")) return;

  const channel = getTwitchChannel();
  const isPlaying = isVideoPlaying();

  if (channel && isPlaying) {
    console.log(`[Bmad] Heartbeat: watching ${channel}`);

    chrome.runtime.sendMessage({
      type: "HEARTBEAT",
      channel: channel,
      timestamp: new Date().toISOString(),
    });

    lastChannel = channel;
  } else if (lastChannel) {
    // 停止觀看時也通知一下
    console.log(`[Bmad] Stopped watching ${lastChannel}`);
    lastChannel = null;
  }
}

// 啟動 Heartbeat 定時器 (只在 Twitch)
if (window.location.hostname.includes("twitch.tv")) {
  console.log("[Bmad] Content Script loaded on Twitch");
  setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
  // 初始執行一次
  setTimeout(sendHeartbeat, 3000);
}

// 通知網頁 Extension 已安裝
if (ALLOWED_ORIGINS.some((origin) => window.location.origin === origin)) {
  console.log("[Bmad] Content Script loaded on Bmad site");
  window.postMessage({ type: "BMAD_EXTENSION_READY" }, "*");
}
