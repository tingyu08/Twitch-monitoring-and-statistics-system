# Epic 5：即時通知與事件系統（Real-time Notifications & Events）

## 1. Epic 概述

### 1.1 背景

目前系統主要依賴定期輪詢 API 來獲取資料更新，這會導致資料延遲且增加 API 呼叫成本。Twitch 提供了 EventSub Webhook 和 PubSub 即時通知機制，可以實現事件驅動的即時資料更新。

### 1.2 Epic 目標

- 實現 Twitch EventSub Webhook 訂閱，接收即時事件通知
- 實現 PubSub 即時監聽（Channel Points、Whispers 等）
- 減少 API 輪詢頻率，降低資源消耗
- 提供即時通知給前端使用者（WebSocket/Server-Sent Events）

---

## 2. 範圍（Scope）

### 2.1 In Scope

- **EventSub Webhook 整合**：

  - 直播開始/結束事件
  - 追蹤者事件
  - 訂閱/續訂/贈送訂閱事件
  - Raid 事件
  - 頻道更新事件（標題/遊戲變更）
  - Cheer（Bits 贊助）事件

- **PubSub 即時監聽**：

  - Channel Points 兌換事件
  - Bits 事件（備選 EventSub）
  - 版主操作日誌

- **前端即時通知**：
  - WebSocket/SSE 連接
  - 即時通知 Toast
  - 儀表板即時更新

### 2.2 Out of Scope

- 自定義 Webhook 發送到第三方服務
- 多租戶 Webhook 處理
- Twitch 之外的平台事件

---

## 3. User Stories

### Story 5.1 – EventSub Webhook 基礎設施

- **As a** 系統
- **I want** 能夠接收 Twitch EventSub Webhook 通知
- **So that** 可以即時處理 Twitch 平台事件

**技術需求**：

- 建立 `/webhook/twitch` 端點
- 實現 Twitch 簽名驗證
- 處理 webhook challenge 驗證
- 儲存 EventSub 訂閱狀態

**使用 Twurple**：
- 核心模組：`@twurple/eventsub-http`（生產環境）或 `@twurple/eventsub-ws`（開發環境/WebSocket）
- 類別：`EventSubMiddleware` (Express 整合)
- 方法：`listener.subscribeToStreamOnlineEvents()`, `listener.subscribeToChannelFollowEvents()`

---

### Story 5.2 – 直播狀態即時通知

- **As a** 觀眾
- **I want** 當我追蹤的實況主開播時收到通知
- **So that** 我不會錯過直播

**技術需求**：

- 訂閱 `stream.online` 和 `stream.offline` 事件
- 更新資料庫直播狀態
- 發送前端即時通知

---

### Story 5.3 – 訂閱事件即時處理

- **As a** 實況主
- **I want** 即時看到新的訂閱/續訂/贈送訂閱
- **So that** 我能即時感謝訂閱者

**技術需求**：

- 訂閱 `channel.subscribe`、`channel.subscription.gift`、`channel.subscription.message` 事件
- 即時更新訂閱統計
- 寫入 `SubscriptionEvent` 表

---

### Story 5.4 – Channel Points 兌換事件

- **As a** 實況主
- **I want** 查看觀眾的 Channel Points 兌換記錄
- **So that** 我能了解哪些獎勵最受歡迎

**技術需求**：

- 使用 PubSub 或 EventSub 監聽兌換事件
- 建立 `ChannelPointsRedemption` 資料表
- 提供統計圖表

---

### Story 5.5 – 前端即時通知系統

- **As a** 使用者
- **I want** 在儀表板看到即時更新
- **So that** 不需要手動刷新頁面

**技術需求**：

- 建立 WebSocket 或 SSE 連接
- 前端通知 Toast 元件
- 儀表板數據即時更新

---

## 4. 技術架構

### 4.1 新增資料表

```prisma
model EventSubSubscription {
  id            String   @id @default(cuid())
  streamerId    String
  type          String   // e.g., "stream.online", "channel.subscribe"
  subscriptionId String  @unique // Twitch subscription ID
  status        String   // "enabled", "pending", "revoked"
  callbackUrl   String
  createdAt     DateTime @default(now())

  streamer      Streamer @relation(fields: [streamerId], references: [id])
}

model SubscriptionEvent {
  id            String   @id @default(cuid())
  streamerId    String
  userId        String?
  userName      String?
  tier          String   // "1", "2", "3"
  isGift        Boolean  @default(false)
  gifterId      String?
  message       String?
  eventAt       DateTime
  createdAt     DateTime @default(now())

  streamer      Streamer @relation(fields: [streamerId], references: [id])
}

model ChannelPointsRedemption {
  id            String   @id @default(cuid())
  streamerId    String
  userId        String
  userName      String
  rewardId      String
  rewardTitle   String
  cost          Int
  userInput     String?
  status        String   // "fulfilled", "unfulfilled", "canceled"
  redeemedAt    DateTime

  streamer      Streamer @relation(fields: [streamerId], references: [id])
}
```

### 4.2 新增 OAuth 權限

- `channel:read:redemptions` - 讀取 Channel Points 兌換
- `channel:read:subscriptions` - 讀取訂閱事件（EventSub 需要）

### 4.3 新增 API 端點

```
POST   /webhook/twitch/callback      - EventSub Webhook 回調
GET    /api/eventsub/subscriptions   - 列出訂閱狀態
POST   /api/eventsub/subscribe       - 建立新訂閱
DELETE /api/eventsub/subscribe/:id   - 刪除訂閱

GET    /api/ws                       - WebSocket 連接端點
GET    /api/events/stream            - SSE 事件流端點
```

---

## 5. 時程規劃

### Phase 1（2 週）

- Story 5.1：EventSub 基礎設施
- Story 5.2：直播狀態即時通知

### Phase 2（2 週）

- Story 5.3：訂閱事件即時處理
- Story 5.5：前端即時通知系統

### Phase 3（2 週）

- Story 5.4：Channel Points 兌換事件
- 測試與優化

**總預估時程**：6 週

---

**文件版本**：v1.0  
**最後更新**：2025-12-16  
**作者**：AI Development Assistant
