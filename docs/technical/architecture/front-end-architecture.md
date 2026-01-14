# Twitch 實況監控與統計平台 – Frontend Architecture

## 1. 文件目的與範圍

本文件描述 Twitch 實況監控與統計平台的**前端技術架構**，目標是：

- 對齊 PRD 與 `UI/UX Specification` 中的需求與體驗設計  
- 為開發者提供清楚的專案結構、狀態管理、路由與元件分層指引  
- 確保未來功能擴充時仍具備良好維護性與一致性  

> 關聯文件：  
> - `docs/prd.md`  
> - `docs/front-end-spec.md`  

---

## 2. 技術棧與高層架構

- **框架**：Next.js（App Router） + React + TypeScript  
- **樣式**：Tailwind CSS（Dark Tech Dashboard 風格）  
- **資料取得與快取**：TanStack Query（React Query）  
- **狀態管理（UI/Client State）**：Zustand 或 React Context + useReducer  
- **圖表**：Recharts / ECharts（二擇一，依實作時決定）  

高層架構：

- 以 **Next.js App Router** 的 route 為基礎，對應 PRD / UX 中的 Landing、Streamer Dashboard、Viewer Dashboard、Settings 等頁面
- 採 **功能導向（feature-based）** 的資料夾結構，將實況主儀表板、觀眾儀表板拆成獨立 feature 模組
- 所有 API 呼叫集中在 `lib/api`，前端僅取得「彙總後統計結果」，不直接接觸 Twitch API 原始資料

---

## 3. 專案結構設計（Project Structure）

### 3.1 檔案與資料夾結構

```text
src/
  app/
    layout.tsx                 # AppShell：Header + Sidebar + 主內容
    page.tsx                   # Landing Page（公開首頁）
    auth/
      callback/route.ts        # Twitch OAuth callback 處理與 redirect
    dashboard/
      streamer/
        page.tsx               # 實況主儀表板入口（Epic 1）
      viewer/
        page.tsx               # 觀眾儀表板入口（Epic 2）
    settings/
      page.tsx                 # 帳號與偏好設定頁

  features/
    auth/
      components/
      hooks/
      types.ts

    streamer-dashboard/
      components/              # Summary 區、圖表區、偏好設定區 container
      hooks/                   # useStreamerSummary, useStreamerTimeSeries...
      charts/                  # TimeSeriesChart, HeatmapChart 封裝

    viewer-dashboard/
      components/
      hooks/                   # useViewerSummary, useViewerEngagement...
      charts/

    shared/
      components/              # StatCard, Banner, EmptyState, Skeleton...
      ui/                      # Button, Dialog, Tabs, DateRangePicker, Drawer...
      layout/                  # AppShell, DashboardSection
      hooks/                   # useMediaQuery, usePrefersReducedMotion...

  lib/
    api/
      httpClient.ts            # 包裝 fetch：baseURL、錯誤處理、auth header
      streamer.ts              # getStreamerSummary, getStreamerTimeSeries...
      viewer.ts
    config/
      routes.ts                # 路由常數與命名
    types/                     # 共用型別（Stat, TimeSeriesPoint, HeatmapCell…）

  store/
    uiPreferences.ts           # 儀表板顯示偏好（Zustand + localStorage）
    authSession.ts             # 前端 Session / 使用者角色資訊（可選）
```

### 3.2 設計原則

- **Feature-first**：以功能（實況主儀表板、觀眾儀表板）分包，而非單純依技術層（components/hooks）做全域切分，方便關聯修改與維護。
- **Shared Layer**：跨頁共用的 UI、Layout、通用元件集中在 `features/shared`，避免重複實作。
- **單一 API 層**：所有對後端的呼叫僅透過 `lib/api`，React Component 不直接呼叫 `fetch`。

---

## 4. 路由設計（Routing）

### 4.1 路由對應

- `/`  
  - Landing Page（公開首頁），說明產品價值並引導「以 Twitch 登入」。  

- `/auth/callback`  
  - 處理 Twitch OAuth callback，交換 Token，設定 Cookie / Session，依角色 redirect：  
  - 實況主 → `/dashboard/streamer`  
  - 觀眾 → `/dashboard/viewer`  

- `/dashboard/streamer`  
  - 實況主儀表板主頁（Epic 1，對應 FR-S1–S5）。  
  - 支援 Query 參數：`?range=30d&compare=prev` 等。  

- `/dashboard/viewer`  
  - 觀眾儀表板主頁（Epic 2，對應 FR-V1–V5）。  
  - 透過實況主選擇器（或 `?streamer=...`）決定目前顯示的頻道。  

- `/settings`  
  - 帳號與偏好設定（時間區間預設值、顯示圖表預設組合、觀眾隱私設定與資料刪除）。  

### 4.2 路由保護與角色導向

- 使用 Next.js Middleware：
  - 對 `/dashboard/*`、`/settings` 進行 **身分驗證** 檢查（無 Token 則 redirect `/`）。  
  - 根據後端回傳的角色資訊（Streamer / Viewer）決定允許訪問的頁面或導轉。  

- 頁面層使用 `useAuthSession()`：  
  - 取得目前登入者基本資訊（display name、角色）。  
  - 若角色不符（例如 Viewer 訪問 `/dashboard/streamer`），顯示權限不足 Banner 或導轉。  

---

## 5. 狀態管理策略（State Management）

### 5.1 Server State（後端資料）

- 採用 **TanStack Query（React Query）** 管理所有「後端回來的統計與圖表資料」：
  - `useStreamerSummaryQuery({ range })`  
  - `useStreamerTimeSeriesQuery({ range })`  
  - `useStreamerHeatmapQuery({ range })`  
  - `useViewerSummaryQuery({ streamerId, range })`  
  - `useViewerEngagementQuery({ streamerId, range })`  
- Query Key 依 **角色 + 實況主 + 時間區間** 設計，例如：  
  - `['streamer', 'summary', streamerId, range]`  
  - `['viewer', 'engagement', viewerId, streamerId, range]`  
- 利用 React Query 的：
  - 快取（cache）、背景 refetch  
  - `isLoading` / `isError` / `data` 狀態驅動 Skeleton / Banner / Chart 顯示  

### 5.2 Client/UI State（純前端狀態）

- 使用 **Zustand**（或 React Context + useReducer）管理純前端狀態，避免與 server state 混用：

1. `uiPreferencesStore`  
   - 儲存實況主儀表板的顯示偏好：  
     - 顯示/隱藏哪些 Summary Card / 圖表  
     - 預設時間區間（例如預設 30 天）  
   - 使用 `localStorage` persist，符合 Story 1.5 的「可保存偏好設定」。  

2. `viewerPrivacyPreferences`  
   - 儲存觀眾端的隱私與資料保存選項（例如是否參與實驗功能）。  

### 5.3 URL / Query State

- 可分享或需要書籤化的條件（時間區間、目標實況主等）放在 URL query：  
  - 例如 `?range=30d&streamer=1234`  
- 頁面透過 `useSearchParams()` 讀取，再傳給 React Query 的 hooks 作為參數與 key 的一部分。  
- 回到同一連結即可還原同一視圖，符合高頻操作效率的 UX 目標。  

---

## 6. 元件架構（Component Architecture）

### 6.1 Layout Components

- **`AppShell`**（`features/shared/layout/AppShell.tsx`）  
  - 包含 Header（登入狀態、角色切換）、Sidebar（儀表板導覽）與主內容。  
  - 控制響應式行為：桌機固定 Sidebar，行動裝置使用 Drawer。  

- **`DashboardSection`**  
  - 每個儀表板區塊的容器：標題、副標、右側操作（如更多篩選）、內容。  
  - 讓 Streamer / Viewer 儀表板在視覺上保持一致。  

### 6.2 Data / Chart Components

- **`StatCard`**  
  - 用於開台時數、場數、平均長度、訂閱概要、累積觀看時數等 Summary Card。  
  - 支援狀態：  
    - `loading`：Skeleton  
    - `normal`：顯示數值與趨勢（上升/下降箭頭）  
    - `degraded`：資料不完整或估算值，顯示 Warning / Info 標記  

- **`TimeSeriesChart`**  
  - 包裝圖表庫，用於開台時數、觀看時數、訂閱變化等時間序列圖。  
  - Props 僅接收經後端彙總好的資料，不在元件內做商業邏輯運算。  

- **`HeatmapChart`**  
  - 顯示一週 x 時段的開台頻率 / 觀看熱度 heatmap。  
  - 包含 color legend 與文字說明，符合無障礙需求。  

### 6.3 Input / Filter Components

- **`DateRangePicker`**  
  - 提供 7 / 30 / 90 天快捷選項與自訂日期。  
  - 變動時更新 URL query 並觸發 React Query 重新抓取資料。  

- **`StreamerSelector` / `ChannelSelector`**  
  - Viewer 儀表板的實況主選擇器，支援搜尋 + 下拉建議。  
  - 在手機上可切成全螢幕選擇 UI，以符合 UX 文件建議。  

- **`ChipFilter` / `ToggleGroup`**  
  - 用於切換指標類型或視圖模式（開台 / 訂閱 / 留言等）。  

### 6.4 Feedback Components

- **`Banner`（Info / Warning / Error）**  
  - 告知 Twitch API 限制、資料延遲、估算值等資訊，對應 PRD 中「限制需明確標示」的要求。  

- **`EmptyState`**  
  - 在尚未綁定頻道 / 無資料時，顯示說明與行動引導（如先完成 Story 1.1 登入綁定）。  

- **`SkeletonLoader`**  
  - 圖表與卡片在 loading 狀態下顯示 skeleton，避免畫面閃跳。  

---

## 7. 資料流設計（Data Flow）

### 7.1 後端 ↔ 前端

- 後端負責：  
  - 與 Twitch API 串接、OAuth Token 管理。  
  - 排程抓取並儲存開台 / 互動資料。  
  - 對前端提供**彙總後統計結果** API（符合 FR-P1–P3）。  

- 前端透過 `lib/api` 呼叫 Backend API：  
  - `getStreamerSummary(params)` → 實況主 Summary Cards 資料  
  - `getStreamerTimeSeries(params)` → 開台時間序列圖資料  
  - `getStreamerHeatmap(params)` → 熱度圖資料  
  - `getViewerSummary(params)` / `getViewerEngagement(params)` → 觀眾相關統計  

### 7.2 前端內部單向資料流

1. 使用者操作 `DateRangePicker` / `StreamerSelector` 等輸入元件。  
2. 更新 URL query ＋/或 UI store 中的條件狀態。  
3. React Query hooks 根據參數組成 key，觸發 API 呼叫。  
4. 回傳結果注入 StatCard / Chart Components。  
5. Components 根據 `isLoading` / `isError` / `data` 決定顯示 Skeleton / Banner / Chart。  

### 7.3 錯誤與降級策略

- API 若因 Twitch 限制或資料延遲回傳「不完整 / 估算」狀態，後端在 payload 中附帶 flag：  
  - 例如 `isEstimated: true`, `dataCompleteness: 'partial'`。  
- 前端组件（StatCard / Chart）讀取 flag，顯示對應 Badge 與 Banner 說明。  

### 7.4 隱私與資料刪除流程（前端視角）

- 觀眾端「刪除 / 匿名化資料」操作：  
  - 觸發後端 API（例如 `DELETE /me/stats` 或類似端點）。  
  - 成功後：  
    - 透過 React Query `invalidateQueries(['viewer'])` 清除 cache。  
    - 顯示成功 Banner 與 EmptyState。  

---

## 8. NFR 對齊與擴充性

### 8.1 效能與使用者體驗

- 主要儀表板頁面採用：  
  - SSR / SSG（Next.js）以降低首次載入 TTFB。  
  - React Query 快取＋增量更新，避免重複請求。  
- 使用 Skeleton 與適度的過渡動效（200–250ms），符合 UX 文件 Motion 原則。  

### 8.2 可維護性與測試

- 關鍵商業邏輯（資料轉換、統計算法）不寫在 Component 內，而是獨立為 utility / hook，便於單元測試：  
  - 例如 `lib/metrics/streamer.ts`、`lib/metrics/viewer.ts`。  
- 針對：  
  - 時間區間切換行為  
  - 圖表資料 mapping  
  - 偏好儲存 / 還原  
  建立單元與基本整合測試，對應 PRD 中 NFR-M 系列要求。  

### 8.3 擴充至多平台

- 雖然目前 PRD 僅鎖定 Twitch，但在型別與 API 設計上預留 `platform` 欄位或抽象：  
  - 例如 `Platform = 'twitch' | 'youtube' | 'kick'`（未來可擴寫）。  
  - 前端開發時避免將 `twitch` 字串硬編碼在所有商業邏輯內。  

---

## 9. 後續工作建議

1. 與 PM / UX 再次審閱本前端架構是否完全支援現階段 MVP 的 Story / FR / NFR。  
2. 在設計工具（如 Figma）建立對應的元件庫與 layout，將本文件中提到的 `AppShell`、`StatCard`、`TimeSeriesChart` 等映射為設計元件。  
3. 實作初版專案 skeleton（Next.js + TS + Tailwind + React Query），依本文件完成目錄結構與核心元件骨架，作為後續故事開發基礎。  


