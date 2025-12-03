# 風險與 NFR 對齊摘要（Risk & NFR Summary）

本文件彙總 `docs/prd.md` 與 `docs/architecture/*.md` 中已定義的主要風險與非功能需求（NFR），作為 QA Agent 在執行 `risk-profile`、`nfr-assess`、`review-story` 等任務時的參考入口。

---

## 1. 主要風險摘要（對應 Project Brief 3.1）

### R1. Twitch API 限制與政策變動

- **內容**：API 可取得的指標（特別是訂閱 / 互動明細）可能有限或未來變動。  
- **對應 PRD**：  
  - Story 1.4 / 2.3 的細節需以 Spike / POC 結果調整（`RQ-1`）。  
- **目前緩解方式**：  
  - 架構文件中為訂閱趨勢預留 `isEstimated`、`hasExactData`、`estimateSource` 等欄位，用以標示估算值。  
  - UI 規格要求以 Banner / Badge 清楚說明限制。  

### R2. 資料隱私與授權風險（特別是觀眾端）

- **內容**：如何平衡實況主需求與觀眾隱私（是否允許看到具名觀眾清單等）。  
- **對應 PRD**：  
  - `FR-V5`、`NFR-S2`、`NFR-S3`，以及開放議題 `RQ-2`。  
- **目前緩解方式**：  
  - 架構上以彙總統計為主，避免預設暴露個別觀眾明細。  
  - 提供觀眾「刪除 / 匿名化」統計資料的功能。  

### R3. 長期資料儲存與成本

- **內容**：長期追蹤開台與觀眾互動可能導致資料量增長與成本上升。  
- **目前緩解方式**：  
  - Data Model 以 daily aggregates（`ChannelDailyStat`, `ViewerChannelDailyStat`）為核心，避免儲存完整聊天訊息。  

### R4. 排程可靠性與 Rate Limit

- **內容**：排程 Job 失敗或過度壓力可能導致資料延遲或被 Twitch 限速／封鎖。  
- **對應 NFR**：  
  - `NFR-A2`（Job 失敗需有重試與錯誤 log）、架構文件中 Job reliability 討論。  

---

## 2. NFR Mapping（從 PRD → Architecture → UX）

### 2.1 效能（Performance）

- **PRD NFR**：  
  - `NFR-P1`：TTFB ≤ 1.5 秒、TTI ≤ 3 秒（主要儀表板）。  
  - `NFR-P2`：時間區間切換 / 查詢 ≤ 1 秒。  
- **架構對應**：  
  - 前端使用 Next.js SSR/SSG + React Query 快取。  
  - 後端在統計表加上索引與時間範圍限制。  
- **UX 對應**：  
  - 使用 Skeleton、過渡動畫避免感知上的「卡頓」。  

### 2.2 可用性與穩定性（Availability & Reliability）

- **PRD NFR**：  
  - `NFR-A1`：可用性目標 99%。  
  - `NFR-A2`：Job 失敗需有重試與告警（至少 log）。  
- **架構對應**：  
  - Job Queue / Scheduler + backoff 策略。  
  - 監控與 log 設計列在 `fullstack-architecture` 與 Epic 3.5。  

### 2.3 資安與隱私（Security & Privacy）

- **PRD NFR**：  
  - `NFR-S1`：HTTPS。  
  - `NFR-S2`：不儲存 Twitch 密碼，只儲存 Token，並以安全方式保存。  
  - `NFR-S3`：觀眾資料可刪除 / 匿名化。  
- **架構對應**：  
  - `TwitchToken` 表設計、Secret Manager 建議、API 授權檢查。  
  - Viewer 匿名化策略寫在 Data Model 章節。  

### 2.4 可訪問性（Accessibility）

- **PRD NFR**：  
  - `NFR-A11Y1` / `NFR-A11Y2`。  
- **UX 對應**：  
  - 前端規格明確要求對比度、鍵盤操作、圖表文字敘述與非顏色提示。  

### 2.5 SEO 與 Discoverability

- 僅影響公開 Landing Page；  
- 架構建議使用 Next.js SSR/SSG 來支援公開頁 SEO。  

### 2.6 可維護性（Maintainability）

- **PRD NFR-M 系列** 與前端／後端架構文件一致：  
  - React + TS + Tailwind、feature-based 結構、商業邏輯抽出成 utils / hooks、撰寫核心測試。  

---

## 3. QA Agent 使用建議

- 在執行 `risk-profile` 時，可直接引用本文件中的 R1–R4 作為初始風險清單，再依實際 Story 實作情況補充。  
- 在執行 `nfr-assess` 時，可對照第 2 章的 Mapping，檢查：  
  - Story 是否觸及這些 NFR。  
  - 實作與文件是否有背離或尚未覆蓋的地方。  
- 在 `review-story` 中，如發現違反既定 NFR（例如未使用 HTTPS、未標註估算值），可將對應條目標記為 FAIL 或 CONCERNS，並在 Gate 中引用本文件路徑。  

---

## 4. 未來更新建議

- 當真實實作或 Spike 結果改變對風險或 NFR 的理解時：  
  - 請同步更新 PRD / 架構文件與本摘要，避免 QA 使用過時依據。  
- 若之後導入更多 NFR（例如更嚴格的 SLO、監控規範），可在本文件中新增對應段落，以保持「QA 啟動點」的一致性。  


