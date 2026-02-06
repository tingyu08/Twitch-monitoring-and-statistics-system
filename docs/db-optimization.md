# 資料庫 I/O 瓶頸分析與優化方案

## 目前架構限制
- **Prisma + SQLite provider**（生產環境為 Turso/libSQL，非本機單檔 SQLite）
- **Zeabur 免費層**：0.5GB RAM、30 秒請求超時限制
- **記憶體快取**：生產環境上限 30MB，LRU 淘汰策略

---

## 已識別的瓶頸 (依優先順序)

### B1: getFollowedChannels - 多段查詢與過量關聯載入 (中高嚴重度)
**檔案**: `viewer.service.ts:211-345`
**問題**: 3 個連續 DB 查詢 + `channel.findMany(include: streamer, streamSessions)`
- 查詢 1: viewerChannelLifetimeStats.findMany
- 查詢 2: userFollow.findMany
- 查詢 3: channel.findMany({ include: { streamer, streamSessions } })
- `streamSessions` 目前只需要判斷是否存在 active session（`take: 1`），但仍增加關聯查詢成本
**影響**: 追蹤頻道數高時，資料庫 round-trip 與關聯資料處理成本上升

### B2: updatePercentileRankings - 逐筆 UPDATE (高嚴重度)
**檔案**: `lifetime-stats-aggregator.service.ts:256-283`
**問題**: 每個觀眾統計各自執行一個 UPDATE 查詢，每批 50 筆
- 一個有 5000 名觀眾的頻道 = 100 個批次交易
**影響**: 嚴重的 SQLite 寫入鎖定，阻塞其他操作

### B3: calculateStats - 全量日期載入 (中嚴重度)
**檔案**: `lifetime-stats-aggregator.service.ts:87-96`
**問題**: 從 viewerChannelDailyStat 和 viewerChannelMessageDailyAgg 載入所有日期
- 目前已使用 `select: { date: true }`，但仍是「全量日期載入」
- findMany 沒有 LIMIT，長期觀眾資料量無上限
**影響**: 大資料量用戶在 streak 計算時會造成記憶體與 CPU 壓力

### B4: updateViewerWatchTime - 連續分頁查詢 (中嚴重度)
**檔案**: `watch-time.service.ts:229-253`
**問題**: 雖然使用游標分頁，但每頁仍需一次獨立的 DB 查詢
- 一天發送 5000 則訊息的觀眾 = 5 次連續查詢
- 游標條件使用 OR，SQLite 無法有效優化
**影響**: 對話題觀眾查詢緩慢，長時間佔用連線

### B5: getStreamerGameStats/getChannelGameStats - 全量 Session 載入 (中嚴重度)
**檔案**: `streamer.service.ts:400-520`
**問題**: 將所有 streamSession 記錄載入記憶體，然後在 JS 中聚合
- 沒有使用資料庫層級的 GROUP BY —— 所有計算在應用層進行
**影響**: 90 天內超過 1000 場直播的實況主，記憶體與傳輸量顯著增加

### B6: getStreamerHeatmap - 全量 Session 載入 (低嚴重度)
**檔案**: `streamer.service.ts:298-351`
**問題**: 載入所有直播場次，逐小時迭代分配時數
- 沒有資料庫聚合，全部在 JS 計算
**影響**: O(n×h)，長時間直播的 h 值可能很大

### B7: Revenue 原始 SQL 無法使用索引 (低嚴重度)
**檔案**: `revenue.service.ts:284-307, 366-386`
**問題**: 原始 SQL 查詢 (GROUP BY DATE(cheeredAt)) 無法有效使用索引
- SQLite 的 DATE() 函數會阻止索引使用
**影響**: cheer_events 表做日期分組時進行全表掃描

---

## 優化方案

### P1: 物化視圖模式 - 解決 getFollowedChannels [B1]
**做法**: 建立非正規化的 `viewer_channel_summary` 摘要表
```
model ViewerChannelSummary {
  viewerId       String
  channelId      String
  channelName    String
  displayName    String
  avatarUrl      String
  isLive         Boolean
  viewerCount    Int?
  lastWatched    DateTime?
  totalWatchMin  Int
  messageCount   Int
  isExternal     Boolean
  followedAt     DateTime?
  updatedAt      DateTime @updatedAt
  @@unique([viewerId, channelId])
}
```
- 由背景排程任務更新 (每 5 分鐘) 或在頻道狀態變更時觸發
- 單一查詢取代 3 個查詢 + N+1
- **預期改善**: 3 次查詢 -> 1 次查詢，回應時間 -60%

### P2: 批量 UPDATE 原始 SQL - 解決百分位排名 [B2]
**做法**: 用原始 SQL 的 CASE 語句取代逐筆 UPDATE
```sql
UPDATE viewer_channel_lifetime_stats
SET watchTimePercentile = CASE id
  WHEN 'id1' THEN 85.5
  WHEN 'id2' THEN 72.3
  ...
END,
messagePercentile = CASE id
  WHEN 'id1' THEN 90.0
  ...
END
WHERE id IN ('id1', 'id2', ...)
```
- 每條 SQL 批量處理 500 筆，取代原本每次 50 筆的獨立更新
- **預期改善**: 100 次交易 -> 10 條 SQL 語句，寫入時間 -90%

### P3: 資料庫層級聚合 - 解決遊戲統計 [B5]
**做法**: 使用 Prisma groupBy 或原始 SQL GROUP BY
```sql
SELECT
  COALESCE(category, 'Uncategorized') as gameName,
  SUM(durationSeconds) as totalSeconds,
  SUM(avgViewers * durationSeconds) as weightedViewers,
  MAX(peakViewers) as peakViewers,
  COUNT(*) as streamCount
FROM stream_sessions
WHERE channelId = ? AND startedAt >= ?
GROUP BY category
ORDER BY totalSeconds DESC
```
- 將計算從 JS 層移至 SQLite 引擎
- **預期改善**: 傳輸量 -80%，計算時間 -50%

### P4: 純日期索引 + 資料庫 COUNT - 解決 Streak 計算 [B3]
**做法**:
1. 在 (viewerId, channelId, date) 上建立覆蓋索引
2. 使用原始 SQL 直接取得不重複日期（避免在欄位上包 `DATE()` 函數）：
```sql
SELECT DISTINCT date as d
FROM viewer_channel_daily_stats
WHERE viewerId = ? AND channelId = ?
UNION
SELECT DISTINCT date as d
FROM viewer_channel_message_daily_aggs
WHERE viewerId = ? AND channelId = ?
ORDER BY d ASC
```
3. 對 activeDaysLast30/90 使用 COUNT + WHERE 取代載入所有日期：
```sql
SELECT COUNT(DISTINCT date) as cnt
FROM viewer_channel_daily_stats
WHERE viewerId = ? AND channelId = ? AND date >= ?
```
- **預期改善**: 記憶體使用 -70%，避免載入所有資料列

### P5: 新增計算日期欄位 - 解決 Cheer Events 索引問題 [B7]
**做法**: 在 cheer_events 新增 `cheeredDate` 日期欄位
```prisma
model CheerEvent {
  ...
  cheeredDate  DateTime  // 僅日期，建立索引
  @@index([streamerId, cheeredDate])
}
```
- 透過觸發器或寫入時自動填入
- 允許直接使用索引，取代 DATE() 函數
- **預期改善**: 全表掃描 -> 索引掃描，查詢時間 -80%

### P6: 熱力圖預聚合 [B6]
**做法**: 建立 `channel_hourly_stats` 聚合表
```
model ChannelHourlyStat {
  channelId  String
  dayOfWeek  Int     // 0-6 (週日-週六)
  hour       Int     // 0-23
  totalHours Float
  range      String  // '7d', '30d', '90d'
  updatedAt  DateTime
  @@unique([channelId, dayOfWeek, hour, range])
}
```
- 由背景排程任務在每場直播結束後更新
- 熱力圖查詢：單一 findMany 取代載入所有直播場次
- **預期改善**: O(n×h) -> O(1)，即時回應

### P7: WAL 模式 + 連線管理 [通用]
**做法**:
1. 若為「本機 SQLite 檔案」環境，可啟用 WAL：
```sql
PRAGMA journal_mode=WAL;
PRAGMA busy_timeout=5000;
PRAGMA synchronous=NORMAL;
```
2. 生產使用 Turso/libSQL 時，優先做法應是：
- 減少單請求查詢數
- 避免大量逐筆更新
- 以聚合查詢取代應用層全量掃描

本項在 Turso/Zeabur 架構下屬於次要優化。

（以下設定僅適用本機 SQLite）
```typescript
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
  // SQLite 不支援連線池，但 WAL 有助於併發
});
```
- **預期改善**: 僅在本機 SQLite 明顯；生產 Turso 下改善有限

### P8: 智慧快取預熱 [通用]
**做法**: 伺服器啟動時為活躍用戶預先填充快取
```typescript
// 啟動時或快取清空後執行
async function warmCache() {
  const recentViewers = await prisma.viewer.findMany({
    where: { updatedAt: { gte: oneDayAgo } },
    take: 100,
  });
  for (const viewer of recentViewers) {
    await getFollowedChannels(viewer.id); // 填充快取
  }
}
```
- **預期改善**: 消除活躍用戶的首次請求延遲

---

## 實施優先順序矩陣

| 編號 | 投入成本 | 影響程度 | 優先序 |
|------|---------|---------|--------|
| P1 | 高 | 高 | 第 1 — 最大的使用者體感改善 |
| P2 | 低 | 高 | 第 2 — 容易實現，大幅減少寫入 |
| P3 | 低 | 中 | 第 3 — 簡單的 SQL 重構 |
| P7 | 低 | 低 | 第 7 — 僅本機 SQLite 場景收益明顯 |
| P4 | 中 | 中 | 第 5 — 需要 Schema 和查詢變更 |
| P5 | 中 | 低 | 第 6 — 收益功能優化 |
| P8 | 低 | 低 | 第 4 — 可快速改善冷啟動後首批體驗 |
| P6 | 高 | 低 | 第 8 — 僅在熱力圖確實緩慢時實施 |

## 遷移考量
**長期方案**: 若資料量超過 SQLite 極限 (~1GB)，建議遷移至 PostgreSQL：
- 原生支援併發寫入
- JSONB 彈性 Schema
- 窗口函數計算百分位 (PERCENT_RANK)
- 原生 DATE_TRUNC 時間分組
- 連線池 (PgBouncer)
- 這將從根本上消除 B2、B4、B5、B7 瓶頸
