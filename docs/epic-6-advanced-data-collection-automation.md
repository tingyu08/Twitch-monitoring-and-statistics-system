# Epic 6：進階資料收集與自動化（Advanced Data Collection & Automation）

## 1. Epic 概述

### 1.1 背景

目前系統使用手動觸發或簡單的 Mock 資料來展示功能。為了提供真實的長期數據分析，需要建立自動化的資料收集機制，包括定時任務、歷史資料聚合、以及與 Twitch API 的深度整合。

### 1.2 Epic 目標

- 建立定時資料收集 Worker（Cron Jobs）
- 實現歷史資料聚合與壓縮
- 自動管理 Twitch API Token 刷新
- 監控系統健康狀態與告警

---

## 2. User Stories

### Story 6.1 – 定時資料抓取 Worker

- **As a** 系統
- **I want** 定期從 Twitch API 抓取最新資料
- **So that** 儀表板數據能保持最新

**技術需求**：

- 使用 `node-cron` 或類似工具
- 每 5 分鐘檢查直播狀態
- 每小時更新追蹤者數量
- 每日更新訂閱統計

**Twurple 整合**：

- `@twurple/api` 獲取頻道/直播資訊 (ApiClient)
- 自動處理 Rate Limit: ApiClient 的內部機制

---

### Story 6.2 – 歷史資料聚合服務

- **As a** 系統
- **I want** 自動將詳細資料聚合成統計摘要
- **So that** 查詢效能更好且儲存空間更省

**技術需求**：

- 每日聚合 `ViewerChannelDailyStat`
- 每週/每月聚合報表
- 保留原始資料 90 天，聚合資料永久保留

---

### Story 6.3 – Token 自動管理服務

- **As a** 系統
- **I want** 自動刷新即將過期的 OAuth Token
- **So that** 服務不會因 Token 過期而中斷

**技術需求**：

- 監控所有儲存的 Token 過期時間
- 在過期前 1 小時自動刷新
- 刷新失敗時通知使用者重新授權

**Twurple 整合**：

- `RefreshingAuthProvider` 自動處理刷新
- 使用 `AccessToken` 類型管理 Token

---

### Story 6.4 – VOD 與剪輯同步

- **As a** 實況主
- **I want** 查看我的 VOD 和精華剪輯列表
- **So that** 我能追蹤我的內容資產

**技術需求**：

- 使用 `@twurple/api` (ApiClient)
- VOD: `apiClient.videos.getVideosByUser()`
- 剪輯: `apiClient.clips.getClipsForBroadcaster()`
- 同步 VOD 標題、長度、觀看次數

**新增資料表**：

```prisma
model Video {
  id            String   @id @default(cuid())
  twitchVideoId String   @unique
  streamerId    String
  title         String
  description   String?
  duration      Int      // 秒
  viewCount     Int
  language      String
  type          String   // "archive", "highlight", "upload"
  thumbnailUrl  String?
  publishedAt   DateTime

  streamer      Streamer @relation(fields: [streamerId], references: [id])
}

model Clip {
  id            String   @id @default(cuid())
  twitchClipId  String   @unique
  streamerId    String
  creatorId     String
  creatorName   String
  title         String
  viewCount     Int
  duration      Float
  thumbnailUrl  String?
  createdAt     DateTime

  streamer      Streamer @relation(fields: [streamerId], references: [id])
}
```

---

### Story 6.5 – 遊戲/分類統計

- **As a** 實況主
- **I want** 查看我在不同遊戲分類的表現統計
- **So that** 我能了解哪些遊戲最受觀眾歡迎

**技術需求**：

- 追蹤每場直播的遊戲分類
- 統計各遊戲的總直播時數、平均觀眾數
- 使用 `@twurple/api` 的 `games` 模組獲取遊戲資訊

---

### Story 6.6 – 系統監控與健康檢查

- **As a** 系統管理者
- **I want** 監控系統健康狀態與 API 呼叫情況
- **So that** 能及時發現並解決問題

**技術需求**：

- `/health` 端點回報系統狀態
- API 呼叫次數統計（Rate Limit 監控）
- 錯誤日誌整合（可選：Sentry）
- Cron Job 執行狀態監控

---

## 3. 技術架構

### 3.1 Worker 架構

```
┌─────────────────────────────────────────────────┐
│                    Scheduler                     │
├─────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌──────────┐ │
│  │ Stream Job  │  │ Follower Job│  │ Sub Job  │ │
│  │  (5 min)    │  │  (1 hour)   │  │ (daily)  │ │
│  └─────────────┘  └─────────────┘  └──────────┘ │
├─────────────────────────────────────────────────┤
│                 Twurple API Client               │
└─────────────────────────────────────────────────┘
```

### 3.2 新增 API 端點

```
GET    /api/admin/health           - 系統健康檢查
GET    /api/admin/jobs             - 列出所有排程任務
POST   /api/admin/jobs/:id/run     - 手動觸發任務
GET    /api/admin/rate-limit       - API 呼叫統計

GET    /api/streamer/me/videos     - 獲取 VOD 列表
GET    /api/streamer/me/clips      - 獲取剪輯列表
GET    /api/streamer/me/categories - 獲取分類統計
```

---

## 4. 時程規劃

### Phase 1（2 週）

- Story 6.1：定時資料抓取 Worker
- Story 6.3：Token 自動管理服務

### Phase 2（2 週）

- Story 6.2：歷史資料聚合服務
- Story 6.6：系統監控與健康檢查

### Phase 3（2 週）

- Story 6.4：VOD 與剪輯同步
- Story 6.5：遊戲/分類統計

**總預估時程**：6 週

---

**文件版本**：v1.0  
**最後更新**：2025-12-16  
**作者**：AI Development Assistant
