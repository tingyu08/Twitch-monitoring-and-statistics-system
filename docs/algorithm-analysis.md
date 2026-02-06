# 演算法與複雜度分析

## 使用的排序方式

| 位置 | 排序方法 | 說明 |
|------|---------|------|
| streamer.service.ts:196,254 | 字串 localeCompare 比較 | 時間序列按日期排序 |
| streamer.service.ts:458,519 | 數值降冪排序 | 遊戲統計按總時數排序 |
| streamer.service.ts:583 | 資料庫 ORDER BY viewCount DESC | 剪輯按觀看次數排序 |
| lifetime-stats-aggregator:239-242 | 數值排序 | 用於百分位排名計算 |
| lifetime-stats-aggregator:125 | 字串 .sort() | 活躍日期排序 |
| viewer.service.ts:320 | 多欄位複合排序 | 先按 isLive 降序，再按 lastWatched 降序 |
| watch-time.service.ts:44 | 時間戳排序 | 訊息按時間排序 |
| stats.worker.ts:116 | 數值排序 (Web Worker) | 排行榜按分數排序 |
| performance-monitor.ts:154 | 數值排序 | 效能百分位計算 |

以上排序皆使用 JavaScript 內建 `Array.prototype.sort`（實務上在 V8 為穩定排序），
平均複雜度可視為 O(n log n)。

## 核心函式複雜度

| 函式 | 時間 | 空間 | 演算法 |
|------|------|------|--------|
| updatePercentileRankings (百分位排名更新) | O(n log n) | O(n) | 排序 + HashMap 查找 + 批量更新 |
| calculateStats - 連續簽到 | O(n log n) | O(n) | Set 去重 + 排序 + 線性掃描 |
| 最活躍月份統計 | O(n) | O(m) | HashMap 計數 |
| 近 30/90 天活躍度 | O(n) | O(n) | Array.filter 過濾 |
| calculateWatchSessions (觀看區段計算) | O(n log n) | O(n) | 排序 + 線性掃描 (區段間隙判斷) |
| updateViewerWatchTime (觀看時間更新) | O(n) | O(1) | 游標分頁 + 累加器模式 |
| getStreamerHeatmap (熱力圖生成) | O(n×h) | O(1) | 固定 7×24 矩陣 + 時數分配 |
| getStreamerGameStats (遊戲統計) | O(n+k log k) | O(k) | HashMap 聚合 + 加權平均 + 排序 |
| aggregateByDay/Week (日/週聚合) | O(d+n+d log d) | O(d) | HashMap 初始化 + 聚合 + 排序 |
| getMessageStats (訊息統計) | O(n) | O(n) | 線性累加 + reduce 取最大值 |
| checkBadges (徽章檢查) | O(1) | O(1) | 固定 16 條規則，閾值比對 |
| calculateRadarScores (雷達圖分數) | O(1) | O(1) | 6 個線性正規化 |
| MemoryQueue.add (記憶體佇列新增) | O(n) | O(n) | 優先級插入 (上限 50) |
| VirtualList (虛擬滾動列表) | O(v) | O(v) | 視窗化渲染 |
| sortLeaderboard - Worker (排行榜排序) | O(n log n) | O(n) | 排序 + 截斷 |
| getFollowedChannels sort (追蹤頻道排序) | O(n log n) | O(n) | 多欄位複合排序 |
| streamCsvExport (CSV 串流匯出) | O(n) | O(b) | 游標分頁 + HashMap 合併 |
| evictLowestPriority (最低優先級驅逐) | O(n) | O(1) | 線性掃描 (上限 80) |
| getStats - 百分位 (效能百分位統計) | O(n log n) | O(n) | 排序 + 索引查找 |
