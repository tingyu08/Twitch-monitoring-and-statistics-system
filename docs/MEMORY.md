# Bmad Twitch 數據分析平台 - 專案記憶

## 技術棧
- **後端**: Express + Prisma (Zeabur 免費層, 0.5GB RAM)
- **前端**: Next.js + React + Recharts + react-window
- **資料庫**: Turso (libSQL) + Prisma ORM（schema 使用 SQLite provider 相容層）
- **快取**: 記憶體內 LRU (開發 50MB / 生產 30MB)

## 架構重點
- BFF 模式：viewer controller 透過 Promise.allSettled 聚合 4 個查詢
- 快取擊穿防護：透過 pendingPromises Map 實現請求合併
- 適應性 TTL：根據記憶體壓力動態調整快取時間
- Web Worker：將繁重的前端計算移至背景執行緒
- 虛擬滾動：大型列表使用 react-window 僅渲染可見區域
- 游標分頁：觀看時間計算使用游標分頁 (每頁 1000 筆)
- 串流匯出：CSV/PDF 匯出採用串流寫入避免記憶體尖峰

## 演算法與複雜度分析
詳見 [algorithm-analysis.md](algorithm-analysis.md)。

## 資料庫 I/O 瓶頸分析
詳見 [db-optimization.md](db-optimization.md) 的瓶頸識別與優化方案。

## 關鍵設計模式
- .sort() 使用 JS 內建穩定排序（實務上 V8 平均 O(n log n)）
- HashMap 聚合 (Map/Set) 用於分類統計、去重、計數
- 記憶體佇列使用優先級插入 (上限 50 個任務)
- 連續簽到計算：對排序後的日期進行線性掃描

## 經驗教訓
- 生產環境重點在「減少查詢次數與傳輸量」，比本機 SQLite WAL 調校更有效
- Zeabur 免費層限制：30 秒請求超時、0.5GB RAM 上限
- 收益查詢使用 Promise.race 搭配 20 秒/25 秒超時保護
