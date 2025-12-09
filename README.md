#  Twitch 直播監控與統計系統

一個全端 Web 應用程式，用於追蹤和分析 Twitch 實況主的直播數據，提供即時統計和歷史趨勢分析。

![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat-square&logo=typescript&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-000000?style=flat-square&logo=next.js&logoColor=white)
![React](https://img.shields.io/badge/React-20232A?style=flat-square&logo=react&logoColor=61DAFB)
![Node.js](https://img.shields.io/badge/Node.js-43853D?style=flat-square&logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-404D59?style=flat-square&logo=express&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-2D3748?style=flat-square&logo=prisma&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-07405E?style=flat-square&logo=sqlite&logoColor=white)

##  功能特色

###  認證系統
- Twitch OAuth 2.0 整合
- JWT Token 會話管理
- HttpOnly Cookie 安全機制
- 自動登入狀態持久化

###  實況主儀表板
- **會話統計總覽** - 即時顯示總直播時間、平均觀眾、巔峰觀眾數
- **觀眾數趨勢圖** - 使用 Recharts 繪製時間序列圖表
- **直播頻率熱力圖** - 視覺化呈現每週直播時段分布
- **時間範圍切換** - 支援 24 小時、7 天、30 天數據查詢
- **響應式設計** - 完美適配桌面、平板、手機螢幕

###  技術亮點
- **SWR 數據快取** - 30 秒去重複化，自動重新驗證
- **環境感知日誌** - 生產環境自動停用 debug 日誌
- **可重用 UI 組件** - ChartLoading、ChartError、ChartEmpty
- **TypeScript 全覆蓋** - 完整的型別安全
- **測試完整性** - 83 個測試，100% 通過率

##  技術架構

### 前端技術棧
- **框架**: Next.js 14.2.33 (App Router)
- **UI 函式庫**: React 18.3.1
- **狀態管理**: SWR 2.2.4 (資料快取與同步)
- **圖表庫**: Recharts 3.5.1
- **樣式**: Tailwind CSS 3.4.1
- **HTTP 客戶端**: Fetch API with custom wrapper
- **測試**: Jest 29.7.0 + Testing Library

### 後端技術棧
- **執行環境**: Node.js 20.x
- **框架**: Express 4.18.2
- **ORM**: Prisma 7.1.0
- **資料庫**: SQLite
- **認證**: Passport.js + JWT
- **測試**: Jest 29.7.0 + Supertest

### 開發工具
- **語言**: TypeScript 5.x
- **程式碼品質**: ESLint + Prettier
- **版本控制**: Git + GitHub
- **套件管理**: npm

##  專案結構

\\\
Bmad/
 frontend/                    # Next.js 前端應用
    src/
       app/                # App Router 頁面
          dashboard/      # 儀表板頁面
          auth/           # 認證回調頁面
       features/           # 功能模組
          auth/           # 認證模組
          streamer-dashboard/  # 實況主儀表板
              charts/     # 圖表組件
              components/ # UI 組件
              hooks/      # 自訂 Hooks (SWR)
       lib/                # 工具函式
           api/            # API 客戶端
           logger.ts       # 日誌工具
    __tests__/              # 測試檔案

 backend/                     # Express 後端 API
    src/
       modules/            # 功能模組
          auth/           # 認證模組
          streamer/       # 實況主數據模組
       config/             # 配置檔案
       db/                 # 資料庫連線
    prisma/                 # Prisma Schema & Migrations

 docs/                        # 專案文件
     stories/                # 使用者故事
     architecture/           # 架構文件
     qa/                     # QA 測試報告
\\\

##  快速開始

### 前置需求
- Node.js 20.x 或更高版本
- npm 9.x 或更高版本
- Twitch 開發者帳號 (用於 OAuth)

### 1. 複製專案
\\\ash
git clone https://github.com/tingyu08/Twitch-monitoring-and-statistics-system.git
cd Twitch-monitoring-and-statistics-system
\\\

### 2. 安裝依賴
\\\ash
# 安裝根目錄依賴
npm install

# 安裝前端依賴
cd frontend
npm install

# 安裝後端依賴
cd ../backend
npm install
\\\

### 3. 環境變數設定

**後端 (\ackend/.env\)**
\\\env
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
\\\

**前端 (\rontend/.env.local\)**
\\\env
NEXT_PUBLIC_API_URL=http://localhost:4000/api
NEXT_PUBLIC_TWITCH_CLIENT_ID=your_twitch_client_id
\\\

### 4. 資料庫初始化
\\\ash
cd backend
npx prisma migrate dev
npx prisma db seed  # 載入測試資料 (選用)
\\\

### 5. 啟動開發伺服器

**啟動後端** (Terminal 1)
\\\ash
cd backend
npm run dev
# 伺服器運行於 http://localhost:4000
\\\

**啟動前端** (Terminal 2)
\\\ash
cd frontend
npm run dev
# 應用運行於 http://localhost:3000
\\\

### 6. 開始使用
1. 訪問 \http://localhost:3000\
2. 點擊 "使用 Twitch 登入"
3. 授權應用存取你的 Twitch 帳號
4. 進入儀表板開始查看統計數據

##  測試

### 執行所有測試
\\\ash
# 前端測試
cd frontend
npm test

# 後端測試
cd backend
npm test

# 測試覆蓋率報告
npm test -- --coverage
\\\

### 測試統計
- **總測試數**: 83 個
- **前端測試**: 35 個
- **後端測試**: 48 個
- **通過率**: 100%

##  建置與部署

### 建置生產版本
\\\ash
# 建置前端
cd frontend
npm run build

# 建置後端
cd backend
npm run build
\\\

### 啟動生產伺服器
\\\ash
# 啟動後端
cd backend
npm start

# 啟動前端
cd frontend
npm start
\\\

##  API 端點

### 認證相關
- \GET /api/auth/twitch\ - 初始化 Twitch OAuth 流程
- \GET /api/auth/twitch/callback\ - OAuth 回調處理
- \GET /api/auth/me\ - 取得當前使用者資訊
- \POST /api/auth/logout\ - 登出

### 實況主數據
- \GET /api/streamer/summary?range={24h|7d|30d}\ - 取得統計總覽
- \GET /api/streamer/time-series?range={24h|7d|30d}&granularity={hour|day}\ - 觀眾數趨勢
- \GET /api/streamer/heatmap?range={24h|7d|30d}\ - 直播頻率熱力圖

##  開發規範

### 程式碼風格
- 遵循 ESLint 規則
- 使用 Prettier 格式化
- TypeScript 嚴格模式
- 功能模組化組織

### Git Commit 規範
\\\
feat: 新功能
fix: 修復 Bug
docs: 文件更新
style: 程式碼格式調整
refactor: 重構
test: 測試相關
chore: 建置/工具相關
\\\

### 分支策略
- \main\ - 穩定生產版本
- \develop\ - 開發分支
- \eature/*\ - 功能開發
- \ix/*\ - Bug 修復

##  專案進度

### Epic 1: 實況主分析儀表板 (60% 完成)
-  Story 1.1: 實況主登入與頻道綁定
-  Story 1.2: 實況主會話統計總覽
-  Story 1.3: 實況主時間與頻率圖表
-  Story 1.4: 實況主訂閱趨勢 (Lite)
-  Story 1.5: 實況主儀表板 UX 偏好設定

### 未來規劃
- Epic 2: 觀眾參與度分析
- Epic 3: 數據收集與平台基礎

##  貢獻指南

歡迎提交 Pull Request！請確保：

1. 程式碼遵循專案風格規範
2. 新增功能包含對應測試
3. 所有測試通過
4. Commit 訊息清晰明確
5. 更新相關文件

##  授權

MIT License - 詳見 [LICENSE](LICENSE) 檔案

##  作者

**Terry Lin** (tingyu08)
- GitHub: [@tingyu08](https://github.com/tingyu08)
- Email: terryapp0815@gmail.com

##  致謝

- [Twitch API](https://dev.twitch.tv/) - 提供直播數據
- [Next.js](https://nextjs.org/) - React 框架
- [Recharts](https://recharts.org/) - 圖表庫
- [Prisma](https://www.prisma.io/) - 資料庫 ORM
- [SWR](https://swr.vercel.app/) - 資料快取方案

##  聯絡方式

如有問題或建議，歡迎：
- 提交 [Issue](https://github.com/tingyu08/Twitch-monitoring-and-statistics-system/issues)
- 發送 Email: terryapp0815@gmail.com
- 在 [Discussions](https://github.com/tingyu08/Twitch-monitoring-and-statistics-system/discussions) 討論

---

** 如果這個專案對你有幫助，請給個星星支持！**
