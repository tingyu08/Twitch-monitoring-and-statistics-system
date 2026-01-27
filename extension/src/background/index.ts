/**
 * Bmad Extension - Background Service Worker
 *
 * 職責：
 * 1. 接收 Content Script 的 Token 並存儲
 * 2. 聚合 Heartbeat 並發送到後端 API
 */

// ============ 常數定義 ============
const API_BASE_URL = "https://twitch-monitoring-and-statistics-system.onrender.com";
const SUBMIT_ALARM_NAME = "bmad-submit-session";
const SUBMIT_INTERVAL_MINUTES = 1; // chrome.alarms 最小間隔為 1 分鐘
const MAX_RETRY_ATTEMPTS = 3;
const PENDING_SESSIONS_KEY = "bmadPendingSessions";

// ============ 類型定義 ============
interface WatchSession {
  channel: string;
  startTime: string;
  heartbeatCount: number;
}

interface PendingSession extends WatchSession {
  retryCount: number;
}

// ============ 狀態管理 ============
let currentSession: WatchSession | null = null;
let authToken: string | null = null;

// ============ 初始化 ============
async function initialize() {
  // 載入 Token 和 Session 狀態
  const result = await chrome.storage.local.get(["bmadToken", "bmadCurrentSession"]) as {
    bmadToken?: string;
    bmadCurrentSession?: WatchSession;
  };

  if (result.bmadToken && typeof result.bmadToken === "string") {
    authToken = result.bmadToken;
    console.log("[Bmad BG] Token loaded from storage");
  }

  // P0 Fix: 恢復之前的 session 狀態（Service Worker 可能被暫停）
  if (result.bmadCurrentSession && typeof result.bmadCurrentSession === "object") {
    currentSession = result.bmadCurrentSession;
    console.log("[Bmad BG] Session restored:", currentSession?.channel);
  }

  // 處理之前失敗的 pending sessions
  await retryPendingSessions();

  // 設定定時提交 alarm（取代 setInterval）
  await setupSubmitAlarm();
}

// P1 Fix: 使用 chrome.alarms 取代 setInterval（MV3 Service Worker 相容）
async function setupSubmitAlarm() {
  // 先清除舊的 alarm
  await chrome.alarms.clear(SUBMIT_ALARM_NAME);

  // 建立週期性 alarm
  chrome.alarms.create(SUBMIT_ALARM_NAME, {
    delayInMinutes: SUBMIT_INTERVAL_MINUTES,
    periodInMinutes: SUBMIT_INTERVAL_MINUTES,
  });

  console.log("[Bmad BG] Submit alarm set");
}

// 處理 alarm 觸發
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === SUBMIT_ALARM_NAME) {
    await handlePeriodicSubmit();
  }
});

async function handlePeriodicSubmit() {
  if (currentSession && currentSession.heartbeatCount > 0) {
    const sessionToSubmit = { ...currentSession };

    // 重置計數但保留 session
    currentSession.heartbeatCount = 0;
    currentSession.startTime = new Date().toISOString();
    await persistCurrentSession();

    await submitSessionWithRetry(sessionToSubmit);
  }

  // 也嘗試重試之前失敗的 sessions
  await retryPendingSessions();
}

// ============ Session 持久化 ============
async function persistCurrentSession() {
  if (currentSession) {
    await chrome.storage.local.set({ bmadCurrentSession: currentSession });
  } else {
    await chrome.storage.local.remove("bmadCurrentSession");
  }
}

// ============ 訊息處理 ============
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "SYNC_TOKEN") {
    // P1 Fix: 驗證 Token 格式（基本 JWT 格式檢查）
    if (typeof message.token === "string" && message.token.split(".").length === 3) {
      authToken = message.token;
      chrome.storage.local.set({ bmadToken: message.token });
      console.log("[Bmad BG] Token synced and saved");
      sendResponse({ success: true });
    } else {
      console.warn("[Bmad BG] Invalid token format received");
      sendResponse({ success: false, error: "Invalid token format" });
    }
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
async function handleHeartbeat(channel: string, timestamp: string) {
  if (!currentSession || currentSession.channel !== channel) {
    // 如果正在看別的頻道，先提交舊的
    if (currentSession && currentSession.heartbeatCount > 0) {
      await submitSessionWithRetry(currentSession);
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
    console.log(`[Bmad BG] Heartbeat #${currentSession.heartbeatCount} for ${channel}`);
  }

  // 持久化 session 狀態
  await persistCurrentSession();
}

// ============ P0 Fix: 帶重試的 Session 提交 ============
async function submitSessionWithRetry(
  session: WatchSession,
  retryCount: number = 0
): Promise<boolean> {
  if (!authToken) {
    console.warn("[Bmad BG] No auth token, saving to pending");
    await savePendingSession(session, retryCount);
    return false;
  }

  // 每個 heartbeat 代表 30 秒
  const durationSeconds = session.heartbeatCount * 30;

  if (durationSeconds <= 0) {
    return true; // 沒有資料要提交
  }

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
      console.log(`[Bmad BG] Submitted ${durationSeconds}s for ${session.channel}`);
      return true;
    }

    // P0 Fix: 區分 HTTP 錯誤類型
    if (response.status === 401 || response.status === 403) {
      // 認證失敗，清除 token，不重試
      console.error("[Bmad BG] Auth failed, clearing token");
      authToken = null;
      await chrome.storage.local.remove("bmadToken");
      // 保存 session 等待重新認證
      await savePendingSession(session, 0);
      return false;
    }

    if (response.status >= 500) {
      // 伺服器錯誤，進行重試
      console.warn(`[Bmad BG] Server error ${response.status}, will retry`);
      return await handleRetry(session, retryCount);
    }

    // 其他錯誤（4xx），記錄但不重試
    console.error(`[Bmad BG] Request failed with status ${response.status}`);
    return false;
  } catch (error) {
    // 網路錯誤，進行重試
    console.error("[Bmad BG] Network error:", error instanceof Error ? error.message : "Unknown");
    return await handleRetry(session, retryCount);
  }
}

// P0 Fix: 指數退避重試邏輯
async function handleRetry(session: WatchSession, retryCount: number): Promise<boolean> {
  if (retryCount >= MAX_RETRY_ATTEMPTS) {
    console.warn("[Bmad BG] Max retries reached, saving to pending");
    await savePendingSession(session, retryCount);
    return false;
  }

  // 指數退避：1s, 2s, 4s
  const delayMs = Math.pow(2, retryCount) * 1000;
  console.log(`[Bmad BG] Retrying in ${delayMs}ms (attempt ${retryCount + 1}/${MAX_RETRY_ATTEMPTS})`);

  await new Promise((resolve) => setTimeout(resolve, delayMs));
  return await submitSessionWithRetry(session, retryCount + 1);
}

// P0 Fix: 儲存失敗的 session 以便稍後重試
async function savePendingSession(session: WatchSession, retryCount: number) {
  const result = await chrome.storage.local.get([PENDING_SESSIONS_KEY]);
  const stored = result[PENDING_SESSIONS_KEY];
  const pendingSessions: PendingSession[] = Array.isArray(stored) ? stored : [];

  // 限制 pending sessions 數量，避免無限堆積
  if (pendingSessions.length >= 100) {
    pendingSessions.shift(); // 移除最舊的
  }

  pendingSessions.push({
    ...session,
    retryCount,
  });

  await chrome.storage.local.set({ [PENDING_SESSIONS_KEY]: pendingSessions });
  console.log(`[Bmad BG] Saved pending session, total: ${pendingSessions.length}`);
}

// P0 Fix: 重試之前失敗的 sessions
async function retryPendingSessions() {
  if (!authToken) {
    return; // 沒有 token 就不嘗試
  }

  const result = await chrome.storage.local.get([PENDING_SESSIONS_KEY]);
  const stored = result[PENDING_SESSIONS_KEY];
  const pendingSessions: PendingSession[] = Array.isArray(stored) ? stored : [];

  if (pendingSessions.length === 0) {
    return;
  }

  console.log(`[Bmad BG] Retrying ${pendingSessions.length} pending sessions`);

  const stillPending: PendingSession[] = [];

  for (const session of pendingSessions) {
    const success = await submitSessionWithRetry(session, session.retryCount);
    if (!success && session.retryCount < MAX_RETRY_ATTEMPTS) {
      // 如果還沒達到最大重試次數，保留
      stillPending.push({ ...session, retryCount: session.retryCount + 1 });
    }
    // 如果成功或達到最大重試，就不再保留
  }

  await chrome.storage.local.set({ [PENDING_SESSIONS_KEY]: stillPending });
}

// ============ 啟動 ============
initialize().then(() => {
  console.log("[Bmad BG] Background Service Worker initialized");
});

// Service Worker 喚醒時也要初始化
chrome.runtime.onStartup.addListener(() => {
  initialize();
});
