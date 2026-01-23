# Twitch 實況監控與統計平台 – 開發環境與啟動指南（Dev Setup）

本文件說明如何在本機啟動整個專案（前端 + 後端 + DB／排程骨架），以及最小可行的 CI
/ 測試流程，協助新成員與 Dev Agent 快速進入狀況。

> 關聯文件：
>
> - `docs/project-brief.md`
> - `docs/prd.md`
> - `docs/architecture/fullstack-architecture.md`
> - `docs/architecture/front-end-architecture.md`

---

## 1. 基本開發環境需求

- **Node.js**：LTS 版本（建議 `>= 18.x`）
- **套件管理工具**：npm / pnpm / yarn（三擇一，待實際 repo 建立後再鎖定）
- **資料庫**：PostgreSQL（本機或 Docker 皆可）
- **Git**：用於版本控制

> 未來若實作後端時採用 Prisma / TypeORM，請依實際選擇補充 CLI 安裝與使用方式。

---

## 2. 專案結構（預期）

實際 repo 建立後，預期結構會對齊架構文件：

```text
.
├── backend/              # 後端 API + 排程 Jobs
│   └── ...               # 依 fullstack-architecture.md 建議的 modules/ 結構
├── frontend/             # Next.js 前端 App
│   └── ...               # 對齊 front-end-architecture.md 的 src/app + features 結構
└── docs/                 # 目前的文件目錄
```

> 若採單一 monorepo，可在根目錄使用 workspace（pnpm/yarn
> workspace 或 TurboRepo 等），此處先不強制規範，交由實際實作時決定。

---

## 3. 環境變數與機密（.env）

請不要把實際機密值 commit 進版本庫，僅提交範例檔案 **`.env.example`**。  
建議至少包含：

```env
# 共用
NODE_ENV=development

# Twitch OAuth
TWITCH_CLIENT_ID=your_twitch_client_id
TWITCH_CLIENT_SECRET=your_twitch_client_secret
TWITCH_REDIRECT_URI=http://localhost:3000/auth/callback

# Backend API
API_BASE_URL=http://localhost:4000

# PostgreSQL 連線
DATABASE_URL=postgres://user:password@localhost:5432/twitch_analytics
```

實際專案建立後，請：

1. 在 root 目錄放置 `.env.example`，以便新成員複製為 `.env`。
2. 於 CI / 部署平台（如 Vercel、Railway、Render 等）透過 UI 設定機密，而非硬編碼在 repo。

---

## 4. 本機啟動流程（草案）

> 以下為 **預期流程草稿**，實際指令需在 repo 建立後更新。目標是讓 Dev
> Agent 有一個清楚的「應該存在」的流程雛形。

### 4.1 安裝依賴

在專案根目錄：

```bash
# 選擇一種套件管理工具
npm install
# 或
pnpm install
```

若採前後端分倉：

```bash
cd backend && npm install
cd ../frontend && npm install
```

### 4.2 啟動資料庫

本機可直接啟動 PostgreSQL，或使用 Docker：

```bash
docker run --name twitch-analytics-db -e POSTGRES_PASSWORD=devpass \
  -e POSTGRES_USER=devuser -e POSTGRES_DB=twitch_analytics \
  -p 5432:5432 -d postgres:15
```

> 首次啟動後端前，記得執行 DB
> schema／migrations，指令依 ORM 決定（例如 Prisma：`npx prisma migrate dev`）。

### 4.3 啟動後端（預期）

```bash
cd backend
# 開發模式
npm run dev
```

預期後端會在 `http://localhost:4000` 提供：

- REST API：`/api/streamer/*`, `/api/viewer/*`, `/api/ingest/*`
- OAuth 登入端點：`/auth/twitch/login`, `/auth/twitch/callback`

實際路由請對齊 `docs/architecture/fullstack-architecture.md` 中的 API 設計章節。

### 4.4 啟動前端（Next.js）

```bash
cd frontend
npm run dev
```

預期開發環境網址：

- `http://localhost:3000/` – Landing Page
- `http://localhost:3000/dashboard/streamer` – 實況主儀表板
- `http://localhost:3000/dashboard/viewer` – 觀眾儀表板

---

## 5. 最小可行 CI / 測試流程（草案）

在真正上線前，建議至少建立以下 CI 步驟（以 GitHub Actions 為例，實際檔案可命名為
`.github/workflows/ci.yml`）：

1. **安裝依賴**
2. **前端檢查**
   - `cd frontend && npm run lint`
   - `cd frontend && npm test`（若有測試）
3. **後端檢查**
   - `cd backend && npm run lint`
   - `cd backend && npm test`
4. **格式檢查（可選）**
   - `npm run format:check`

> 具體指令名稱依實際 `package.json` 中 scripts 為準。

---

## 6. Migration / 部署注意事項（高層）

1. **Migration 流程**
   - 在每次 schema 變更時，務必先在 `dev` 執行 migration，驗證無誤後再推到 `staging` / `prod`。
   - 建議統一使用 ORM 的 migration 工具（Prisma Migrate / TypeORM migration）。

2. **部署順序建議**
   1. 更新 DB schema（migration）。
   2. 部署後端 API（確保相容舊版前端）。
   3. 部署前端。

3. **Rollback（概念層）**
   - 若新版本導致重大錯誤，請確保：
     - 前端可快速回滾到前一版（例如 Vercel 版控）。
     - 後端容器／服務可回滾至前一映像檔。
     - 若有 destructive migration，需先備份或設計可逆策略。

實際的 CI / CD 與 IaC 方案，請在選定雲平台後再補充到新的架構／部署文件中。

---

## 7. 給 Dev / Dev Agent 的使用建議

- 在開始實作任何 Story 前，先閱讀：
  - `docs/prd.md`
  - `docs/architecture/fullstack-architecture.md`
  - `docs/architecture/front-end-architecture.md`
  - 對應 Epic 與 Story 檔案（例如 `docs/epic-1-*.md`, `docs/stories/1.1.*.md`）
- 依本文件完成：
  1. `.env` 設定
  2. DB 啟動與 migrations
  3. 前後端啟動
- 若實際 repo 的指令或目錄結構與本文件不符，請在實作後**同步更新本文件**，確保後續成員與 Agent 不會踩到過期資訊。
