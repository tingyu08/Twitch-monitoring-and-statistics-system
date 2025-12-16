# Epic 7：社群互動管理（Community & Moderation Tools）

## 1. Epic 概述

### 1.1 背景

實況主需要管理聊天室與社群互動，包括版主操作、關鍵字過濾、觀眾行為分析等。Twurple 提供了完整的聊天室控制和版主功能 API，可以建立進階的社群管理工具。

### 1.2 Epic 目標

- 提供聊天室管理控制面板
- 實現自動化版主功能（AutoMod 輔助）
- 觀眾行為分析與忠誠度追蹤
- 禁言/Ban 記錄與管理

---

## 2. User Stories

### Story 7.1 – 聊天室即時監控面板

- **As a** 實況主/版主
- **I want** 在儀表板即時查看聊天室活動
- **So that** 我能快速掌握聊天氛圍

**技術需求**：

- 使用 `@twurple/chat` 監聽訊息
- 顯示訊息速率（messages/minute）
- 即時關鍵字雲/熱門表情統計
- 可疑訊息標記（連結、大量表情）

**Twurple 整合**：

- 事件監聽器：`chatClient.onMessage`
- 訊息解析：`TwitchPrivateMessage` (包含徽章、表情、發送者資訊)

---

### Story 7.2 – 版主操作介面

- **As a** 實況主/版主
- **I want** 在平台內執行版主操作
- **So that** 不需要切換到 Twitch 聊天室

**技術需求**：

- 禁言（Timeout）功能
- 永久封鎖（Ban）功能
- 刪除訊息功能
- 慢速模式/訂閱者模式控制

**Twurple 整合**：

- `ChatClient.ban()`, `ChatClient.timeout()`
- `ChatClient.deleteMessage()`
- `ChatClient.slow()`, `ChatClient.subscribersOnly()`

**新增 OAuth 權限**：

- `channel:moderate`
- `moderator:manage:banned_users`
- `moderator:manage:chat_messages`

---

### Story 7.3 – Ban/Timeout 記錄管理

- **As a** 實況主
- **I want** 查看所有 Ban 和 Timeout 記錄
- **So that** 我能追蹤問題觀眾並管理名單

**新增資料表**：

```prisma
model ModerationAction {
  id            String   @id @default(cuid())
  streamerId    String
  moderatorId   String?
  moderatorName String?
  targetUserId  String
  targetUserName String
  action        String   // "ban", "timeout", "unban"
  duration      Int?     // 秒（僅 timeout）
  reason        String?
  actionAt      DateTime

  streamer      Streamer @relation(fields: [streamerId], references: [id])
}
```

---

### Story 7.4 – 觀眾忠誠度分析

- **As a** 實況主
- **I want** 查看我的忠誠觀眾排行榜
- **So that** 我能認識並感謝我的核心粉絲

**技術需求**：

- 統計觀眾觀看時數
- 統計觀眾留言數量
- 統計觀眾訂閱/贊助貢獻
- 產生 Top 10/50/100 忠誠觀眾排行

---

### Story 7.5 – 自動化版主規則

- **As a** 實況主
- **I want** 設定自動化版主規則
- **So that** 系統能自動處理違規訊息

**技術需求**：

- 關鍵字黑名單過濾
- 連結自動刪除（非白名單）
- 大量表情過濾
- 新帳號發言限制

---

## 3. 技術架構

### 3.1 新增 API 端點

```
GET    /api/chat/live               - 即時聊天監控（WebSocket）
POST   /api/moderation/ban          - 封鎖用戶
POST   /api/moderation/timeout      - 禁言用戶
DELETE /api/moderation/ban/:userId  - 解除封鎖
GET    /api/moderation/actions      - 版主操作記錄

GET    /api/analytics/top-viewers   - 忠誠觀眾排行
GET    /api/analytics/viewer/:id    - 單一觀眾詳細資訊

POST   /api/automod/rules           - 建立自動版主規則
GET    /api/automod/rules           - 列出規則
PUT    /api/automod/rules/:id       - 更新規則
DELETE /api/automod/rules/:id       - 刪除規則
```

---

## 4. 時程規劃

### Phase 1（2 週）

- Story 7.1：聊天室即時監控面板
- Story 7.2：版主操作介面

### Phase 2（2 週）

- Story 7.3：Ban/Timeout 記錄管理
- Story 7.4：觀眾忠誠度分析

### Phase 3（2 週）

- Story 7.5：自動化版主規則

**總預估時程**：6 週

---

**文件版本**：v1.0  
**最後更新**：2025-12-16  
**作者**：AI Development Assistant
