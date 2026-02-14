# Twitch Analytics - 專案狀態報告

**版本**: v2.0.0 (Production) | **最後更新**: 2026-02-14

---

## 📊 執行摘要 (Executive Summary)

本專案旨在打造一個深度的 Twitch 數據分析平台，專注於**觀眾個人觀看履歷**、**即時互動通知**以及**社群健康度分析**。

**整體進度**: **82%** (Phase 2 完成，基礎架構持續強化中)

```
[█████████████████████████████████████████░░░░] 82%
```

**⚠️ 最新狀態**: 2026-02-13 完成大規模 Code Review 收斂、生產環境穩定性修復、Redis/Queue 基礎設施導入、OAuth 韌性強化

---

## 🚀 最新發布 (v2.0.0 - Production Stability & Code Review) - 2026-02-13

**核心重點**: 全面 Code Review 收斂、查詢/寫入路徑優化、生產環境穩定性大幅提升

### 🔧 關鍵變更

1.  **Code Review 全面收斂 (02-10 ~ 02-13)**
    - **查詢熱點**: viewer 驗證路徑改為共用快取快照，降低重複查詢與慢查詢風險
    - **寫入路徑**: 批次化關鍵同步流程（訊息、直播狀態、lifetime stats），降低鎖競爭
    - **Session 競態**: 新增 session-write-authority 機制，避免多實例重複寫入
    - **Overflow 檔案**: 補強跨程序鎖保護，提升高負載穩定性
    - **慢查詢節流**: 加入告警節流機制，避免重複慢查詢造成日誌洗版

2.  **OAuth 網路韌性強化**
    - **重試退避**: Twitch OAuth code exchange 加入可配置 timeout 與指數退避重試
    - **錯誤診斷**: 統一 OAuth 交換失敗的診斷資訊與錯誤回應格式
    - **測試覆蓋**: 補齊 timeout 錯誤場景的測試

3.  **生產環境 SQL/查詢修復**
    - **修正**: SQL 解析錯誤與查詢逾時未處理拒絕（訊息批次寫入、收益查詢）
    - **索引清理**: 落地多項 migration 清理低效索引
    - **Twurple 快取**: 優化客戶端快取，降低重複初始化與資料庫負載

4.  **Logger 與可觀測性提升**
    - **結構化輸出**: logger 支援結構化 JSON 輸出
    - **壓測腳本**: 新增壓測/編碼檢查/索引驗證腳本
    - **任務錯誤追蹤**: 新增 job-error-tracker 與寫入護欄 (job-write-guard)

---

## 🚀 前一版本 (v1.12.0 - Redis & Queue Infrastructure) - 2026-02-11

**核心重點**: 導入 Redis/Queue 基礎設施、修復認證高峰失敗、Listener 穩定性

### 🔧 關鍵變更

1.  **Redis 與 Queue 基礎設施**
    - **導入**: Redis 客戶端封裝與 Queue 工具（data-export-queue、revenue-sync-queue）
    - **匯出非同步化**: 資料匯出任務改為 Queue 非同步處理
    - **即時同步**: 強化多實例間 WebSocket 即時同步
    - **回壓保護**: 補齊 Queue 回壓保護與事件節流機制

2.  **認證高峰修復**
    - **問題**: 晚上高峰時段登入 100% 失敗
    - **修復**: 優化 auth.service 的並發處理與 token 管理
    - **影響**: 登入成功率恢復正常

3.  **Listener Slot 洩漏修復**
    - **修正**: listener slot 洩漏問題
    - **強化**: 安全性（auth middleware、CSRF 保護）、效能（connection pool）與穩定性
    - **優化**: env 設定精簡、memory-thresholds 調整

4.  **背景任務穩定性**
    - **Auto Join Job**: 修正缺少 prisma import 導致的 ReferenceError
    - **寫入收斂**: 降低免費層資料庫的鎖競爭風險
    - **設定驗證**: 新增 streamer-settings.schema 輸入驗證

---

## 🚀 前一版本 (v1.11.0 - Performance Optimization) - 2026-02-10

**核心重點**: 兩輪 Code Review 效能優化、批次寫入/查詢下推、Bits 日聚合

### 🔧 關鍵變更

1.  **Code Review 效能優化 (兩輪)**
    - **連線治理**: Prisma 連線池監控與優雅關閉
    - **批次並行**: channel-stats-sync 改為批次並行處理
    - **Timeout 保護**: 所有外部呼叫加入 timeout 機制
    - **前端效能**: 儀表板載入瀑布收斂、路由快取策略

2.  **Bits 日聚合增量更新**
    - **新增**: cheer_daily_agg 表納入 Prisma schema
    - **增量**: Bits 日聚合改為增量更新，降低高峰讀寫壓力
    - **讀路徑**: 補上 Bits 日聚合讀路徑與啟動重試保護

3.  **查詢上限治理**
    - **Migration**: 落地手動 migration 優化索引
    - **防呆**: 背景任務在高資料量下的全表掃描防護
    - **快取 TTL**: 補齊快取 TTL 基準與寫入護欄

4.  **前端優化**
    - **FootprintDashboard**: 收斂狀態更新路徑，避免不必要重渲染
    - **儀表板**: 批次查詢上限、即時更新與資源載入負擔降低

---

## 🚀 前一版本 (v1.10.0 - Query Performance) - 2026-02-06

**核心重點**: 效能優化 B1-B7/P1-P8 系列、聚合表/查詢下推、OAuth 診斷強化

### 🔧 關鍵變更

1.  **效能優化 B1-B7 與 P1-P8**
    - **聚合表**: 新增摘要/聚合表 (channel_summary 等) 與查詢下推
    - **快取預熱**: 伺服器啟動時預熱關鍵快取
    - **排程同步**: 優化排程任務間的同步機制
    - **索引**: 新增 channelName 索引與頻道分析合併查詢

2.  **高頻資料處理優化**
    - **寫入放大**: 降低資料庫寫入放大，縮短查詢延遲
    - **watchSeconds**: 收斂單寫入策略
    - **live-status**: 自適應降載，降低每分鐘輪詢壓力
    - **訊息批次**: 優化 viewer-message.repository 批次處理

3.  **OAuth 與認證流程重構**
    - **BFF 模式**: 前端改為 BFF (Backend For Frontend) 登入流程
    - **同網域轉發**: API 改用 Next.js rewrites 同網域轉發
    - **Cookie 保留**: 修正相對路徑以保留認證 Cookie
    - **跨瀏覽器**: 修復 OAuth 跨瀏覽器相容性問題

4.  **影片/剪輯同步強化**
    - **分頁同步**: 擴充分頁同步實況主影片與剪輯
    - **效能比較**: 新增 perf-compare 壓測腳本

---

## 🚀 前一版本 (v1.9.0 - Performance & Stability) - 2026-02-03

**核心重點**: 觀眾/後端排程效能優化、批次寫入、測試修正、WebSocket 通知上線

### � 關鍵變更

1.  **WebSocket 實時通知與影片同步**
    - **WebSocket**: 實作 WebSocket 實時通知基礎設施
    - **影片同步**: 新增觀眾頻道影片/剪輯同步功能
    - **資料庫遷移**: 新增 viewer_channel_video/clip 表

2.  **排程並發控制與延遲優化**
    - **修正**: Stream Status Job 並發控制確實生效
    - **調整**: 可透過 `STREAM_STATUS_CONCURRENCY_LIMIT` 調整並發上限
    - **效果**: 降低峰值壓力，同時維持接近原先的排程延遲

3.  **DB 寫入與記憶體優化**
    - **批次**: 觀看時間、追蹤同步改為批次 transaction/upsert
    - **聚合**: 日訊息統計改 DB 端 `INSERT...SELECT...ON CONFLICT`
    - **節流**: 分散式協調器清理節流，降低固定寫入量

4.  **部署與監控**
    - **Docker**: 新增 .dockerignore、更新 Dockerfile
    - **監控**: 導入 API 效能與記憶體監控 (slow-query-logger, query-metrics)
    - **工具**: 新增錯誤處理工具 (errors.ts)、記憶體閾值 (memory-thresholds.ts)、timeout 工具 (timeout.utils.ts)

5.  **前端穩定性與測試修正**
    - **修正**: 測試翻譯 key、路由參數與 fetch/mock 行為
    - **新增**: 補齊前端測試依賴 `@testing-library/dom`
    - **驗證**: Backend/Frontend 測試皆通過

---

## � 前一版本 (v1.8.0 - Infrastructure) - 2026-02-02

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
| —           | 效能優化與穩定性   | Code Review、Redis/Queue、批次寫入     | ✅   |

---

## 🕒 歷史更新紀錄 (History)

<details>
<summary><b>點擊展開過往更新詳情</b></summary>

### 2026-02-13 (v2.0.0 - Production Stability)

- **Code Review**: 完成全面 Code Review 收斂（查詢熱點、寫入路徑、Session 競態）
- **OAuth**: 強化 Twitch OAuth code exchange 網路韌性（timeout + 重試退避）
- **SQL 修復**: 修正生產環境 SQL 解析錯誤與查詢逾時未處理拒絕
- **可觀測性**: logger 結構化輸出、壓測腳本、索引驗證腳本
- **viewer**: 驗證路徑改為共用快取快照，降低慢查詢風險
- **lifetime**: 補上任務可中斷機制，避免長時間執行阻塞
- **索引**: 多項 migration 清理低效索引並補強查詢效能

### 2026-02-12 (v1.12.1 - Hotfix)

- **修復**: Auto Join Job 缺少 prisma import 導致 ReferenceError
- **收斂**: 背景任務重複寫入與高頻心跳壓力
- **強化**: listener slot 洩漏修復、安全性與效能穩定性提升
- **設定**: 新增 streamer-settings.schema 輸入驗證

### 2026-02-11 (v1.12.0 - Redis Infrastructure)

- **基礎設施**: 導入 Redis 與 Queue（data-export-queue、revenue-sync-queue）
- **修復**: 晚上高峰時段登入 100% 失敗問題
- **穩定性**: Queue 回壓保護、事件節流、多實例 WebSocket 同步

### 2026-02-10 (v1.11.0 - Code Review Performance)

- **效能**: 兩輪 Code Review 優化（連線治理、批次並行、timeout 保護）
- **Bits**: 日聚合增量更新、聚合表納入 Prisma schema
- **查詢**: 查詢上限治理、Migration 索引優化
- **前端**: FootprintDashboard 重渲染收斂、儀表板載入優化

### 2026-02-06 (v1.10.0 - Query Performance)

- **效能**: 完成 B1-B7 與 P1-P8 優化，新增聚合表與查詢下推
- **OAuth**: 前端改為 BFF 登入流程，修復跨瀏覽器相容性
- **影片**: 擴充分頁同步實況主影片與剪輯
- **文件**: 統一專案註解為 Zeabur 架構描述

### 2026-02-03 ~ 02-05 (v1.9.0 - Performance & Stability)

- **WebSocket**: 實作 WebSocket 實時通知與觀眾頻道數據管理
- **排程**: 並發控制、批次寫入、P0/P1 效能優化
- **部署**: Docker 配置優化（Dockerfile、.dockerignore）
- **監控**: 導入效能監控（slow-query-logger、query-metrics）
- **測試**: 修正前後端測試（mock、翻譯 key、路由參數）

### 2026-02-02 (v1.8.0 - Infrastructure)

- **架構**: 遷移至 Zeabur 單一後端部署
- **健康檢查**: UptimeRobot 直連 Zeabur
- **Extension**: API URL 更新為 Zeabur URL

### 2026-01-28 (v1.7.0 - Memory Optimization)

- **記憶體**: sync-videos.job 批次處理優化，峰值從 ~350MB 降至 ~150MB
- **監控**: 全局記憶體監控系統（400MB 警告、480MB 強制 GC）
- **快取**: Cache Manager 清理頻率提升至每 2 分鐘

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
| **Cache/Queue** | Redis, Memory Queue (回壓保護)                           |
| **Integration** | Twurple (Twitch API), Google Analytics                   |
| **CI/CD**       | GitHub Actions (自動備份、測試、部署)                     |
| **Monitoring**  | Sentry (錯誤追蹤), Slow Query Logger, 每日自動資料庫備份 |

---

## 🔒 資料安全措施 (Data Security)

| 措施            | 實施狀態 | 說明                                      |
| :-------------- | :------- | :---------------------------------------- |
| **自動備份**    | ✅ 已實施 | GitHub Actions 每日凌晨 2 點自動備份      |
| **備份保留**    | ✅ 已實施 | 保留 30 天備份歷史，可隨時下載恢復         |
| **手動備份**    | ✅ 已實施 | 提供手動備份腳本，隨時可執行               |
| **Branch 恢復** | ✅ 已驗證 | Turso PITR 功能可恢復到任意時間點          |
| **Migration 審查** | ✅ 已強化 | 禁止使用 DROP TABLE 等危險操作          |
| **寫入護欄**    | ✅ 已實施 | job-write-guard 防止異常批次寫入           |
| **Auth 強化**   | ✅ 已實施 | OAuth timeout/重試退避、CSRF 保護          |

---

## 🛠️ 權限需求 (Pending Epics)

未來開發將需要以下 Twitch OAuth Scopes：

- `channel:manage:broadcast` (Epic 4, 8) - 編輯頻道資訊
- `channel:read:subscriptions` / `bits:read` (Epic 4) - 收益分析
- `channel:manage:predictions` / `polls` (Epic 8) - 互動控制
- `channel:moderate` (Epic 7) - 聊天室管理
