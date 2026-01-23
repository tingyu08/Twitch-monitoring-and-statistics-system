# Twitch 實況監控與統計平台 – Full Stack Architecture

## 1. 文件目的與範圍

本文件描述 Twitch 實況監控與統計平台的**整體系統架構（前後端與資料層）**，目標是：

- 對齊 `docs/prd.md` 與 `docs/front-end-spec.md` 中的功能 / UX / NFR 要求
- 清楚說明前端、後端、排程與資料庫之間的責任切分與資料流
- 作為未來故事實作與技術決策的參考基準

> 關聯文件：
>
> - `docs/prd.md`
> - `docs/front-end-spec.md`
> - `docs/architecture/front-end-architecture.md`

---

## 2. 高層系統概觀

### 2.1 組成元件

- **前端 Web App**
  - Next.js（React + TypeScript + Tailwind），實作 Landing、Streamer Dashboard、Viewer
    Dashboard、Settings 等頁。
  - 僅透過自家後端 API 取得彙總後統計資料。

- **後端 API Server**
  - 提供 REST API /（可選）GraphQL API 給前端呼叫。
  - 負責：Twitch OAuth 流程、存取 Token、商業邏輯與彙總查詢。

- **資料收集與排程 Job**
  - 週期性（5–15 分鐘級）向 Twitch API 抓取最新數據。
  - 寫入本地資料庫的「開台紀錄與互動統計」彙總表。

- **資料庫（DB）**
  - 關聯式資料庫（例如 PostgreSQL）。
  - 儲存實況主、觀眾、開台紀錄、彙總統計與授權資訊。

### 2.2 高層架構圖（文字版）

```text
[Browser / Client]
   │  HTTPS
   ▼
[Next.js Frontend]
   │  /api/*
   ▼
[Backend API Server]
   │         ▲
   │SQL/ORM  │HTTP (Twitch API)
   ▼         │
[PostgreSQL] └── [Twitch API]
   ▲
   │
[Scheduler / Jobs]
```

---

## 3. 後端技術選擇與模組切分

### 3.1 技術棧（建議）

- **Runtime**：Node.js（LTS）
- **框架**：
  - Express / Fastify / NestJS 三擇一（依團隊偏好），下文以「HTTP Framework」泛稱。
- **ORM**：Prisma / TypeORM（擇一）
- **資料庫**：PostgreSQL
- **排程**：
  - Node 端使用 node-cron 或由外部排程（如 Cloud Scheduler + HTTP Trigger）呼叫 Job Endpoint。
- **認證**：
  - JWT（前端保存短期 Access Token，後端管理 Refresh Token / Session）
  - 或透過 HTTP-only Cookie 儲存 Session Token。

### 3.2 後端模組切分

建議目錄結構（示意）：

```text
backend/
  src/
    app.ts / main.ts              # HTTP 伺服器進入點

    modules/
      auth/                       # Twitch OAuth、JWT/Session
        auth.controller.ts
        auth.service.ts
        twitch-oauth.client.ts

      streamer/                   # 實況主儀表板相關 API
        streamer.controller.ts
        streamer.service.ts
        streamer.repository.ts

      viewer/                     # 觀眾儀表板相關 API
        viewer.controller.ts
        viewer.service.ts
        viewer.repository.ts

      ingest/                     # Twitch 資料收集與彙總
        ingest.job.ts
        ingest.service.ts
        twitch-api.client.ts

    db/
      schema.prisma / entities.ts # 資料模型定義
      migrations/

    config/
      env.ts                      # 環境變數讀取
      rate-limit.ts               # Twitch Rate Limit 與內部節流設定

    infra/
      logger.ts
      http-client.ts              # 共用 HTTP 客戶端（呼叫 Twitch API）
```

---

## 4. 資料模型設計（Data Model）

### 4.1 核心實體

對應 PRD 4.3 / FR-P2，僅存「彙總後」統計，避免儲存所有原始聊天內容。

- `Streamer`
  - `id`（內部 UUID）
  - `twitchUserId`, `displayName`, `avatarUrl`
  - `createdAt`, `updatedAt`

- `Viewer`
  - `id`（內部 UUID）
  - `twitchUserId`, `displayName`（可選）
  - `createdAt`, `updatedAt`

- `Channel`（通常 1:1 對應 Streamer，也可預留多頻道）
  - `id`, `streamerId`, `twitchChannelId`

- `StreamSession`（開台紀錄，粗粒度）
  - `id`, `channelId`
  - `startedAt`, `endedAt`
  - `durationSeconds`
  - 其他：平均同時在線（若 API 可得）、標題、分類等（可選）。

- `ViewerChannelDailyStat`（觀眾在某頻道每日彙總）
  - `id`, `viewerId`, `channelId`, `date`
  - `watchSeconds`
  - `messageCount`
  - `emoteCount`（視 Twitch API 能力）

- `ChannelDailyStat`（實況主每日彙總）
  - `id`, `channelId`, `date`
  - `streamSeconds`（當日開台總秒數）
  - `streamCount`
  - `avgViewers`（若可得）
  - `subsTotal` / `subsDelta`（視 API 能力與 PRD Story 1.4 實作結果）

- `TwitchToken`（授權管理）
  - `id`, `ownerType`（'streamer' | 'viewer' | 'system'）
  - `ownerId`（對應 Streamer / Viewer）
  - `accessToken`, `refreshToken`, `expiresAt`, `scopes[]`

### 4.2 隱私與刪除

對應 FR-V5 / NFR-S2–S3：

- 觀眾要求刪除 / 匿名化時：
  - 可選擇「軟刪除」：移除 `Viewer` 與 `ViewerChannelDailyStat`
    之間的關聯（以匿名 ID 替代），但保留總體統計。
  - 或「硬刪除」：刪除 `Viewer` 相關所有記錄（取決於實際隱私策略）。

---

## 5. 資料收集與排程架構

### 5.1 Twitch API 串接

對應 PRD 4.3 Story 3.1–3.3：

- 使用官方 Twitch API，建立：
  - OAuth Client（Client ID / Secret）
  - Token Refresh 流程（定期更新或在 401 後自動刷新）。
- 檢查 Twitch Rate Limit：
  - 在 `twitch-api.client.ts` 中加入節流與重試機制（如指數退避）。

### 5.2 排程 Job

- Job 類型（可視實際資源分拆）：
  1. **Streamer Stats Job**：抓取實況主的開台紀錄、訂閱等統計，寫入 `StreamSession` /
     `ChannelDailyStat`。
  2. **Viewer Engagement Job**：在合法前提下，從聊天/觀看資料來源取得觀眾觀看與互動彙總，寫入
     `ViewerChannelDailyStat`。
- 頻率：
  - 核心統計（開台時數等）：5–15 分鐘一次。
  - 較重的統計（例如大型觀眾清單彙總）：可拉長至 30–60 分鐘。

### 5.3 Job 可靠性

- 所有 Job 執行結果需寫入 log（對應 NFR-A2 / 監控要求）：
  - 成功 / 失敗次數、最後錯誤訊息。

---

## 6. API 設計與前端整合

### 6.1 認證與授權

- 使用 Twitch OAuth 登入後：
  - 後端建立 / 更新對應的 `Streamer` 或 `Viewer` 記錄。
  - 建立平台內 Session / JWT，包含：`userId`, `role: 'streamer' | 'viewer'`。
- 前端：
  - 使用 HTTP-only Cookie 或 Authorization Header 攜帶 Token。
  - 透過 Next.js Middleware 保護 `/dashboard/*` 與 `/settings`。

### 6.2 範例 REST API 介面

> 實際路徑與欄位可在實作前再細化成 OpenAPI Spec。

- 實況主側：

```http
GET /api/streamer/me/summary?range=30d
GET /api/streamer/me/time-series?range=30d&granularity=day
GET /api/streamer/me/heatmap?range=30d
GET /api/streamer/me/subs-trend?range=90d   # 若 API 能提供
```

- 觀眾側：

```http
GET /api/viewer/me/summary?channelId=...
GET /api/viewer/me/time-series?channelId=...&range=30d
GET /api/viewer/me/engagement?channelId=...&range=30d
DELETE /api/viewer/me/stats   # 刪除/匿名化自身統計資料
```

- 系統 / 管理：

```http
POST /api/ingest/run (受保護；通常只供排程觸發)
```

### 6.3 與前端的資料契約

- 所有回傳 JSON 需：
  - 清楚標示單位（秒、分鐘、小時等）
  - 針對估算值加上 `isEstimated: true` 與簡短理由（供前端顯示 Banner）
- 例如：

```json
{
  "range": "2024-01-01..2024-01-31",
  "totalStreamSeconds": 36000,
  "streamCount": 20,
  "avgStreamLengthSeconds": 1800,
  "subs": {
    "hasExactData": false,
    "isEstimated": true,
    "estimateSource": "Twitch API does not expose precise daily subs; using proxy metric X",
    "currentTotal": 120,
    "delta": 15
  }
}
```

---

## 7. 安全性與隱私（Security & Privacy）

對應 NFR-S1–S3：

- 所有前後端流量使用 **HTTPS**。
- 不儲存 Twitch 密碼，只保存必要 Token，並：
  - 儲存在安全的密文欄位或使用 Secret Manager。
  - 嚴格控管 token scope，只請求必要權限。
- 避免將個別觀眾明細暴露給實況主：
  - 儀表板以彙總統計為主。
  - 若未來要顯示觀眾列表，需在 PRD / 法務 / 使用者預期中取得共識再設計。

---

## 8. 非功能需求對齊（NFR Alignment）

### 8.1 效能（NFR-P1–P3）

- 前端：Next.js SSR / SSG + React Query 快取，以達成儀表板 TTFB / TTI 目標。
- 後端：
  - 彙總查詢加上必要索引（日期、channelId、viewerId 等）。
  - 對時間序列查詢進行分頁或限制最大範圍（例如 1 年）。
- 排程：
  - 尊重 Twitch Rate Limit，將重負載任務分散在時間內執行。

### 8.2 可用性與穩定性（NFR-A1–A2）

- Job 失敗時寫入錯誤 log，並可選擇發送告警（Email / Slack / 監控平台）。
- 關鍵 API 端點加入合理重試策略與熔斷保護，避免下游 Twitch API 長期失效拖垮整體。

### 8.3 可訪問性與 UX

- 前端實作遵循 `docs/front-end-spec.md` 中的色彩對比、鍵盤操作、圖表文字敘述與非顏色提示規範。

---

## 9. 部署與環境（概略）

> 具體雲服務與 CI/CD 流程可在之後架構文件中細化。

- **環境**：`dev / staging / prod` 至少三個。
- **部署建議**：
  - 前端：Next.js App 可部署在 Vercel / 自建 Node 容器。
  - 後端 API + Job：Docker 容器（Kubernetes / ECS / Cloud Run 等）。
  - DB：Managed PostgreSQL（RDS / Cloud SQL / Supabase 等）。

---

## 10. 後續工作建議

1. 根據本文件萃取出 OpenAPI / GraphQL Schema，明確定義所有 API 契約。
2. 以此架構在 repo 中建立 `backend/` skeleton，包含基礎 HTTP 伺服器、認證骨架與 DB Schema 初稿。
3. 搭配 `front-end-architecture.md`，定義端對端開發流程：
   - Story 從 PRD → 前端 / 後端子任務拆解 → 測試與驗收對應。
