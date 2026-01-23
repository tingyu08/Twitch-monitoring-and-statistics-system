# Epic 10: 瀏覽器擴充功能 - 真實觀看時長追蹤

## 1. 目標

開發 Chrome
Extension，解決目前透過 IRC 聊天訊息推算觀看時間不準確的問題。Extension 將直接監聽 Twitch 網頁的播放器狀態，實現精確的「分鐘級」觀看紀錄。

## 2. 架構 (Manifest V3)

### 2.1 核心元件

- **Popup**: 顯示目前連線狀態、當前觀看的頻道統計、登入狀態。
- **Content Script**: 注入 `twitch.tv/*`，監聽 DOM 與 `<video>`
  標籤，判斷是否播放中、是否靜音、當前頻道 ID。
- **Background Service Worker**: 負責定時匯總數據，並安全地傳送到 Bmad Backend。

### 2.2 權限需求

```json
{
  "permissions": ["storage", "tabs", "alarms"],
  "host_permissions": [
    "*://*.twitch.tv/*",
    "https://twitch-monitoring-and-statistics-sy.vercel.app/*",
    "https://twitch-monitoring-and-statistics-system.onrender.com/*"
  ]
}
```

## 3. 數據流與通訊

### 3.1 身分驗證 (Auth Sync)

為了避免使用者重複登入，我們採用 **網頁 -> Extension 訊息同步** 機制。

1. 使用者登入 Bmad Dashboard。
2. 網頁偵測 Extension ID。
3. 網頁透過 `chrome.runtime.sendMessage` 發送 `{ type: 'SYNC_TOKEN', token: '...' }`。
4. Extension 將 Token 存入 `chrome.storage.local`。

### 3.2 觀看追蹤 (Watch Heartbeat)

1. **Content Script** 每 30 秒檢查一次：
   - URL 是否符合 `twitch.tv/channelName`。
   - `<video>` 是否存在且 `!paused`。
   - 是否為 `Ad` (廣告中)。
2. 若符合觀看條件，發送訊息給 Background: `{ type: 'HEARTBEAT', channel: 'xxx' }`。
3. **Background** 收到 Heartbeat 後：
   - 暫存狀態。
   - 每 60 秒 (或累積滿一定次數) 向 Bmad Backend API 發送 POST `/api/extension/heartbeat`。

## 4. API 設計

### POST /api/extension/heartbeat

- **Header**: `Authorization: Bearer <token>`
- **Body**:
  ```json
  {
    "channelId": "twitch_123456",
    "timestamp": "2026-01-13T10:00:00Z",
    "duration": 60 // seconds
  }
  ```

## 5. 開發堆疊

- **Framework**: React + TypeScript (Vite)
- **Build Tool**: CRXJS Vite Plugin
- **Style**: TailwindCSS (與主專案一致)
