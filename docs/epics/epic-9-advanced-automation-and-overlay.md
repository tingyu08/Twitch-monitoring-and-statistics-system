# Epic 9：進階自動化與互動圖層（Advanced Automation & Interactive Overlay）

## 1. Epic 概述

### 1.1 背景

實況主希望直播內容能更具互動性與自動化，減少手動操作的負擔。透過聊天室分析與 OBS Overlay 技術，我們可以實現「觀眾行為觸發特效」與「精彩時刻自動剪輯」，大幅提升直播的觀賞性與效率。

### 1.2 Epic 目標

- 自動偵測精彩時刻並建立剪輯 (Clip)
- 提供基於聊天室關鍵字的視覺特效 Overlay
- 建立即時互動的反饋機制

---

## 2. User Stories

### Story 9.1 – 智慧剪輯偵測 (Smart Clipping)

- **As a** 實況主
- **I want** 系統能自動幫我剪輯精彩片段
- **So that** 我不需要自己在直播中分心去按剪輯按鈕，也不會錯過精華

**應用場景**：

- **笑點偵測**：當 10 秒內聊天室出現大量 "LUL", "笑死", "wwwww" (暴動指數 > 閾值)，自動觸發剪輯。
- **神操作偵測**：當出現 "POG", "神", "666" 時觸發。
- **大額抖內**：當收到超過 1000 Bits 時自動剪輯。

**技術需求**：

- 即時分析 Chat Client 訊息流 (Sliding Window Algorithm)
- 呼叫 Twitch Create Clip API (`clips.createClip`)
- 儲存剪輯連結至資料庫 `SmartClip` 表

---

### Story 9.2 – 關鍵字特效圖層 (Keyword VFX Overlay)

- **As a** 實況主
- **I want** 觀眾輸入特定關鍵字時，畫面能出現對應特效
- **So that** 觀眾更有參與感，覺得自己能影響直播畫面

**應用場景**：

- **魔法咒語**：觀眾輸入 "!fire"，畫面從四周噴出火焰 GIF/WebM。
- **全體慶祝**：觀眾輸入 "!gg"，畫面落下彩帶雨。
- **自訂配置**：實況主可在後台上傳圖片/影片並設定對應關鍵字。

**技術需求**：

- 前端開發透明背景的 Overlay 頁面 (用於 OBS Browser Source)
- WebSocket 接收後端 Chat Listener 傳來的關鍵字事件
- 前端播放 CSS Animation 或 Canvas 特效

---

### Story 9.3 – 虛擬替身連動基礎 (Avatar Integration)

- **As a** VTuber / 虛擬實況主
- **I want** 聊天室指令能控制我的 Live2D/3D 模型動作
- **So that** 創造更有趣的互動效果

**應用場景**：

- **摸頭**：觀眾輸入 "!pat"，模型做出被摸頭的表情。
- **驚嚇**：收到大額抖內時，模型自動做出驚嚇動作。

**技術需求**：

- 提供 WebSocket API 供 VTube Studio 或其他軟體 (透過 Plugin) 串接
- 本階段先實作標準化的 Event Trigger (JSON Payload)

---

## 3. 技術架構

### 3.1 新增資料表

```prisma
model SmartClipTrigger {
  id            String   @id @default(cuid())
  streamerId    String
  name          String   // e.g. "Laughter"
  keywords      String   // JSON array: ["lol", "haha"]
  threshold     Int      // message count per 10s
  cooldown      Int      // seconds
  enabled       Boolean  @default(true)

  streamer      Streamer @relation(fields: [streamerId], references: [id])
}

model OverlayEffect {
  id            String   @id @default(cuid())
  streamerId    String
  keyword       String   // e.g. "!fire"
  assetUrl      String   // Image/Video URL
  duration      Int      // ms
  position      String   // "center", "random", "falling"
  cooldown      Int
  enabled       Boolean  @default(true)

  streamer      Streamer @relation(fields: [streamerId], references: [id])
}
```

### 3.2 新增 API 端點

```
POST   /api/helix/clip              - 手動觸發剪輯
GET    /api/overlay/:token          - Overlay OBS 專用頁面
GET    /api/settings/triggers       - 設定剪輯觸發條件
GET    /api/settings/overlay        - 設定特效配置
```

---

## 4. 時程規劃

### Phase 1

- Story 9.1：智慧剪輯偵測 (後端邏輯為主)

### Phase 2

- Story 9.2：關鍵字特效圖層 (前端特效為主)

**總預估時程**：4 週

---

**文件版本**：v1.0
**作者**：Scrum Master Agent
