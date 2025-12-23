# 🎮 Twitch Analytics - 直播數據分析平台

一個功能完整的全端 Web 應用程式，為 **實況主** 和 **觀眾** 提供深度的 Twitch 直播數據分析與個人統計追蹤。

![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat-square&logo=typescript&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js_14-000000?style=flat-square&logo=next.js&logoColor=white)
![React](https://img.shields.io/badge/React_18-20232A?style=flat-square&logo=react&logoColor=61DAFB)
![Node.js](https://img.shields.io/badge/Node.js-43853D?style=flat-square&logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-404D59?style=flat-square&logo=express&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-2D3748?style=flat-square&logo=prisma&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-07405E?style=flat-square&logo=sqlite&logoColor=white)
![Playwright](https://img.shields.io/badge/Playwright-45ba4b?style=flat-square&logo=playwright&logoColor=white)
![Tests](https://img.shields.io/badge/Tests-235%2B_Passing-brightgreen?style=flat-square)

---

## ✨ 功能亮點

### 🎥 實況主儀表板 (Streamer Dashboard)

| 功能             | 說明                                                |
| ---------------- | --------------------------------------------------- |
| **會話統計總覽** | 即時顯示總直播時數、場次數量、平均時長、巔峰觀眾    |
| **觀眾趨勢圖表** | Recharts 繪製的時間序列折線圖，支援 24h/7d/30d 切換 |
| **直播熱力圖**   | 視覺化每週各時段的直播頻率分布                      |
| **訂閱趨勢分析** | 訂閱人數變化與增長率計算                            |
| **偏好設定**     | 自訂顯示/隱藏區塊，設定自動儲存至 localStorage      |

### 👤 觀眾儀表板 (Viewer Dashboard)

| 功能             | 說明                                               |
| ---------------- | -------------------------------------------------- |
| **個人觀影統計** | 追蹤在各頻道的觀看時數、留言數、表情符號使用       |
| **聊天互動分析** | 留言趨勢圖、互動類型分佈（訂閱/Cheer/Raid 等）     |
| **足跡總覽**     | 🏆 成就徽章系統 + 六維雷達圖分析觀眾投入畫像       |
| **可拖拽佈局**   | 使用 `react-grid-layout` 實現自訂儀表板排版        |
| **隱私控制**     | GDPR 合規：10 項細粒度收集開關、資料匯出、帳號刪除 |

### 🔐 認證與安全

- **Twitch OAuth 2.0** 整合登入
- **JWT Token** 搭配 HttpOnly Cookie
- **雙重角色機制**：實況主自動獲得觀眾身份
- **同意授權流程**：首次登入需明確同意收集條款

---

## 🏗️ 技術架構

```
┌─────────────────────────────────────────────────────────────┐
│                      Frontend (Next.js 14)                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ Streamer    │  │ Viewer      │  │ Privacy Settings    │  │
│  │ Dashboard   │  │ Dashboard   │  │ & Consent           │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
│         │                │                    │             │
│         └────────────────┼────────────────────┘             │
│                          ▼                                  │
│               SWR (Data Fetching & Caching)                 │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTPS
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                     Backend (Express.js)                    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ Auth Module │  │ Streamer    │  │ Viewer Module       │  │
│  │ (OAuth/JWT) │  │ Module      │  │ (Stats/Privacy)     │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
│         │                │                    │             │
│         └────────────────┼────────────────────┘             │
│                          ▼                                  │
│               Prisma ORM + SQLite                           │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ 17+ Models: Streamer, Viewer, Channel, Stats,        │   │
│  │ LifetimeStats, Privacy, ExportJob, AuditLog...       │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
              ┌─────────────────────────┐
              │   Twitch API (Twurple)  │
              │   • Helix API           │
              │   • Chat (IRC)          │
              │   • DecAPI (Followage)  │
              └─────────────────────────┘
```

### 前端技術棧

| 技術              | 版本    | 用途                    |
| ----------------- | ------- | ----------------------- |
| Next.js           | 14.2.33 | React 框架 (App Router) |
| React             | 18.3.1  | UI 函式庫               |
| TypeScript        | 5.6.3   | 類型安全                |
| TailwindCSS       | 3.4.14  | 樣式框架                |
| Recharts          | 3.5.1   | 資料視覺化圖表          |
| SWR               | 2.3.7   | 資料獲取與快取          |
| react-grid-layout | 2.1.0   | 可拖拽網格佈局          |
| Lucide React      | 0.561.0 | 圖示庫                  |

### 後端技術棧

| 技術            | 版本   | 用途              |
| --------------- | ------ | ----------------- |
| Node.js         | 20.x   | 執行環境          |
| Express         | 4.19.2 | HTTP 框架         |
| TypeScript      | 5.6.3  | 類型安全          |
| Prisma          | 7.1.0  | ORM               |
| SQLite (LibSQL) | -      | 資料庫            |
| Twurple         | 8.0.2  | Twitch API 客戶端 |
| node-cron       | 4.2.1  | 排程任務          |
| Archiver        | 7.0.1  | 資料匯出 ZIP 打包 |

### 測試工具

| 工具                  | 用途             |
| --------------------- | ---------------- |
| Jest                  | 單元與整合測試   |
| React Testing Library | 元件測試         |
| Playwright            | E2E 跨瀏覽器測試 |
| Supertest             | API 端點測試     |

---

## 📊 專案進度

### Epic 1: 實況主分析儀表板 ✅ 100%

| Story | 名稱                 | 狀態 | 完成日期   |
| ----- | -------------------- | ---- | ---------- |
| 1.1   | 實況主登入與頻道綁定 | ✅   | 2025-12-09 |
| 1.2   | 會話統計總覽         | ✅   | 2025-12-09 |
| 1.3   | 時間與頻率圖表       | ✅   | 2025-12-10 |
| 1.4   | 訂閱趨勢 (Lite)      | ✅   | 2025-12-10 |
| 1.5   | 儀表板 UX 偏好設定   | ✅   | 2025-12-11 |

### Epic 2: 觀眾參與度分析 ✅ 100%

| Story | 名稱                  | 狀態 | 完成日期   |
| ----- | --------------------- | ---- | ---------- |
| 2.1   | 觀眾登入與授權        | ✅   | 2025-12-12 |
| 2.2   | 觀看時數統計          | ✅   | 2025-12-12 |
| 2.3   | 聊天與互動分析        | ✅   | 2025-12-16 |
| 2.4   | 足跡總覽儀表板        | ✅   | 2025-12-17 |
| 2.5   | 隱私與授權控制 (GDPR) | ✅   | 2025-12-17 |

### 未來規劃

- **Epic 3**: 資料收集自動化 (Twitch EventSub Webhooks)
- **Epic 4**: 實況主快速操作工具
- **Epic 5**: 即時通知與事件系統

---

## 🧪 測試覆蓋

| 類型             | 測試套件 | 測試數   | 通過率      |
| ---------------- | -------- | -------- | ----------- |
| 後端單元測試     | 7+       | 64+      | **100%** ✅ |
| 前端單元測試     | 16+      | 109+     | **100%** ✅ |
| E2E (Playwright) | 10       | 59       | **100%** ✅ |
| 效能測試         | 1        | 3        | **100%** ✅ |
| **總計**         | **34+**  | **235+** | **100%** 🎉 |

---

## 📁 專案結構

```
Twitch-Analytics/
├── frontend/                    # Next.js 前端
│   ├── src/
│   │   ├── app/                 # App Router 頁面
│   │   │   ├── dashboard/
│   │   │   │   ├── streamer/    # 實況主儀表板
│   │   │   │   └── viewer/      # 觀眾儀表板
│   │   │   │       ├── [channelId]/   # 頻道詳情
│   │   │   │       ├── footprint/     # 足跡總覽
│   │   │   │       └── settings/      # 隱私設定
│   │   │   ├── auth/            # 認證回調
│   │   │   └── privacy-policy/  # 隱私政策
│   │   ├── features/            # 功能模組
│   │   │   ├── auth/            # 認證邏輯
│   │   │   ├── privacy/         # 隱私元件
│   │   │   ├── streamer-dashboard/
│   │   │   └── viewer-dashboard/
│   │   ├── components/          # 共用元件
│   │   └── lib/                 # 工具函式
│   ├── e2e/                     # Playwright E2E 測試
│   └── __tests__/               # Jest 單元測試
│
├── backend/                     # Express 後端
│   ├── src/
│   │   ├── modules/             # 功能模組
│   │   │   ├── auth/            # 認證 (OAuth/JWT)
│   │   │   ├── streamer/        # 實況主 API
│   │   │   └── viewer/          # 觀眾 API
│   │   ├── services/            # 服務層
│   │   │   ├── account-deletion.service.ts
│   │   │   ├── data-export.service.ts
│   │   │   ├── privacy-consent.service.ts
│   │   │   ├── twitch-chat.service.ts
│   │   │   ├── twitch-helix.service.ts
│   │   │   └── ...
│   │   ├── jobs/                # 排程任務
│   │   └── db/                  # 資料庫連線
│   └── prisma/                  # Prisma Schema
│
└── docs/                        # 專案文件
    ├── stories/                 # User Stories (12 份)
    ├── architecture/            # 架構文件
    └── qa/                      # QA 報告
```

---

## 🚀 快速開始

### 前置需求

- Node.js 20.x 或更高版本
- npm 9.x 或更高版本
- [Twitch 開發者帳號](https://dev.twitch.tv/console/apps) (用於 OAuth)

### 1. 複製專案

```bash
git clone https://github.com/tingyu08/Twitch-monitoring-and-statistics-system.git
cd Twitch-monitoring-and-statistics-system
```

### 2. 安裝依賴

```bash
# 安裝前端依賴
cd frontend
npm install

# 安裝後端依賴
cd ../backend
npm install
```

### 3. 環境變數設定

**後端 (`backend/.env`)**

```env
# 資料庫
DATABASE_URL="file:./prisma/dev.db"

# Twitch OAuth
TWITCH_CLIENT_ID=your_twitch_client_id
TWITCH_CLIENT_SECRET=your_twitch_client_secret
TWITCH_CALLBACK_URL=http://localhost:4000/api/auth/twitch/callback

# JWT
JWT_SECRET=your_jwt_secret_key

# CORS
FRONTEND_URL=http://localhost:3000

# 伺服器
PORT=4000
NODE_ENV=development

# 資料匯出 (Story 2.5)
EXPORT_STORAGE_PATH=./exports
EXPORT_EXPIRY_HOURS=24
```

**前端 (`frontend/.env.local`)**

```env
NEXT_PUBLIC_API_URL=http://localhost:4000/api
NEXT_PUBLIC_TWITCH_CLIENT_ID=your_twitch_client_id
```

### 4. 資料庫初始化

```bash
cd backend
npx prisma migrate dev
npx prisma db seed  # 載入演示數據 (選用)
```

### 5. 啟動開發伺服器

**啟動後端** (Terminal 1)

```bash
cd backend
npm run dev
# 伺服器運行於 http://localhost:4000
```

**啟動前端** (Terminal 2)

```bash
cd frontend
npm run dev
# 應用運行於 http://localhost:3000
```

### 6. 開始使用

1. 訪問 http://localhost:3000
2. 點擊「使用 Twitch 登入」
3. 授權應用存取你的 Twitch 帳號
4. 進入儀表板查看統計數據

---

## 🔌 API 端點

### 認證

| 方法 | 端點                        | 說明                |
| ---- | --------------------------- | ------------------- |
| GET  | `/api/auth/twitch`          | 初始化 Twitch OAuth |
| GET  | `/api/auth/twitch/callback` | OAuth 回調          |
| GET  | `/api/auth/me`              | 取得當前使用者      |
| POST | `/api/auth/logout`          | 登出                |

### 實況主

| 方法 | 端點                        | 說明         |
| ---- | --------------------------- | ------------ |
| GET  | `/api/streamer/summary`     | 統計總覽     |
| GET  | `/api/streamer/time-series` | 時間序列資料 |
| GET  | `/api/streamer/heatmap`     | 熱力圖資料   |
| GET  | `/api/streamer/subs-trend`  | 訂閱趨勢     |

### 觀眾

| 方法 | 端點                                    | 說明             |
| ---- | --------------------------------------- | ---------------- |
| GET  | `/api/viewer/channels`                  | 觀看過的頻道列表 |
| GET  | `/api/viewer/stats/:channelId`          | 頻道觀看統計     |
| GET  | `/api/viewer/footprint/:channelId`      | 足跡總覽         |
| GET  | `/api/viewer/message-stats`             | 聊天統計         |
| GET  | `/api/viewer/lifetime-stats/:channelId` | 全時段統計       |

### 隱私控制

| 方法  | 端點                                  | 說明         |
| ----- | ------------------------------------- | ------------ |
| GET   | `/api/viewer/privacy/settings`        | 取得隱私設定 |
| PATCH | `/api/viewer/privacy/settings`        | 更新隱私設定 |
| POST  | `/api/viewer/privacy/export`          | 請求資料匯出 |
| GET   | `/api/viewer/privacy/export/:jobId`   | 檢查匯出狀態 |
| POST  | `/api/viewer/privacy/delete-account`  | 請求刪除帳號 |
| POST  | `/api/viewer/privacy/cancel-deletion` | 撤銷刪除請求 |

---

## 🧪 測試

### 執行測試

```bash
# 前端單元測試
cd frontend
npm test

# 後端單元測試
cd backend
npm test

# E2E 測試 (Playwright)
cd frontend
npm run test:e2e

# E2E 跨瀏覽器測試
npm run test:e2e:all

# 測試覆蓋率報告
npm test -- --coverage
```

---

## 📝 開發規範

### 程式碼風格

- 遵循 ESLint 規則
- 使用 Prettier 格式化
- TypeScript 嚴格模式
- 功能模組化組織

### Git Commit 規範

```
feat: 新功能
fix: 修復 Bug
docs: 文件更新
style: 程式碼格式調整
refactor: 重構
test: 測試相關
chore: 建置/工具相關
```

### 分支策略

- `main` - 穩定生產版本
- `develop` - 開發分支
- `feature/*` - 功能開發
- `fix/*` - Bug 修復

---

## 📚 文件

| 類型         | 路徑                  | 說明              |
| ------------ | --------------------- | ----------------- |
| User Stories | `/docs/stories/`      | 12 份詳細需求文件 |
| 進度追蹤     | `PROJECT-STATUS.md`   | 專案狀態報告      |
| 架構文件     | `/docs/architecture/` | 系統架構說明      |
| QA 報告      | `/docs/qa/`           | 測試與除錯紀錄    |

---

## 🤝 貢獻指南

歡迎提交 Pull Request！請確保：

1. 程式碼遵循專案風格規範
2. 新增功能包含對應測試
3. 所有測試通過
4. Commit 訊息清晰明確
5. 更新相關文件

---

## 📄 授權

MIT License - 詳見 [LICENSE](LICENSE) 檔案

---

## 👨‍💻 作者

**Terry Lin** (tingyu08)

- GitHub: [@tingyu08](https://github.com/tingyu08)
- Email: terryapp0815@gmail.com

---

## 🙏 致謝

- [Twitch API](https://dev.twitch.tv/) - 提供直播數據
- [Twurple](https://twurple.js.org/) - Twitch API 客戶端
- [Next.js](https://nextjs.org/) - React 框架
- [Recharts](https://recharts.org/) - 圖表庫
- [Prisma](https://www.prisma.io/) - 資料庫 ORM
- [Playwright](https://playwright.dev/) - E2E 測試框架

---

## 📬 聯絡方式

如有問題或建議，歡迎：

- 提交 [Issue](https://github.com/tingyu08/Twitch-monitoring-and-statistics-system/issues)
- 發送 Email: terryapp0815@gmail.com
- 在 [Discussions](https://github.com/tingyu08/Twitch-monitoring-and-statistics-system/discussions) 討論

---

<p align="center">
  <strong>⭐ 如果這個專案對你有幫助，請給個星星支持！</strong>
</p>
