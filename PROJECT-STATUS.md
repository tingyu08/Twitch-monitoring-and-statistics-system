# Twitch Analytics - 專案狀態報告

**版本**: v1.9.0 (Production) | **最後更新**: 2026-02-03

---

## 📊 執行摘要 (Executive Summary)

本專案旨在打造一個深度的 Twitch 數據分析平台，專注於**觀眾個人觀看履歷**、**即時互動通知**以及**社群健康度分析**。

**整體進度**: **78%** (Phase 2 完成)

```
[█████████████████████████████████████░░░] 78%
```

**⚠️ 最新狀態**: 2026-02-03 已完成效能/寫入優化與測試修正，移除記憶體監控噪音日誌

---

## 🚀 最新發布 (v1.9.0 - Performance & Stability) - 2026-02-03

**核心重點**: 觀眾/後端排程效能優化、批次寫入、測試修正、移除記憶體監控噪音

### 🔧 關鍵變更

1.  **排程並發控制與延遲優化**
    - **修正**: Stream Status Job 並發控制確實生效
    - **調整**: 可透過 `STREAM_STATUS_CONCURRENCY_LIMIT` 調整並發上限
    - **效果**: 降低峰值壓力，同時維持接近原先的排程延遲

2.  **DB 寫入與記憶體優化**
    - **批次**: 觀看時間、追蹤同步改為批次 transaction/upsert
    - **聚合**: 日訊息統計改 DB 端 `INSERT...SELECT...ON CONFLICT`
    - **節流**: 分散式協調器清理節流，降低固定寫入量

3.  **前端穩定性與測試修正**
    - **修正**: 測試翻譯 key、路由參數與 fetch/mock 行為
    - **新增**: 補齊前端測試依賴 `@testing-library/dom`
    - **驗證**: Backend/Frontend 測試皆通過

4.  **記憶體監控日誌降噪**
    - **移除**: MemoryMonitor/PerformanceMonitor 記憶體警告與 GC 提示日誌
    - **保留**: 監控行為與保護機制

---

## 🚀 前一版本 (v1.8.0 - Infrastructure) - 2026-02-02

**核心重點**: 遷移至 Zeabur 單一後端部署架構

### 🔧 關鍵變更

1.  **移除舊中介部署**
    - **原因**: 舊健康檢查中介層無法有效防止 Zeabur 冷啟動
    - **移除**: 刪除舊 proxy 目錄與對應設定檔
    - **簡化**: 單一後端平台，降低維護複雜度

2.  **UptimeRobot 直連 Zeabur**
    - **調整**: UptimeRobot 現在直接 ping Zeabur 的 `/api/health/ping`
    - **效果**: 真正防止 Zeabur 冷啟動

3.  **Extension API URL 更新**
    - **變更**: 從舊 URL 改為 Zeabur URL
    - **影響**: Chrome Extension 需要重新安裝

---

## 🚀 前一版本 (v1.7.0 - Performance) - 2026-01-28

**核心重點**: 記憶體優化（已遷移至 Zeabur，此優化仍適用）

### 🔧 關鍵成果

1.  **sync-videos.job 批次處理優化**
    - **問題**: 一次處理 328 個實況主，累積 24,928 筆資料導致記憶體超限
    - **解決**: 改為每批 10 個實況主，批次間休息 2 秒讓 GC 清理
    - **效果**: 記憶體峰值從 ~350MB 降至 ~150MB (節省 57%)

2.  **update-live-status.job 記憶體優化**
    - **優化**: 保持每分鐘執行（確保即時性）
    - **策略**: 已實作批次處理，記憶體使用已優化

3.  **Cache Manager 清理頻率提升**
    - **調整**: 從每 5 分鐘改為每 2 分鐘清理過期項目
    - **效果**: 更及時釋放記憶體

4.  **全局記憶體監控系統**
    - **監控**: 每 30 秒檢查記憶體使用量
    - **警戒線**: 400MB 觸發警告，480MB 觸發強制 GC
    - **日誌**: 記錄記憶體使用趨勢，便於診斷問題

**部署建議**:
```env
NODE_OPTIONS=--expose-gc --max-old-space-size=480
MEMORY_WARNING_MB=400
MEMORY_CRITICAL_MB=480
```

詳細文檔：[MEMORY-OPTIMIZATION.md](./MEMORY-OPTIMIZATION.md)

## 🚀 前一版本 (v1.6.1 - Hotfix) - 2026-01-28

**核心重點**: 資料庫安全性強化與自動備份機制

### 🔒 關鍵成果

1.  **資料恢復完成**
    - **事件**: 2026-01-27 發生資料遺失（留言與觀看時數記錄被清空）
    - **恢復**: 成功從 Turso 24 小時前的 branch 恢復 1,014 筆留言與 43 筆觀看時數記錄
    - **影響**: 僅遺失 2026-01-27 一天的資料
2.  **自動備份機制**
    - **GitHub Actions**: 每日凌晨 2 點（UTC）自動執行資料庫備份
    - **保留期限**: 30 天備份歷史
    - **格式**: JSON 格式，支援完整資料恢復
3.  **Migration 安全性改善**
    - **移除**: 刪除使用危險 `DROP TABLE` 操作的 migration 檔案
    - **預防**: 避免未來再次發生資料遺失問題

### 📋 前一版本 (v1.6.0) - 2026-01-25

**核心重點**: Epic 4 實況主快速操作中心完成

### ✨ 關鍵成果

1.  **收益總覽面板 (Revenue Overview)**
    - **機制**: 新增收益總覽頁面，整合訂閱與 Bits 收益數據。
    - **特色**: PieChart 收益來源佔比視覺化，一目了然收益分布。
2.  **報表匯出功能 (Export)**
    - **CSV**: 詳細日期數據，便於 Excel 分析。
    - **PDF**: 可讀報表格式，方便分享與存檔。
3.  **UI/UX 優化**
    - **Tab 切換**: 新增「總覽」Tab 作為預設視圖。
    - **匯出選單**: 下拉式格式選擇 (CSV/PDF)。

---

## 🗺️ 開發路線圖 (Roadmap)

| 階段        | Epic        | 任務                   | 狀態          | 預估完成   |
| :---------- | :---------- | :--------------------- | :------------ | :--------- |
| **Phase 1** | **Epic 10** | **瀏覽器擴充功能**     | ✅ **已完成** | 2026-01-21 |
| **Phase 2** | **Epic 4**  | **實況主快速操作中心** | ✅ **已完成** | 2026-01-25 |
| Phase 3     | Epic 8      | 直播控制與預測         | ⏳ 規劃中     | 2026-03-05 |
| Phase 4     | Epic 7      | 社群互動管理           | ⏳ 規劃中     | 2026-04-16 |
| Phase 5     | Epic 9      | 進階自動化             | ⏳ 規劃中     | 2026-05-28 |

> 註：時程基於每 Epic 約 6 週開發週期估算。

---

## ✅ 已完成 Epic 總覽

| ID          | 名稱               | 重點功能                               | 狀態 |
| :---------- | :----------------- | :------------------------------------- | :--- |
| **Epic 1**  | 實況主儀表板       | 直播趨勢、熱力圖、訂閱分析             | ✅   |
| **Epic 2**  | 觀眾參與度分析     | 觀看履歷、成就系統、GDPR 控制          | ✅   |
| **Epic 3**  | 平台基礎架構       | 聊天監聽、Token 自動刷新、EventSub     | ✅   |
| **Epic 4**  | 實況主快速操作中心 | 設定模板、收益分析、報表匯出           | ✅   |
| **Epic 5**  | 即時推送           | WebSocket 通知、Raid Alert             | ✅   |
| **Epic 6**  | 資料自動化         | VOD/Clips 同步、真實數據採集           | ✅   |
| **Epic 10** | 瀏覽器擴充         | Chrome Extension 觀看時長追蹤          | ✅   |
| —           | 生產環境部署       | Vercel (FE) + Zeabur (BE) + Turso (DB) | ✅   |

---

## 🕒 歷史更新紀錄 (History)

<details>
<summary><b>點擊展開過往更新詳情</b></summary>

### 2026-01-28 (v1.6.1 - Critical Hotfix)

- **事件**: 資料庫 migration 錯誤導致留言與觀看時數記錄遺失
- **恢復**: 從 Turso 24 小時前的 branch 成功恢復資料（1,014 筆留言 + 43 筆觀看時數）
- **修復**: 刪除兩個使用 `DROP TABLE` 的危險 migration 檔案
- **新增**: 實施 GitHub Actions 每日自動備份機制（保留 30 天）
- **新增**: 手動備份腳本 (`backend/scripts/manual-backup.js`)
- **優化**: 更新 `.gitignore` 排除備份檔案，避免提交大型備份到 Git
- **影響**: 僅遺失 2026-01-27 一天的新增資料，核心功能正常運作

### 2026-01-25 (v1.6.0 - Epic 4 Complete)

- **功能**: 完成 Epic 4.5 收益綜合報表，新增 RevenueOverview 總覽面板。
- **匯出**: 支援 CSV/PDF 雙格式報表匯出。
- **UI**: 收益頁面新增「總覽」Tab，含 PieChart 收益佔比圖表。

### 2026-01-21 (Hotfix - Token Management)

- **修復**: 實作 Twitch Token 自動刷新機制，解決 Access Token 過期導致的 401/404 錯誤。
- **修復**: 修正使用者重新登入時，未重置 Token 狀態 (Expired -> Active) 的問題。
- **優化**: `StreamerSettingsService` 加入重試邏輯，提升 API 穩定性。

### 2026-01-15 (Infrastructure Update)

- **功能**: 完成 Epic 4.2~4.4 (設定模板、訂閱/Bits 收益統計)。
- **架構**: 修復 ESM 部署錯誤，重構 `@twurple` 為動態導入。
- **資料**: 新增每日訂閱快照 (`SubscriptionSnapshot`) 與 Bits 監聽。

### 2026-01-13 (Performance & Extension)

- **Extension**: Chrome 擴充功能上線，支援精確觀看時長追蹤。
- **效能**: 導入 AS Virtual Scrolling (`react-window`) 與 Web Workers 計算分流。
- **體驗**: 全站字型優化 (`next/font`) 與 Skeleton Loading，大幅提升感知效能。

### 2025-12-20 ~ 2026-01-12 (Phase 1 Foundation)

- 完成深色模式、PWA 離線支援、i18n 繁中/英文多語系。
- 整合 Google Analytics 4 (GA4) 與 Sentry 錯誤追蹤。
</details>

---

## 🛠️ 技術架構 (Technical Stack)

| 層級            | 技術方案                                                 |
| :-------------- | :------------------------------------------------------- |
| **Frontend**    | Next.js 14 (App Router), TailwindCSS, Zustand, Recharts  |
| **Backend**     | Express, TypeScript, Prisma ORM, Socket.IO               |
| **Database**    | Turso (LibSQL) - Edge Compatible                         |
| **Integration** | Twurple (Twitch API), Google Analytics                   |
| **CI/CD**       | GitHub Actions (自動備份、測試、部署)                     |
| **Monitoring**  | Sentry (錯誤追蹤), 每日自動資料庫備份                     |

---

## 🔒 資料安全措施 (Data Security)

| 措施            | 實施狀態 | 說明                                      |
| :-------------- | :------- | :---------------------------------------- |
| **自動備份**    | ✅ 已實施 | GitHub Actions 每日凌晨 2 點自動備份      |
| **備份保留**    | ✅ 已實施 | 保留 30 天備份歷史，可隨時下載恢復         |
| **手動備份**    | ✅ 已實施 | 提供手動備份腳本，隨時可執行               |
| **Branch 恢復** | ✅ 已驗證 | Turso PITR 功能可恢復到任意時間點          |
| **Migration 審查** | ✅ 已強化 | 禁止使用 DROP TABLE 等危險操作          |

---

## 🛠️ 權限需求 (Pending Epics)

未來開發將需要以下 Twitch OAuth Scopes：

- `channel:manage:broadcast` (Epic 4, 8) - 編輯頻道資訊
- `channel:read:subscriptions` / `bits:read` (Epic 4) - 收益分析
- `channel:manage:predictions` / `polls` (Epic 8) - 互動控制
- `channel:moderate` (Epic 7) - 聊天室管理
