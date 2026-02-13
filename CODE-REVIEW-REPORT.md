# Twitch Analytics 平台 - 程式碼審查追蹤報告（中文）

**最後更新**：2026-02-13
**範圍**：Backend 全域 99 項
**說明**：本檔已改為「追蹤版」。先列**未完成**，再列**已完成**。

---

## 一、未完成項目（含部分完成）

> 標記：`[未完成]`、`[部分完成]`

### 1) 效能 / 查詢 / 回應

- `[部分完成] QUERY-08`：已補強多條影片/剪輯查詢 `select` 欄位收斂，仍待全域熱路徑掃描完成。

### 2) 批次作業 / 記憶體 / 寫入量


- `[部分完成] MEM-02`：排名計算改為 DB 端更新，記憶體峰值已顯著下降；仍待生產壓測確認。
- `[部分完成] MEM-12`：overflow 檔案已補跨程序 lock + stale lock 回收，並新增壓測測試；仍待長時間高併發實測驗證。
- `[部分完成] MEM-10`：`getOrSetWithTags` 已補 Redis lock + wait fallback，待高併發壓測驗證。

### 3) 安全 / Schema / 架構


- `[未完成] ARCH-02`：AuthController dead code 清理尚未完成（需先最終確認使用路徑）。
- `[未完成] ARCH-03`：template service CRUD 去重未完成。
- `[未完成] ARCH-07`：註解編碼亂碼尚未全域清理。
- `[未完成] ARCH-08`：logger 結構化與等級治理未完成。

---

## 二、已完成項目

> 標記：`[已完成]`、`[已完成-誤報校正]`

### 1) 啟動 / 效能 / 回應

- `[已完成] ENV-01`：移除 `env.ts` 啟動期同步 debug I/O 與敏感資訊落盤。
- `[已完成] STARTUP-01`：Revenue prewarm 改為並行處理。
- `[已完成] STARTUP-02`：viewer cache warmup 改為分批並行，降低冷啟序列等待。
- `[已完成] STARTUP-03`：Redis 移除 `lazyConnect` 啟動空窗。
- `[已完成] STARTUP-04`：已移除全域 `console.warn` 覆寫，改回標準 logger 行為。

- `[已完成] QUERY-05`：移除 stream-status 無必要 COUNT 查詢。
- `[已完成] QUERY-01`：`updatePercentileRankings` 改為 DB 端排名更新，移除全量載入排序。
- `[已完成] QUERY-06`：`getFollowedChannels` 導入使用者 ApiClient 快取（含容量上限），降低重複初始化成本。
- `[已完成] QUERY-07`：`channel-stats-sync` 日統計改為 DB 端聚合（`groupBy`），移除 JS 端全量分組。
- `[已完成] QUERY-09`：extension heartbeat 已加入 channelId 快取。
- `[已完成] QUERY-11`：stream-status session 批次與延遲參數已優化。
- `[已完成] QUERY-03`：`channel-stats-sync` 已停止寫入 stream session，session 寫入權威路徑收斂至 stream-status/EventSub。
- `[已完成] QUERY-04`：`getChannelInfoByIds` 已補批次快照與 pending/cache 合併，支援大於 100 IDs 分段批次。
- `[已完成] QUERY-10`：lifetime aggregate/watch-time 重複掃描已整併，移除重複 COUNT 查詢。
- `[已完成] QUERY-12`：slow query 監控已由 Prisma `$use` 遷移至 `$extends` query extension。
- `[已完成] QUERY-13`：performance metrics 改 ring-buffer 寫入，移除 `shift()` 熱路徑成本。
- `[已完成] QUERY-14`：performance path 已做動態路徑正規化。
- `[已完成] QUERY-02`：實況主影片/剪輯同步改為批次 SQL upsert，降低逐筆 upsert 開銷。

- `[已完成] RESPONSE-01`：subscription-sync 改為正確 token 解密（含舊資料相容）。
- `[已完成] RESPONSE-02`：heartbeat 寫入流程由序列改平行，並升級為緩衝 flush 模式。
- `[已完成] RESPONSE-03`：登入後 follow sync 已改背景執行，不阻塞主回應。
- `[已完成] RESPONSE-04`：streamer-settings 已抽出共用 Twitch API 呼叫/刷新邏輯，移除重複流程。
- `[已完成] RESPONSE-05`：viewer lifetime 首訪流程精簡為查詢 miss 後直接聚合+回傳，減少一次重複查詢。
- `[已完成] RESPONSE-06`：public game-stats 改直接走 `channelId` 查詢，移除冗餘 lookup chain。

### 2) 批次作業 / 記憶體 / 寫入量

- `[已完成] BATCH-01`：`sync-videos.job` 補 `isRunning` guard 與 timeout。
- `[已完成] BATCH-02`：`update-lifetime-stats` 增加執行時間上限與分批可中斷流程。
- `[已完成] BATCH-03`：`stopAllJobs` 已可停止 cron 與清理 timeout。
- `[已完成] BATCH-05`：subscriptions 分頁加入上限保護。

- `[已完成] MEM-01`：閾值判斷改為 RSS 視角。
- `[已完成] MEM-03`：移除重複記憶體監控來源（由單一監控主導）。
- `[已完成] MEM-04`：cache `get()` 已提升為真 LRU 行為。
- `[已完成] MEM-05`：調整生產/開發快取容量配置。
- `[已完成] MEM-06`：`estimateSize` 改為低成本分層估算，移除高成本 `JSON.stringify` 熱路徑。
- `[已完成] MEM-08`：移除孤兒 queue singleton。
- `[已完成] MEM-09`：Twurple user auth providers 新增上限與 LRU 淘汰機制。

- `[已完成] WRITE-02`：`update-live-status` 已有批次/節流優化，顯著降低固定寫入壓力。
- `[已完成] WRITE-03`：retention 刪除改分批刪除，避免長鎖。
- `[已完成] WRITE-04`：heartbeat 改緩衝批次 flush，降低高頻即時寫入。
- `[已完成] WRITE-05`：移除與影片同步衝突的清理策略。
- `[已完成] WRITE-06`：distributed lock 改為原子流程（create + conditional updateMany）。
- `[已完成] WRITE-07`：auto-join 已移除 DB 狀態寫入，避免重複更新。
- `[已完成] WRITE-09`：trigger follow sync 改批次 SQL upsert。
- `[已完成] WRITE-10`：Prisma shutdown hooks 與 server 關閉流程競態已處理。
- `[已完成] WRITE-11`：WebSocket shutdown 已補 `io.close()`。
- `[已完成] WRITE-12`：EventSub stream online 已做 session 去重保護。
- `[已完成] WRITE-13`：`cleanupExpiredExports` 改批次狀態更新（`updateMany`）與並行刪檔。
- `[已完成] WRITE-08`：viewer-message 批次寫入改為「原始訊息落地 + 聚合交易」縮小交易範圍，降低鎖競爭。
- `[已完成] WRITE-01`：Session 寫入權威路徑已收斂，預設由 stream-status job 主導（EventSub 可透過環境變數切換）。
- `[已完成] BATCH-04`：write guard 已從全域隊列改為資源鍵控寫入鎖。

### 3) 安全 / Schema / 架構

- `[已完成] SEC-04`：viewer-message-stats IDOR 已封鎖。
- `[已完成] SEC-02`：logout/token 失效流程已統一，`logoutHandler` 亦會遞增 `tokenVersion`。
- `[已完成] SEC-05`：主要 production routes 已統一使用 `requireAuth()` / `requireAuth(["viewer"])`，並同步修正測試 mock。
- `[已完成] SEC-07`：`/auth/exchange` 已補 state cookie 驗證與清理，CSRF 流程收斂。
- `[已完成] SEC-06`：EventSub 驗簽改用 `rawBody`。
- `[已完成] SEC-08`：heartbeat `duration` 上限已加 (`max(3600)`)。
- `[已完成] SEC-09`：proxy 禁止 redirect 跟隨 (`maxRedirects: 0`)。
- `[已完成] SEC-10`：streamer settings/template 已補 Zod 驗證。

- `[已完成-誤報校正] SEC-01`：原報告「admin/monitoring 全未驗證」不成立；現況已補強 monitoring auth。
- `[已完成-誤報校正] SEC-03`：原報告「public streamer 無 rate limit」不成立（有全域 API rate limit）。

- `[已完成] ARCH-04`：多處控制器型別統一為 `AuthRequest`。
- `[已完成] ARCH-05`：Cookie 清理/設定邏輯已集中重用，減少重複。
- `[已完成] ARCH-06`：stream-status running average 改為基於樣本數的正確累計平均。
- `[已完成] ARCH-01`：已全域移除 backend `new Function(import...)`，統一改用安全動態 import helper。

### 4) 快取與資料模型

- `[已完成] MEM-11`：`getOrSetWithTags` 已補分散式鎖，減少多實例快取擊穿。
- `[已完成] SCHEMA-01`：冗餘索引清理已完成，並以 `db:verify:index-cleanup` 驗證查詢計畫使用唯一索引。
- `[已完成] SCHEMA-02`：`CheerDailyAgg` 已補 relation/FK（待 migration 套用）。

---

## 三、維護規則（後續承諾）

- 每次完成一項修正，會在本檔同步更新狀態（未完成 -> 已完成）。
- 如遇到報告誤判，會標記為「已完成-誤報校正」並保留簡短說明。

---

## 四、生產環境即時修復（非原 99 項）

- `[已完成] PROD-HOTFIX-01`：修正 `viewer-message.repository` 的批次 upsert raw SQL 寫法（改 CTE + VALUES），避免 Turso/libSQL `SQL_PARSE_ERROR near LP`。
- `[已完成] PROD-HOTFIX-02`：修正 `revenue.service` 查詢 timeout 實作，改為可清理 timer 的 `withQueryTimeout`，避免 `PromiseRejectionHandledWarning` 與未處理拒絕。
