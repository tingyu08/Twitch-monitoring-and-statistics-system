# Epic 8：直播控制與預測/投票功能（Stream Control & Predictions）

## 1. Epic 概述

### 1.1 背景

Twitch 提供了直播控制 API（標題、遊戲）、預測（Predictions）和投票（Polls）功能。這些功能可以讓實況主直接從儀表板控制直播設定和互動功能，無需離開本平台。

### 1.2 Epic 目標

- 直播設定即時控制（標題、遊戲、標籤）
- 預測（Predictions）建立與管理
- 投票（Polls）建立與管理
- 廣告播放控制

---

## 2. User Stories

### Story 8.1 – 直播標題/遊戲即時更新

- **As a** 實況主
- **I want** 在儀表板直接修改直播標題和遊戲
- **So that** 我不需要切換到 Twitch 後台

**技術需求**：

- 使用 `@twurple/api` (ApiClient)
- `apiClient.channels.updateChannelInfo()`
- 表單驗證（標題最長 140 字）
- 遊戲搜尋與自動完成
- 標籤管理（最多 10 個）
- 遊戲搜尋與自動完成
- 標籤管理（最多 10 個）

**OAuth 權限**：

- `channel:manage:broadcast`

---

### Story 8.2 – 預測（Predictions）管理

- **As a** 實況主
- **I want** 直接從儀表板建立和管理預測
- **So that** 我能增加觀眾互動

**技術需求**：

- 建立預測（標題、選項、持續時間）
- 鎖定預測（停止投注）
- 解析預測（宣布結果）
- 取消預測（退還點數）
- 查看預測統計

**Twurple 方法**：

- `predictions.createPrediction()`
- `predictions.lockPrediction()`
- `predictions.resolvePrediction()`
- `predictions.cancelPrediction()`

**OAuth 權限**：

- `channel:manage:predictions`

**新增資料表**：

```prisma
model Prediction {
  id            String   @id @default(cuid())
  twitchPredId  String   @unique
  streamerId    String
  title         String
  status        String   // "active", "locked", "resolved", "canceled"
  winningOutcome String?
  totalPoints   Int      @default(0)
  createdAt     DateTime
  endedAt       DateTime?

  outcomes      PredictionOutcome[]
  streamer      Streamer @relation(fields: [streamerId], references: [id])
}

model PredictionOutcome {
  id            String   @id @default(cuid())
  predictionId  String
  title         String
  color         String
  users         Int      @default(0)
  channelPoints Int      @default(0)

  prediction    Prediction @relation(fields: [predictionId], references: [id])
}
```

---

### Story 8.3 – 投票（Polls）管理

- **As a** 實況主
- **I want** 直接從儀表板建立和管理投票
- **So that** 我能讓觀眾參與決策

**技術需求**：

- 建立投票（標題、選項、持續時間）
- 查看即時投票結果
- 結束投票
- 投票歷史記錄

**Twurple 方法**：

- `polls.createPoll()`
- `polls.endPoll()`
- `polls.getPolls()`

**OAuth 權限**：

- `channel:manage:polls`

---

### Story 8.4 – 廣告播放控制

- **As a** 實況主
- **I want** 從儀表板播放廣告
- **So that** 我能在適當時機增加收益

**技術需求**：

- 顯示可播放廣告時長（30s, 60s, 90s, 120s, 150s, 180s）
- 播放廣告按鈕
- 下次可播放廣告的倒數計時
- 廣告播放記錄

**Twurple 方法**：

- `channels.startChannelCommercial()`

**OAuth 權限**：

- `channel:edit:commercial`

---

### Story 8.5 – 直播標記（Stream Markers）

- **As a** 實況主
- **I want** 在直播中建立標記
- **So that** 我能在事後快速找到精彩片段

**技術需求**：

- 建立標記按鈕（可附加描述）
- 標記列表顯示
- 標記跳轉連結

**Twurple 方法**：

- `streams.createStreamMarker()`
- `streams.getStreamMarkers()`

**OAuth 權限**：

- `channel:manage:broadcast`

---

## 3. 技術架構

### 3.1 新增 API 端點

```
PATCH  /api/channel/settings        - 更新頻道設定
GET    /api/games/search            - 搜尋遊戲

POST   /api/predictions             - 建立預測
PATCH  /api/predictions/:id/lock    - 鎖定預測
PATCH  /api/predictions/:id/resolve - 解析預測
DELETE /api/predictions/:id         - 取消預測
GET    /api/predictions             - 預測列表

POST   /api/polls                   - 建立投票
PATCH  /api/polls/:id/end           - 結束投票
GET    /api/polls                   - 投票列表

POST   /api/commercial              - 播放廣告
GET    /api/commercial/status       - 廣告狀態

POST   /api/markers                 - 建立標記
GET    /api/markers                 - 標記列表
```

---

## 4. 時程規劃

### Phase 1（2 週）

- Story 8.1：直播標題/遊戲即時更新
- Story 8.5：直播標記

### Phase 2（2 週）

- Story 8.2：預測管理
- Story 8.4：廣告播放控制

### Phase 3（2 週）

- Story 8.3：投票管理
- 整合測試

**總預估時程**：6 週

---

**文件版本**：v1.0  
**最後更新**：2025-12-16  
**作者**：AI Development Assistant
