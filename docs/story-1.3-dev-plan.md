# Story 1.3 開發計劃

**Story**: 開台時間與頻率圖表  
**狀態**: 準備開始實作  
**開始日期**: 2025-12-09

---

##  實作清單

### Phase 1: 後端 API (預估 4-6h)

- [ ] **Task 1: 時間序列 API**
  - [ ] 建立 `GET /api/streamer/me/time-series` 端點
  - [ ] 支援參數: `range` (7d/30d/90d), `granularity` (day/week)
  - [ ] 查詢 `ChannelDailyStat` 或聚合 `StreamSession`
  - [ ] 回傳格式: `{ date: string, totalHours: number, sessionCount: number }[]`
  - [ ] 單元測試 + 整合測試

- [ ] **Task 2: Heatmap 資料 API**
  - [ ] 建立 `GET /api/streamer/me/heatmap` 端點
  - [ ] 支援參數: `range` (7d/30d/90d)
  - [ ] 計算一週  24 小時的開台分布
  - [ ] 回傳格式: `{ dayOfWeek: 0-6, hour: 0-23, value: number }[]`
  - [ ] 單元測試 + 整合測試

### Phase 2: 前端圖表元件 (預估 6-8h)

- [ ] **Task 3: TimeSeriesChart 元件**
  - [ ] 建立 `frontend/src/features/streamer-dashboard/charts/TimeSeriesChart.tsx`
  - [ ] 使用 Recharts 的 LineChart 或 BarChart
  - [ ] 支援 Tooltip 顯示詳細資訊
  - [ ] 響應式設計 (mobile/desktop)
  - [ ] Loading 和 Empty 狀態
  - [ ] 元件測試

- [ ] **Task 4: HeatmapChart 元件**
  - [ ] 建立 `frontend/src/features/streamer-dashboard/charts/HeatmapChart.tsx`
  - [ ] 實作自訂 Heatmap (SVG 或使用 Recharts)
  - [ ] X 軸: 星期一~日, Y 軸: 0-23 時
  - [ ] 色階顯示開台強度
  - [ ] Tooltip 顯示時段資訊
  - [ ] 元件測試

- [ ] **Task 5: API Client 函數**
  - [ ] 在 `frontend/src/lib/api/streamer.ts` 新增:
    - `getStreamerTimeSeries(range, granularity)`
    - `getStreamerHeatmap(range)`
  - [ ] 類型定義

### Phase 3: 整合與測試 (預估 2-4h)

- [ ] **Task 6: Dashboard 頁面整合**
  - [ ] 更新 `frontend/src/app/dashboard/streamer/page.tsx`
  - [ ] 加入 TimeSeriesChart 和 HeatmapChart
  - [ ] 時間範圍選擇器共用
  - [ ] 佈局調整 (兩欄或上下)

- [ ] **Task 7: 測試資料準備**
  - [ ] 建立測試腳本產生時間序列資料
  - [ ] 確保資料涵蓋不同時段和星期

- [ ] **Task 8: 全面測試**
  - [ ] 手動測試所有互動
  - [ ] 確認響應式佈局
  - [ ] 效能檢查

---

##  技術決策

### 圖表庫: Recharts 
- **理由**: 
  - React 友善，與 Next.js 整合度高
  - TypeScript 支援完整
  - 文件清晰，學習曲線低
  - 足以滿足折線圖和熱力圖需求

### Heatmap 實作方式: 自訂 SVG
- **理由**:
  - Recharts 無內建 Heatmap
  - 自訂 SVG 靈活度高
  - 使用 D3 scale 處理色階

---

##  資料格式設計

### 時間序列 API 回應
\\\	ypescript
interface TimeSeriesPoint {
  date: string;           // "2025-12-09"
  totalHours: number;     // 5.5
  sessionCount: number;   // 3
}
\\\

### Heatmap API 回應
\\\	ypescript
interface HeatmapCell {
  dayOfWeek: number;   // 0-6 (0=Sunday)
  hour: number;        // 0-23
  value: number;       // 開台時數
}
\\\

---

##  Definition of Done

- [ ] 所有 API 端點實作完成並有測試
- [ ] 兩個圖表元件正常顯示
- [ ] Tooltip 互動正常
- [ ] 響應式佈局在 mobile/desktop 正常
- [ ] 空資料狀態處理完善
- [ ] 所有測試通過 (目標: 新增 15+ 測試)
- [ ] Story 文件更新為 Done

---

##  準備開始

**下一步**: 開始實作 Phase 1 - 後端時間序列 API

**預估完成時間**: 12-18 小時
