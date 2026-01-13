/**
 * Bmad Extension - Background Service Worker
 *
 * 職責：
 * 1. 接收 Content Script 的 Token 並存儲
 * 2. 聚合 Heartbeat 並發送到後端 API
 */

// ============ 常數定義 ============
const API_BASE_URL =
  "https://twitch-monitoring-and-statistics-system.onrender.com";
const SUBMIT_INTERVAL_MS = 60 * 1000; // 60 秒提交一次

// ============ 狀態管理 ============
interface WatchSession {
  channel: string;
  startTime: string;
  heartbeatCount: number;
}

let currentSession: WatchSession | null = null;
let authToken: string | null = null;

// 啟動時載入 Token
chrome.storage.local.get(["bmadToken"], (result: { bmadToken?: string }) => {
  if (result.bmadToken) {
    authToken = result.bmadToken;
    console.log("[Bmad BG] Token loaded from storage");
  }
});

// ============ 訊息處理 ============
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "SYNC_TOKEN") {
    authToken = message.token;
    chrome.storage.local.set({ bmadToken: message.token });
    console.log("[Bmad BG] Token synced and saved");
    sendResponse({ success: true });
  }

  if (message.type === "HEARTBEAT") {
    handleHeartbeat(message.channel, message.timestamp);
    sendResponse({ success: true });
  }

  if (message.type === "GET_STATUS") {
    sendResponse({
      isAuthenticated: !!authToken,
      currentChannel: currentSession?.channel || null,
      heartbeatCount: currentSession?.heartbeatCount || 0,
    });
  }

  return true; // 保持 sendResponse 有效
});

// ============ Heartbeat 處理 ============
function handleHeartbeat(channel: string, timestamp: string) {
  if (!currentSession || currentSession.channel !== channel) {
    // 如果正在看別的頻道，先提交舊的
    if (currentSession) {
      submitSession(currentSession);
    }

    // 開始新 Session
    currentSession = {
      channel,
      startTime: timestamp,
      heartbeatCount: 1,
    };
    console.log(`[Bmad BG] New session: ${channel}`);
  } else {
    currentSession.heartbeatCount++;
    console.log(
      `[Bmad BG] Heartbeat #${currentSession.heartbeatCount} for ${channel}`
    );
  }
}

// ============ 提交 Session ============
async function submitSession(session: WatchSession) {
  if (!authToken) {
    console.warn("[Bmad BG] No auth token, skipping submit");
    return;
  }

  // 每個 heartbeat 代表 30 秒
  const durationSeconds = session.heartbeatCount * 30;

  try {
    const response = await fetch(`${API_BASE_URL}/api/extension/heartbeat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        channelName: session.channel,
        timestamp: session.startTime,
        duration: durationSeconds,
      }),
    });

    if (response.ok) {
      console.log(
        `[Bmad BG] Submitted ${durationSeconds}s for ${session.channel}`
      );
    } else {
      console.error("[Bmad BG] Submit failed:", response.status);
    }
  } catch (error) {
    console.error("[Bmad BG] Submit error:", error);
  }
}

// ============ 定時提交 ============
setInterval(() => {
  if (currentSession && currentSession.heartbeatCount > 0) {
    submitSession(currentSession);
    // 重置計數但保留 session
    currentSession.heartbeatCount = 0;
    currentSession.startTime = new Date().toISOString();
  }
}, SUBMIT_INTERVAL_MS);

console.log("[Bmad BG] Background Service Worker started");
