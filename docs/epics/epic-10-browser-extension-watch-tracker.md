# Epic 10: 瀏覽器擴充功能 - 觀看時數追蹤器

**建立日期**: 2025-12-31 **狀態**: 📋 已規劃 **優先級**: 高 **預估工時**: 5 小時

---

## 一、功能概述

### 背景

目前系統透過「聊天訊息」來推算觀看時間，但如果用戶只是靜靜看直播不發言，就無法記錄觀看時數。

### 解決方案

開發 Chrome 擴充功能，自動偵測用戶正在觀看的 Twitch 頻道，並定期發送心跳到後端記錄觀看時間。

### 核心功能

- ✅ 自動偵測正在觀看的 Twitch 頻道
- ✅ 後台每 60 秒發送心跳到後端
- ✅ 自動記錄觀看時數到資料庫
- ✅ 與現有網站使用相同登入狀態
- ✅ Popup 顯示追蹤狀態與今日統計

---

## 二、系統架構

### 2.1 整體流程

```
┌─────────────────────────────────────────────────────────────────┐
│  Chrome Browser                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Twitch.tv/capookawaii                                   │   │
│  │                                                          │   │
│  │  ┌────────────────────────────────────────────────────┐ │   │
│  │  │  Content Script (content.ts)                        │ │   │
│  │  │  - 偵測當前頻道名稱                                  │ │   │
│  │  │  - 偵測是否正在直播                                  │ │   │
│  │  │  - 偵測頁面可見性                                    │ │   │
│  │  └──────────────────────┬─────────────────────────────┘ │   │
│  └─────────────────────────┼───────────────────────────────┘   │
│                            │                                    │
│                            ▼ (Message)                          │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Service Worker (background.ts)                          │   │
│  │  - 管理心跳計時器                                        │   │
│  │  - 每 60 秒發送 API 請求                                 │   │
│  │  - 處理登入狀態                                          │   │
│  └──────────────────────┬──────────────────────────────────┘   │
│                         │                                       │
└─────────────────────────┼───────────────────────────────────────┘
                          │
                          ▼ POST /api/viewer/heartbeat
┌─────────────────────────────────────────────────────────────────┐
│  Backend API                                                    │
│  - 驗證 JWT Token                                               │
│  - 記錄觀看時間到 ViewerChannelDailyStat                        │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 檔案結構

```
twitch-watch-tracker-extension/
├── manifest.json              # 擴充功能設定 (Manifest V3)
├── src/
│   ├── background/
│   │   └── service-worker.ts  # 背景 Service Worker
│   ├── content/
│   │   └── twitch-detector.ts # 注入 Twitch 頁面的腳本
│   ├── popup/
│   │   ├── popup.html         # 彈出視窗 UI
│   │   ├── popup.css          # 樣式
│   │   └── popup.ts           # 邏輯
│   └── shared/
│       ├── types.ts           # 共用型別
│       └── api.ts             # API 呼叫
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── package.json
├── tsconfig.json
└── webpack.config.js          # 打包設定
```

---

## 三、模組詳細設計

### 3.1 Content Script (twitch-detector.ts)

**職責**：偵測 Twitch 頁面狀態

```typescript
// 偵測的資訊
interface TwitchPageInfo {
  channelName: string | null; // 頻道名稱
  isLive: boolean; // 是否正在直播
  isVisible: boolean; // 頁面是否可見（標籤頁在前台）
}
```

**觸發時機**：

- 頁面載入時
- URL 變化時（切換頻道）
- 頁面可見性變化時

**偵測邏輯**：

```typescript
// 從 URL 提取頻道名稱
function getChannelFromUrl(): string | null {
  const match = window.location.pathname.match(/^\/(\w+)$/);
  return match ? match[1] : null;
}

// 偵測是否正在直播（非 VOD）
function isLiveStream(): boolean {
  // 檢查是否有「直播中」標示
  return !!document.querySelector('[data-a-target="live-indicator"]');
}

// 偵測頁面可見性
function isPageVisible(): boolean {
  return document.visibilityState === "visible";
}
```

### 3.2 Service Worker (service-worker.ts)

**職責**：管理心跳邏輯

**主要功能**：

- 接收 Content Script 的頁面狀態
- 維護當前觀看狀態
- 每 60 秒發送心跳到後端
- 處理登入/登出

**心跳邏輯**：

```
條件檢查：
├─ 用戶已登入？
├─ 有正在觀看的頻道？
├─ 頻道正在直播？
└─ 頁面在前台？

全部 ✅ → 發送心跳，記錄 60 秒觀看時間
任一 ❌ → 跳過這次心跳
```

**狀態管理**：

```typescript
interface TrackerState {
  isLoggedIn: boolean;
  currentChannel: string | null;
  isLive: boolean;
  isVisible: boolean;
  sessionStart: number | null;
  totalSecondsToday: Record<string, number>;
}
```

### 3.3 Popup UI (popup.html)

**職責**：用戶界面

```
┌─────────────────────────────────┐
│  🎮 Twitch 觀看追蹤器           │
├─────────────────────────────────┤
│                                 │
│  狀態: ● 追蹤中                 │
│  頻道: capookawaii              │
│  本次: 45 分鐘                  │
│                                 │
│  ─────────────────────────────  │
│                                 │
│  📊 今日統計                    │
│  ├─ capookawaii: 2h 30m         │
│  └─ xxxStreamer: 45m            │
│                                 │
│  ─────────────────────────────  │
│                                 │
│  [⏸️ 暫停追蹤]  [⚙️ 設定]       │
│                                 │
└─────────────────────────────────┘
```

---

## 四、後端 API 設計

### 4.1 新增端點

**POST /api/viewer/heartbeat**

```typescript
// Request Body
{
  channelName: string; // 頻道名稱
  durationSeconds: number; // 這次心跳的秒數 (通常是 60)
}

// Response
{
  success: boolean;
  todayTotal: number; // 今日該頻道累積觀看秒數
}

// 錯誤回應
{
  error: string;
  code: "UNAUTHORIZED" | "CHANNEL_NOT_FOUND" | "INVALID_REQUEST";
}
```

### 4.2 後端邏輯

```typescript
// backend/src/modules/viewer/viewer.controller.ts

async handleHeartbeat(req: AuthenticatedRequest, res: Response) {
  const { channelName, durationSeconds } = req.body;
  const viewerId = req.user.viewerId;

  // 1. 驗證輸入
  if (!channelName || !durationSeconds || durationSeconds > 120) {
    return res.status(400).json({ error: 'Invalid request' });
  }

  // 2. 查找頻道
  const channel = await prisma.channel.findFirst({
    where: { channelName: channelName.toLowerCase() }
  });

  if (!channel) {
    return res.status(404).json({ error: 'Channel not found' });
  }

  // 3. 更新今日統計
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const stat = await prisma.viewerChannelDailyStat.upsert({
    where: {
      viewerId_channelId_date: { viewerId, channelId: channel.id, date: today }
    },
    create: {
      viewerId, channelId: channel.id, date: today,
      watchSeconds: durationSeconds, messageCount: 0, emoteCount: 0
    },
    update: {
      watchSeconds: { increment: durationSeconds }
    }
  });

  return res.json({
    success: true,
    todayTotal: stat.watchSeconds
  });
}
```

---

## 五、安全設計

### 5.1 Token 處理

```
1. 用戶在網站登入
2. 擴充功能通過 Cookie 或 Message API 獲取 Token
3. Token 儲存在 chrome.storage.local
4. 每次心跳請求附帶 Token
```

### 5.2 驗證流程

```
擴充功能 ──[Bearer Token]──> 後端
                              │
                              ▼
                         驗證 JWT
                              │
                 ┌────────────┴────────────┐
                 ▼                          ▼
              ✅ 有效                    ❌ 無效
                 │                          │
                 ▼                          ▼
            記錄觀看時間                返回 401
```

### 5.3 防濫用機制

- 每次心跳最多記錄 120 秒（防止偽造大量時間）
- 同一頻道短時間內重複請求會被忽略
- Token 過期自動重新認證

---

## 六、設定選項

### 用戶可配置項目

| 設定     | 預設值  | 說明                   |
| -------- | ------- | ---------------------- |
| 心跳間隔 | 60 秒   | 多久發送一次心跳       |
| 前台檢測 | ✅ 啟用 | 只追蹤前台標籤         |
| 靜音檢測 | ❌ 停用 | 靜音時是否追蹤         |
| 自動啟動 | ✅ 啟用 | 開啟 Twitch 時自動開始 |
| 通知提醒 | ❌ 停用 | 累積 X 小時後提醒休息  |

---

## 七、實作計畫

### Stories 分解

| Story    | 內容                        | 預估    | 依賴       |
| -------- | --------------------------- | ------- | ---------- |
| **10.1** | 專案建立 + Manifest V3 設定 | 30 分鐘 | -          |
| **10.2** | Content Script（頻道偵測）  | 1 小時  | 10.1       |
| **10.3** | Service Worker（心跳邏輯）  | 1 小時  | 10.1, 10.2 |
| **10.4** | Popup UI                    | 1 小時  | 10.3       |
| **10.5** | 後端 Heartbeat API          | 30 分鐘 | -          |
| **10.6** | Token 認證整合              | 30 分鐘 | 10.3, 10.5 |
| **10.7** | 整合測試 + 除錯             | 30 分鐘 | All        |

### 時程

| 階段        | 內容                            | 預估時間   |
| ----------- | ------------------------------- | ---------- |
| **Phase 1** | 專案建立 + Manifest 設定 (10.1) | 30 分鐘    |
| **Phase 2** | Content Script（10.2）          | 1 小時     |
| **Phase 3** | Service Worker（10.3）          | 1 小時     |
| **Phase 4** | Popup UI（10.4）                | 1 小時     |
| **Phase 5** | 後端 API（10.5, 10.6）          | 1 小時     |
| **Phase 6** | 整合測試（10.7）                | 30 分鐘    |
| **合計**    |                                 | **5 小時** |

---

## 八、技術細節

### 8.1 Manifest V3 設定

```json
{
  "manifest_version": 3,
  "name": "Twitch 觀看追蹤器",
  "version": "1.0.0",
  "description": "自動追蹤您的 Twitch 觀看時數",
  "permissions": ["storage", "alarms"],
  "host_permissions": ["https://www.twitch.tv/*", "https://your-backend-url.com/*"],
  "background": {
    "service_worker": "dist/background.js"
  },
  "content_scripts": [
    {
      "matches": ["https://www.twitch.tv/*"],
      "js": ["dist/content.js"]
    }
  ],
  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

### 8.2 開發工具

| 工具            | 用途     |
| --------------- | -------- |
| TypeScript      | 型別安全 |
| Webpack         | 打包     |
| Chrome DevTools | 除錯     |

---

## 九、發布選項

| 方式                 | 說明                             | 成本          |
| -------------------- | -------------------------------- | ------------- |
| **開發者模式**       | 載入未封裝的擴充功能（本地測試） | 免費          |
| **Chrome Web Store** | 公開發布                         | $5 開發者帳號 |
| **私人分享**         | 打包成 .crx 檔案分享             | 免費          |

---

## 十、限制與備註

### 限制

- ❌ 只支援電腦版 Chrome/Edge
- ❌ 手機版無法使用
- ❌ 需要瀏覽器開啟 Twitch 標籤

### 與現有系統整合

- ✅ 使用相同的登入 Token
- ✅ 寫入相同的 ViewerChannelDailyStat 表
- ✅ 前端儀表板可直接顯示資料
- ⚠️ 與聊天推算的觀看時間會疊加（需考慮是否去重）

### 📱 手機/APP 使用者的替代方案

由於手機瀏覽器不支援擴充功能，且 Twitch APP 是封閉環境無法 hook，以下是手機用戶的折衷方案：

#### 方案 A：聊天訊息推算（現有功能）

| 項目   | 說明                                 |
| ------ | ------------------------------------ |
| 原理   | 根據您在直播中發送的訊息推算觀看時間 |
| 操作   | 偶爾發個表情或 +1 就會被記錄         |
| 準確度 | ⭐⭐⭐ 中等                          |
| 優點   | 不需額外安裝任何東西                 |
| 缺點   | 需要主動發言才會記錄                 |

#### 方案 B：手動計時器（未來可實作）

```
┌─────────────────────────────────┐
│  📱 PWA 觀看追蹤器              │
├─────────────────────────────────┤
│                                 │
│  選擇頻道: [capookawaii ▼]      │
│                                 │
│       ⏱️  01:23:45              │
│                                 │
│   [▶️ 開始觀看]  [⏹️ 結束]      │
│                                 │
└─────────────────────────────────┘
```

| 項目   | 說明                               |
| ------ | ---------------------------------- |
| 原理   | 用戶手動點擊「開始」和「結束」按鈕 |
| 實作   | PWA 網頁，可加到手機主畫面         |
| 準確度 | ⭐⭐⭐⭐⭐ 最高（用戶完全控制）    |
| 優點   | 跨平台通用（手機、電視都能用）     |
| 缺點   | 需要手動操作，可能忘記開始或結束   |

#### 方案 C：混合追蹤策略

| 使用裝置        | 追蹤方式                | 準確度     |
| --------------- | ----------------------- | ---------- |
| 💻 電腦瀏覽器   | Chrome 擴充功能（自動） | ⭐⭐⭐⭐⭐ |
| 📱 手機         | 聊天訊息推算（被動）    | ⭐⭐⭐     |
| 📱 手機（進階） | 手動計時器（主動）      | ⭐⭐⭐⭐⭐ |

**建議策略**：

- 電腦為主要觀看裝置時 → 優先使用擴充功能
- 手機為主要觀看裝置時 → 養成「開播發個表情」的習慣
- 如需精確追蹤手機觀看 → 未來可開發手動計時器 PWA

---

## 十一、驗收標準

- [ ] 安裝擴充功能後，開啟 Twitch 直播頁面
- [ ] Popup 顯示「追蹤中」狀態和當前頻道
- [ ] 60 秒後，後端收到心跳請求
- [ ] 儀表板顯示觀看時間增加
- [ ] 切換到其他標籤頁，心跳暫停
- [ ] 切回 Twitch 標籤頁，心跳繼續
- [ ] 登出網站後，擴充功能停止追蹤
