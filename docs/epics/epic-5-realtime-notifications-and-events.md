# Epic 5：即時通知與事件系統（Real-time Notifications & Events）

## 1. Epic 概述

### 1.1 背景

目前系統主要依賴定期輪詢 API 來獲取資料更新，這會導致資料延遲且增加 API 呼叫成本。Twitch 提供了 EventSub
Webhook 和 PubSub 即時通知機制，可以實現事件驅動的即時資料更新。

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
  - 廣告破口事件 (Ad Break)

- **PubSub 即時監聽**：
  - Channel Points 兌換事件
  - Bits 事件（備選 EventSub）
  - 版主操作日誌

- **前端即時通知**：
  - WebSocket/SSE 連接
  - 即時通知 Toast
  - 儀表板即時更新
  - Hype Wall (感謝牆)
  - 廣告倒數計時器

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

- 核心模組：`@twurple/eventsub-http`
- 類別：`EventSubMiddleware`

---

### Story 5.2 – 直播狀態即時通知 (Live Status)

- **As a** 實況主/觀眾
- **I want** 儀表板的直播狀態能秒級更新
- **So that** 我能精確掌握開播時間與工時

**應用與 UI**：

- **儀表板變燈**：接收 `stream.online` 事件後，前端狀態燈號立即轉綠/紅，無需重整。
- **即時工時**：顯示「本次直播已進行 XX:XX:XX」，並在下播時自動結算精確工時。

**技術需求**：

- 訂閱 `stream.online` 和 `stream.offline` 事件
- WebSocket 推送狀態變更至前端
- 前端 Timer 元件同步伺服器時間

---

### Story 5.3 – 即時互動感謝牆 (Hype Wall)

- **As a** 實況主
- **I want** 在儀表板即時看到訂閱、抖內與追蹤通知
- **So that** 我能立即在直播中感謝觀眾

**應用與 UI**：

- **Hype Wall 元件**：一個會自動滾動的即時動態牆，顯示「Terry 追蹤了頻道」、「Bob 訂閱了 Tier
  1」、「Alice 抖內了 100 Bits」。
- **即時收益條**：儀表板頂部顯示「今日即時收益」，隨著訂閱/Bits 事件動態跳動增加。

**技術需求**：

- 訂閱 `channel.subscribe`、`channel.cheer`、`channel.follow` 事件
- WebSocket 廣播事件 payload
- 前端動畫列表元件

---

### Story 5.4 – Channel Points 兌換事件

- **As a** 實況主
- **I want** 查看觀眾的 Channel Points 兌換記錄
- **So that** 我能了解哪些獎勵最受歡迎

**技術需求**：

- 使用 PubSub 或 EventSub 監聽兌換事件 `channel.channel_points_custom_reward_redemption.add`
- 建立 `ChannelPointsRedemption` 資料表
- 即時彈出兌換通知 Toaster

---

### Story 5.5 – 前端即時通知系統 (Infrastructure)

- **As a** 開發者
- **I want** 建立穩定的 WebSocket/SSE 通道
- **So that** 可以支撐上述所有即時功能的推播

**技術需求**：

- 建立 WebSocket 或 SSE 連接 (Socket.io 或原生)
- 處理斷線重連 (Reconnection) 與心跳 (Heartbeat)
- 頻道訂閱機制 (Client 訂閱特定 Topic)

---

### Story 5.6 – 聊天室熱度與暴動偵測 (Chat Heatmap)

- **As a** 實況主
- **I want** 即時感知聊天室的熱度變化
- **So that** 我能在觀眾反應熱烈時加強互動

**應用與 UI**：

- **即時詞雲**：每 10 秒更新一次目前的熱門關鍵字 (如 "777", "笑死")。
- **暴動警示**：當訊息速率 (Msg/Sec) 超過閾值，儀表板顯示「🔥 聊天室暴動中」動畫。

**技術需求**：

- 後端 Chat Client 統計滑動視窗 (Sliding Window) 內的訊息量
- 定時透過 WebSocket 推送統計摘要

---

### Story 5.7 – 頻道資訊即時同步

- **As a** 實況主
- **I want** 儀表板上的標題與遊戲資訊隨時保持最新
- **So that** 我能確認改標題是否成功

**應用與 UI**：

- 當在 OBS 或 Twitch 後台修改標題後，本平台儀表板對應欄位應自動更新。
- 顯示「最後更新時間」。

**技術需求**：

- 訂閱 `channel.update` 事件
- 推送更新至前端 Context/Store

---

### Story 5.8 – 廣告破口倒數監控 (Ad Break Monitor)

- **As a** 實況主/觀眾
- **I want** 知道廣告時間還有多久結束
- **So that** 我知道什麼時候該切回畫面或休息結束

**應用與 UI**：

- **倒數計時器**：當自動廣告插入時，儀表板顯著位置顯示倒數計時圓環。
- **休息提醒**：文字提示「利用這 90 秒喝口水吧！」。

**技術需求**：

- 訂閱 `channel.ad_break.begin` 事件
- 計算結束時間並同步倒數

---

### Story 5.9 – 揪團即時通知與記錄 (Raid Alert)

- **As a** 實況主
- **I want** 知道誰 Raid 了我以及帶來多少人
- **So that** 我能發出準確的歡迎詞並記錄人情

**應用與 UI**：

- **Raid Alert**：這是一個顯眼的通知，顯示「XXX 帶領 500 位突擊隊員降落！」。
- **歡迎小抄**：自動顯示該頻道的最後玩過遊戲與連結，方便實況主念出「感謝 XXX，他剛剛在玩 Elden
  Ring」。

**技術需求**：

- 訂閱 `channel.raid` 事件
- 即時查詢 Raider 的頻道資訊 (Helix API) 以產生小抄

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
- `channel:read:ads` - 讀取廣告破口 (Ad Break)

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
- Story 5.2：直播狀態即時通知 (Live Status)
- Story 5.8：廣告破口監控 (Ad Break)

### Phase 2（2 週）

- Story 5.3：即時互動感謝牆 (Hype Wall)
- Story 5.9：揪團通知 (Raid Alert)
- Story 5.5：前端即時通知系統

### Phase 3（2 週）

- Story 5.4：Channel Points 兌換事件
- Story 5.6：聊天室熱度 (Chat Heatmap)
- 測試與優化

**總預估時程**：6 週

---

**文件版本**：v1.1 **最後更新**：2025-12-18 **作者**：Scrum Master Agent
