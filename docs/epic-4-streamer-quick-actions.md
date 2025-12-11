# Epic 4：實況主快速操作中心（Streamer Quick Actions Hub）

## 1. Epic 概述

### 1.1 背景
實況主在使用分析儀表板時，經常需要快速存取「實況設定管理」與「收益數據分析」功能。目前這些功能分散在 Twitch 官方後台的不同頁面，操作路徑較長。本 Epic 旨在提供一個集中的「快速操作中心」，讓實況主能在一個介面內完成常見的管理與查看任務。

### 1.2 Epic 目標
- 提供實況主一個「快速功能」區塊，集中常用操作入口。
- 讓實況主能在平台內直接調整實況設定（標題、分類、標籤等）。
- 整合收益數據展示，讓實況主能快速查看收入概況。
- 減少實況主在多個平台頁面間切換的時間成本。

---

## 2. 範圍（Scope）

### 2.1 In Scope
- **實況設定管理**：
  - 查看與編輯實況標題、遊戲分類、標籤。
  - 快速更新實況狀態（上線/離線通知設定）。
  - 預設模板管理（儲存常用設定組合）。
  
- **收益數據分析**：
  - 訂閱收入統計（各級訂閱人數與收益預估）。
  - Bits 贊助統計（每日/每週/每月趨勢）。
  - 廣告收益概覽（若 Twitch API 支援）。
  - 收益趨勢圖表與匯出報表功能。

### 2.2 Out of Scope（本 Epic 不做）
- 深度稅務報表或會計功能（僅提供基礎收益統計）。
- 多平台收益整合（YouTube、抖音等）。
- 自動化實況設定排程（未來可能功能）。
- 實際的實況串流控制（開播/停播按鈕）。

---

## 3. 使用者價值（User Value）

- **節省時間**：實況主無需在多個 Twitch 頁面間切換，可在一個介面完成常用操作。
- **提升效率**：預設模板功能讓實況主能快速套用常用設定（如特定遊戲的標題格式）。
- **收益透明**：直觀的收益統計讓實況主更清楚自己的收入來源與趨勢。
- **決策支援**：收益數據可幫助實況主評估不同內容類型或時段的變現效果。

---

## 4. User Stories（Epic 內包含的 Stories）

### Story 4.1 – 實況設定快速管理介面

- **As a** 實況主  
- **I want** 在平台內快速查看與編輯我的實況設定  
- **So that** 我不需要離開當前頁面就能調整標題、分類和標籤  

**重點**：
- 顯示當前實況標題、遊戲分類、標籤列表。
- 提供編輯表單，可直接修改並儲存到 Twitch。
- 即時同步驗證（標題長度、標籤數量限制等）。
- 顯示儲存成功/失敗狀態。

**技術考量**：
- 使用 Twitch API `PATCH /channels` 更新設定。
- 需要 `channel:manage:broadcast` OAuth 權限。
- 前端表單驗證（標題最多 140 字、最多 10 個標籤）。

---

### Story 4.2 – 實況設定預設模板管理

- **As a** 實況主  
- **I want** 儲存與快速套用常用的實況設定組合  
- **So that** 我能在開播不同類型內容時快速切換設定  

**重點**：
- 允許實況主建立多個「設定模板」（例如：遊戲 A 模板、聊天台模板、特別活動模板）。
- 每個模板包含：標題格式、遊戲分類、預設標籤。
- 提供「套用模板」一鍵功能，自動填入對應設定。
- 模板管理介面（新增/編輯/刪除模板）。

**技術考量**：
- 後端新增 `StreamerSettingTemplate` 資料表。
- 欄位：`templateName`, `title`, `gameId`, `tags` (JSON array)。
- 前端提供模板選擇下拉選單與管理介面。

---

### Story 4.3 – 訂閱收益統計總覽

- **As a** 實況主  
- **I want** 查看我的訂閱收益統計與趨勢  
- **So that** 我能了解訂閱收入的變化並評估營運策略  

**重點**：
- 顯示各級訂閱人數（Tier 1/2/3）與對應收益預估。
- 訂閱新增/流失統計（每日/每週/每月）。
- 訂閱趨勢折線圖（時間序列）。
- 可切換時間範圍（7/30/90 天）。

**技術考量**：
- 使用 Twitch API `GET /subscriptions` 獲取訂閱者列表。
- 需要 `channel:read:subscriptions` OAuth 權限。
- 後端新增 `SubscriptionSnapshot` 資料表記錄每日快照。
- 收益預估公式：Tier 1 ($4.99 * 50%)、Tier 2 ($9.99 * 50%)、Tier 3 ($24.99 * 50%)。
- 前端使用 Recharts LineChart 展示趨勢。

---

### Story 4.4 – Bits 贊助統計與趨勢

- **As a** 實況主  
- **I want** 查看我收到的 Bits 贊助統計  
- **So that** 我能了解觀眾的贊助行為與收入貢獻  

**重點**：
- 顯示 Bits 總數與對應收益預估（100 Bits = $1 USD）。
- Top 贊助者排行榜（可選擇是否顯示）。
- Bits 趨勢圖表（每日/每週柱狀圖）。
- 可篩選時間範圍與特定場次。

**技術考量**：
- 使用 Twitch EventSub `channel.cheer` 事件收集 Bits 資料。
- 需要 `bits:read` OAuth 權限。
- 後端新增 `CheerEvent` 資料表記錄每筆贊助。
- 前端使用 Recharts BarChart 展示每日 Bits 統計。
- 隱私設定：允許實況主隱藏 Top 贊助者身份。

---

### Story 4.5 – 收益綜合報表與匯出

- **As a** 實況主  
- **I want** 查看所有收益來源的綜合報表並匯出資料  
- **So that** 我能進行財務記錄與稅務申報  

**重點**：
- 整合訂閱、Bits、廣告（若可用）的收益總覽。
- 提供每月/每季收益匯總報表。
- 匯出功能（CSV/PDF 格式）。
- 收益趨勢對比圖（各來源佔比餅圖）。

**技術考量**：
- 後端整合多個收益來源資料（訂閱、Bits、廣告）。
- 使用 `pdfkit` 或 `puppeteer` 生成 PDF 報表。
- CSV 匯出使用標準格式（日期、來源、金額、備註）。
- 前端使用 Recharts PieChart 展示收益來源佔比。
- 匯出檔案命名格式：`revenue-report-YYYY-MM.csv`。

---

### Story 4.6 – 快速操作區塊 UI 整合

- **As a** 實況主  
- **I want** 在儀表板首頁看到一個「快速功能」區塊  
- **So that** 我能快速存取設定管理與收益分析功能  

**重點**：
- 在儀表板首頁頂部新增「快速功能」卡片區塊。
- 包含兩個主要按鈕：「管理實況設定」、「查看收益分析」。
- 點擊後可展開或跳轉至對應功能頁面。
- 響應式設計（桌面版並排、移動版堆疊）。

**技術考量**：
- 前端新增 `QuickActionsPanel` 元件。
- 使用 Tailwind CSS 實現響應式布局。
- 按鈕設計遵循現有 UI 規範（紫色主題）。
- 可選擇使用 Modal 彈窗或獨立頁面展示詳細功能。

---

## 5. 技術架構概要

### 5.1 新增資料表

#### `StreamerSettingTemplate`
```sql
CREATE TABLE StreamerSettingTemplate (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  streamerId INTEGER NOT NULL,
  templateName TEXT NOT NULL,
  title TEXT,
  gameId TEXT,
  gameName TEXT,
  tags TEXT, -- JSON array
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (streamerId) REFERENCES Streamer(id)
);
```

#### `SubscriptionSnapshot`
```sql
CREATE TABLE SubscriptionSnapshot (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  streamerId INTEGER NOT NULL,
  snapshotDate DATE NOT NULL,
  tier1Count INTEGER DEFAULT 0,
  tier2Count INTEGER DEFAULT 0,
  tier3Count INTEGER DEFAULT 0,
  totalSubscribers INTEGER DEFAULT 0,
  estimatedRevenue REAL, -- 預估收益 (USD)
  FOREIGN KEY (streamerId) REFERENCES Streamer(id),
  UNIQUE(streamerId, snapshotDate)
);
```

#### `CheerEvent`
```sql
CREATE TABLE CheerEvent (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  streamerId INTEGER NOT NULL,
  userId TEXT, -- Twitch User ID (可匿名)
  userName TEXT, -- 顯示名稱 (可匿名)
  bits INTEGER NOT NULL,
  message TEXT,
  isAnonymous BOOLEAN DEFAULT 0,
  cheeredAt DATETIME NOT NULL,
  FOREIGN KEY (streamerId) REFERENCES Streamer(id)
);
```

### 5.2 新增 OAuth 權限需求

Epic 4 需要以下額外 Twitch OAuth Scopes：
- `channel:manage:broadcast` - 管理實況設定
- `channel:read:subscriptions` - 讀取訂閱資料
- `bits:read` - 讀取 Bits 贊助資料

需要更新 Story 1.1 的 OAuth 授權流程，將這些權限納入請求範圍。

### 5.3 前端新增元件

- `QuickActionsPanel.tsx` - 快速功能區塊
- `StreamSettingsEditor.tsx` - 實況設定編輯表單
- `TemplateManager.tsx` - 設定模板管理
- `RevenueOverview.tsx` - 收益總覽儀表板
- `SubscriptionStats.tsx` - 訂閱統計圖表
- `BitsStats.tsx` - Bits 統計圖表
- `RevenueReport.tsx` - 綜合報表與匯出

### 5.4 後端新增 API 端點

```
POST   /api/streamer/settings          - 更新實況設定
GET    /api/streamer/settings          - 獲取當前設定

POST   /api/streamer/templates         - 建立設定模板
GET    /api/streamer/templates         - 列出所有模板
PUT    /api/streamer/templates/:id     - 更新模板
DELETE /api/streamer/templates/:id     - 刪除模板

GET    /api/streamer/revenue/overview  - 收益總覽
GET    /api/streamer/revenue/subscriptions - 訂閱統計
GET    /api/streamer/revenue/bits      - Bits 統計
GET    /api/streamer/revenue/export    - 匯出報表
```

---

## 6. 依賴關係

### 6.1 Epic 依賴
- **必須先完成 Story 1.1**（實況主登入與授權）才能開始 Epic 4。
- Epic 4 與 Epic 2/3 無直接依賴，可並行開發。

### 6.2 Story 內部依賴
- Story 4.6（UI 整合）可與其他 Stories 並行開發。
- Story 4.5（綜合報表）依賴 Story 4.3 和 4.4 的資料收集完成。
- Story 4.1 和 4.2 可並行開發（功能獨立）。

---

## 7. 風險與限制

### 7.1 技術風險
- **Twitch API 限制**：部分收益資料（如廣告收入）可能無法透過 API 取得。
- **權限範圍擴大**：新增 OAuth 權限可能影響使用者授權意願。
- **資料延遲**：訂閱與 Bits 資料可能有延遲（非即時更新）。

### 7.2 產品風險
- **使用者隱私**：收益資料較為敏感，需要特別注意資料安全與隱私保護。
- **功能重複**：Twitch 官方後台已有類似功能，需要提供額外價值（如更好的 UX、整合度）。

### 7.3 緩解策略
- 明確標示「預估收益」而非實際收益（Twitch 分潤比例可能因合約而異）。
- 提供清楚的隱私聲明，說明資料用途與儲存方式。
- 若 API 限制無法取得某些資料，提供連結跳轉至 Twitch 官方頁面。

---

## 8. 成功指標

### 8.1 定量指標
- **快速功能使用率**：至少 60% 的實況主每週使用一次快速功能區塊。
- **設定更新頻率**：平均每位實況主每月更新設定至少 3 次。
- **模板使用率**：至少 40% 的實況主建立並使用設定模板。
- **收益查看頻率**：平均每位實況主每週查看收益統計至少 1 次。

### 8.2 定性指標
- 實況主回饋：「快速功能讓我節省了時間」（使用者滿意度 > 4/5）。
- 減少跳轉至 Twitch 官方後台的次數（從使用行為分析）。

---

## 9. 時程規劃建議

### Phase 1：基礎功能（2-3 週）
- Story 4.1：實況設定管理
- Story 4.6：快速操作區塊 UI

### Phase 2：進階功能（2-3 週）
- Story 4.2：設定模板管理
- Story 4.3：訂閱收益統計

### Phase 3：完整收益分析（2-3 週）
- Story 4.4：Bits 贊助統計
- Story 4.5：綜合報表與匯出

**總預估時程**：6-9 週（依團隊資源與優先順序調整）

---

## 10. 開放議題（Open Questions）

1. **廣告收益資料**：Twitch API 是否提供廣告收益查詢端點？（需進一步調查）
2. **多幣別支援**：是否需要支援多幣別顯示（USD、EUR、TWD 等）？
3. **實時更新**：收益資料是否需要實時更新，還是每日批次更新即可？
4. **模板分享**：是否允許實況主分享模板給其他使用者？（社群功能）
5. **稅務報表**：是否需要提供符合特定國家稅務要求的報表格式？

---

## 11. 附錄

### 11.1 Twitch API 參考文件
- [Update Channel Information](https://dev.twitch.tv/docs/api/reference#modify-channel-information)
- [Get Broadcaster Subscriptions](https://dev.twitch.tv/docs/api/reference#get-broadcaster-subscriptions)
- [EventSub: channel.cheer](https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types#channelcheer)

### 11.2 設計參考
- Twitch Creator Dashboard
- StreamElements Dashboard
- Streamlabs Dashboard

---

**文件版本**：v1.0  
**最後更新**：2025-12-11  
**作者**：Bob (Scrum Master)
