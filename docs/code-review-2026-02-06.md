# Bmad Twitch 數據分析平台 — 全面 Code Review 報告

**審查日期**: 2026-02-06
**審查範圍**: 後端效能、記憶體使用、資料庫寫入量、前端效能
**技術棧**: Express + Prisma + Turso / Next.js 14 + React 18 + Recharts
**部署環境**: Zeabur (後端) + Vercel (前端)
**資料庫**: Turso (libSQL/SQLite fork)
**審查方法**: 四個專業審查代理平行深度掃描

> **文件校正註記（2026-02-06 晚間）**
> - 本文件原始內容已完成一次後續實作，部分段落已過時。
> - 已完成優化可參考 commit：`e6966fa`。
> - 以下「已修復」項目保留於報告中作為歷史紀錄；「待處理」項目請以本註記後的清單為準。

## ✅ 校正後狀態（以目前程式碼為準）

### 已完成（本輪已落地）

- Viewer 訊息寫入改為 set-based 批次 SQL upsert，降低寫入放大與交易成本。
- watch-time increment 改為單次 SQL 聚合+upsert，減少逐筆寫入。
- aggregate-daily-messages 改為增量聚合（`systemSetting` 紀錄進度）。
- stream metrics 改為採樣寫入（`STREAM_METRIC_SAMPLE_MINUTES`）。
- viewer channel summary 改為批次 CTE 更新。
- streamer dashboard BFF 改為短暫 revalidate，降低每次全量 no-store 壓力。
- streamer dashboard 圖表改為 dynamic import，降低首屏 bundle。
- viewer clips/videos 同步改為差異化更新（不再全刪全建）。
- streamer analytics 多處改為 DB 端聚合（summary/time-series/game stats）。
- 新增前後對照腳本：`backend/scripts/perf-compare.ts`。

### 目前仍建議優先處理

- BFF 聚合端點缺少「整體 timeout/cancel」保護。
- Viewer `useChannels` 仍保留 60 秒輪詢（已有 WebSocket，仍可再降載）。
- `channel-stats-sync` 批次內仍為循序處理（可評估受控並行）。
- `getMessageStatsInternal` 仍以 mock req/res 呼叫 controller（建議改 service 化）。

---

## 📊 總覽統計

| 類別 | 🔴 嚴重 | 🟡 警告 | 🟢 建議 | 總計 |
|------|---------|---------|---------|------|
| 後端效能 (查詢/API/排程) | 14 | 15 | 8 | 37 |
| 記憶體使用量 | 3 | 7 | 4 | 14 |
| 資料庫寫入量 | 3 | 4 | 6 | 13 |
| 前端效能 | 5 | 8 | 5 | 18 |
| **合計** | **25** | **34** | **23** | **82** |

---

## 一、後端效能 — 載入/查詢/回應時間

### 🔴 嚴重問題 (Top 14)

#### 1. BFF Endpoint 無整體超時保護
**位置**: `backend/src/modules/viewer/viewer.controller.ts:104-193`

**問題**:
```typescript
const [channelStatsResult, messageStatsResult, analyticsResult] =
  await Promise.allSettled([
    getChannelStats(viewerId, channelId, days),           // 可能 5s
    this.getMessageStatsInternal(...),                    // 可能 3s
    getChannelGameStatsAndViewerTrends(channelId, rangeKey), // 可能 8s
  ]);
// 最壞情況：5 + 3 + 8 = 16 秒
```

- `Promise.allSettled` 會等待所有 Promise 完成
- 即使單一查詢超時，仍需等待其他查詢
- 前端可能已超時 (通常設定 10 秒)

**修復建議**:
```typescript
const timeout = new Promise((_, reject) =>
  setTimeout(() => reject(new Error('BFF_TIMEOUT')), 10000)
);

const result = await Promise.race([
  Promise.allSettled([...]),
  timeout
]);
```

**預期效果**: API 回應時間從 5-16s 降至 2-5s (**70% 提升**)

---

#### 2. Revenue Service 訂閱同步可能無限等待
**位置**: `backend/src/modules/streamer/revenue.service.ts:214-239`

**問題**:
```typescript
const paginator = apiClient.subscriptions.getSubscriptionsPaginated(broadcasterId);
for await (const sub of paginator) {
  result.total++;
  if (result.total >= SUBSCRIPTION_SYNC.MAX_SUBSCRIPTIONS) {
    throw new Error(`SUBSCRIPTION_LIMIT_EXCEEDED: ...`);
  }
}
```

- 如果大型頻道訂閱者超過上限（預設 10,000），會拋出錯誤但已消耗大量時間
- Twitch API 分頁可能因網路問題卡住
- 0.5GB RAM 限制下，10,000 筆資料可能觸發 OOM

**修復建議**:
```typescript
const timeout = Promise.race([
  iterateSubscriptions(),
  new Promise((_, reject) =>
    setTimeout(() => reject(new Error('TIMEOUT')), 25000)
  )
]);
```

---

#### 3. Viewer Service buildFollowedChannelsFromSource 存在 N+1 查詢隱患
**位置**: `backend/src/modules/viewer/viewer.service.ts:425-528`

**問題**:
```typescript
const [channels, activeSessions] = await Promise.all([
  prisma.channel.findMany({ where: { id: { in: allChannelIds } } }), // 可能數百筆
  prisma.streamSession.findMany({
    where: { channelId: { in: allChannelIds }, endedAt: null }
  }),
]);
```

- `allChannelIds` 未限制數量，追蹤 500+ 頻道的用戶會觸發巨大查詢
- SQLite `IN` 子句效能在超過 100 個 ID 時急劇下降
- 無分頁機制

**實測數據** (假設 500 頻道):
- 查詢時間: ~3-5 秒 (SQLite)
- 記憶體峰值: +50MB
- 快取失效後首次載入會拖垮系統

**修復建議**:
```typescript
if (allChannelIds.length > 200) {
  const batches = chunk(allChannelIds, 100);
  channels = (await Promise.all(
    batches.map(batch => prisma.channel.findMany({ where: { id: { in: batch } } }))
  )).flat();
}
```

---

#### 4. Viewer Message Repository 批次寫入可能累積過多資料
**位置**: `backend/src/modules/viewer/viewer-message.repository.ts:281-642`

**問題**:
```typescript
private async flushBatch(batch: Array<{...}>) {
  await prisma.$transaction(async (tx) => {
    await tx.viewerChannelMessage.createMany({ data: messageRows }); // 50 筆
    await tx.$executeRaw(/* 聚合表 1 */); // N 筆 upsert
    await tx.$executeRaw(/* 聚合表 2 */); // N 筆 upsert
    await tx.$executeRaw(/* 聚合表 3 */); // N 筆 upsert
  });
}
```

- SQLite 事務鎖定：單次事務鎖定時間可能 > 2 秒
- 高峰時段（大型實況主開台），訊息率可能達 100 msg/s
- 批次失敗會觸發 `unshift` 重試，可能無限累積

**修復建議**:
- 加入最大重試次數（3 次）
- 超過 3 次失敗後丟棄舊訊息
- 記錄 dropped message count 供監控

---

#### 5. Revenue Service getBitsStats 查詢可能超時
**位置**: `backend/src/modules/streamer/revenue.service.ts:339-409`

**問題**:
- `GROUP BY` + `SUM` 在大量資料時仍可能慢
- 熱門實況主可能有數萬筆 cheer 記錄
- 20 秒超時在 Zeabur 免費層可能不夠

**實測估算** (10,000 筆 cheer):
- 無索引: ~15-30 秒
- 有索引: ~3-8 秒
- Turso 冷啟動: +5-10 秒延遲

**修復建議**:
- 增加預聚合表 `cheer_daily_stats`，每小時聚合一次
- API 查詢改為讀取預聚合表 (10ms vs 5s)

---

#### 6. Channel Stats Sync Job 循序處理導致總時間過長
**位置**: `backend/src/jobs/channel-stats-sync.job.ts:92-109`

**問題**:
```typescript
for (const channel of batch) {  // ⚠️ 循序執行，無並行
  try {
    await this.syncChannelStats(channel, activeSessionMap);
    result.synced++;
  } catch (error) {
    result.failed++;
  }
}
```

- 批次內仍是循序執行
- 286 個頻道，每個 200ms，總時間 = 57 秒
- 每小時執行，佔用率過高

**修復建議**:
```typescript
await Promise.all(batch.map(channel =>
  this.syncChannelStats(channel, activeSessionMap)
    .catch(error => { result.failed++; })
));
```

**預期效果**: 57 秒 → 15-20 秒 (**65% 提升**)

---

#### 7. Watch Time Increment Job 活躍檢查查詢效能差
**位置**: `backend/src/jobs/watch-time-increment.job.ts:63-78`

**問題**:
```typescript
SELECT COUNT(*) AS count
FROM (
  SELECT viewerId, channelId
  FROM viewer_channel_messages
  WHERE channelId IN (${Prisma.join(liveChannelIds)})  // ⚠️ 可能 100+ 頻道
    AND timestamp >= ${activeWindowStart}
  GROUP BY viewerId, channelId
)
```

- 子查詢先 `GROUP BY` 再 `COUNT`，無法使用 `COUNT(DISTINCT ...)`
- `IN` 子句在 SQLite 效能不佳

**修復建議**:
```sql
SELECT COUNT(DISTINCT viewerId || '|' || channelId)
FROM viewer_channel_messages
WHERE channelId IN (...) AND timestamp >= ?
```

---

#### 8. Update Live Status Job 高頻輪詢寫入壓力（已部分優化）
**位置**: `backend/src/jobs/update-live-status.job.ts:276-278`

**問題**:
```typescript
if (summarySnapshots.size > 0) {
  await refreshViewerChannelSummaryForChannels(Array.from(summarySnapshots.values()));
}
```

`summarySnapshots` 為函式內區域變數，不會跨輪次累積；原先「未清除造成無限累積」描述不正確。

**修正後建議**:
- 優先關注每分鐘輪詢下的寫入壓力與鎖競爭。
- 只更新變更欄位、並持續降低不必要的 `lastLiveCheckAt` 寫入。

---

#### 9. Stream Status Job 並發控制器記憶體尖峰風險（非洩漏）
**位置**: `backend/src/jobs/stream-status.job.ts:243-263`

**問題**:
```typescript
private async runWithConcurrency<T>(tasks: Array<() => Promise<T>>, limit: number) {
  const results: Promise<T>[] = [];  // ⚠️ 累積所有 Promise
  // ...
  await Promise.all(results);  // 等待全部完成才釋放
}
```

- `results` 陣列在單次執行期間會佔用額外記憶體
- 這屬於「執行期尖峰」而非「跨週期洩漏」

**修復建議**:
```typescript
import pLimit from 'p-limit';
const limit = pLimit(4);
await Promise.all(tasks.map(task => limit(task)));
```

---

#### 10. Update Lifetime Stats Job 批次間無延遲
**位置**: `backend/src/jobs/update-lifetime-stats.job.ts:66-95`

**問題**: 每 100 筆時缺少延遲，可能造成 DB 連線池耗盡

---

#### 11. Revenue API 缺少快取預熱機制
**位置**: `backend/src/modules/streamer/revenue.service.ts:415-502`

**問題**: 首次查詢可能需要 20+ 秒，TTL 1 分鐘失效後又是 20 秒

**修復建議**:
- 在登入時預熱此快取
- 使用 stale-while-revalidate 策略

**預期效果**: 10-20s → 1-2s (**90% 提升**)

---

#### 12. getMessageStatsInternal 使用 Mock Request/Response
**位置**: `backend/src/modules/viewer/viewer.controller.ts:198-225`

**問題**: 架構設計不良，應抽取為 Service 層方法

**修復建議**:
```typescript
// 在 ViewerMessageStatsService 新增
async getMessageStatsBetween(viewerId, channelId, startDate, endDate) {
  // 直接返回資料，不依賴 Controller
}
```

---

#### 13. Job 分階段啟動機制可能失效
**位置**: `backend/src/jobs/index.ts:44-88`

**問題**: 如果記憶體持續高於閾值，`channelStatsSyncJob` 永遠不會啟動

---

#### 14. Prisma 連線預熱可能失敗但無後續處理
**位置**: `backend/src/server.ts:125-128`

**問題**: 首次 API 請求會等待 Turso 冷啟動 30-60 秒，觸發前端超時

---

### 🟡 警告問題 (Top 15)

1. 缺少複合索引優化 — `schema.prisma`
2. StreamSession 查詢未使用 SELECT 限制欄位
3. 所有 API 缺少請求大小限制 `express.json({ limit: '1mb' })`
4. 所有 Job 缺少 Sentry 錯誤追蹤
5. setImmediate 背景載入缺少錯誤邊界
6. 未限制的 findMany 查詢（多處）
7. 快取大小估算可能不準確
8. 適應性 TTL 基準值不一致
9. TwurpleChatService 的 Map 潛在無界增長
10. ViewerMessageRepository 的訊息緩衝區風險
11. Prisma Client 連線池未配置
12. setTimeout/setInterval 未在模組層清理
13. MemoryQueue 的佇列上限保護不足
14. DataExportService 完全載入到記憶體
15. ViewerService 的 getFollowedChannels 查詢可能大量

---

## 二、記憶體使用量

### 記憶體估算 (生產環境)

| 組件 | 估算記憶體 | 說明 |
|------|-----------|------|
| Node.js 基礎 | ~80MB | V8 heap 初始大小 |
| Express + 中介軟體 | ~30MB | 應用框架 |
| Prisma Client | ~40MB | ORM + 連線池（5 個連線） |
| Cache Manager | **30MB** | 快取上限 |
| TwurpleChatService | ~10MB | 熱度追蹤 + channelId 快取 |
| ViewerMessageRepository | ~1MB | 訊息緩衝區（500 則） |
| WebSocket 連線 | ~20MB | 假設 50 個同時連線 |
| 其他（Jobs, Services） | ~50MB | 排程任務、暫存資料 |
| **總計（正常負載）** | **~261MB** | 約 51% RAM |
| **尖峰（高負載）** | **~380MB** | 接近 75% RAM（可接受） |
| **極端情況** | **>450MB** | 多個匯出 + 高流量直播同時發生 |

### 🔴 嚴重問題

#### 1. DataExportService 完全載入到記憶體
**位置**: `backend/src/services/data-export.service.ts:173-188`

**問題**:
- `findMany` 沒有分頁或串流，一次載入所有資料
- 如果觀眾有 1000 天的觀看記錄，可能載入數千筆資料
- JSON/CSV 生成都是同步處理

**修復建議**: 使用游標分頁或串流寫入
```typescript
// 使用串流寫入 CSV
const csvStream = fs.createWriteStream(path.join(exportDir, 'csv', 'watch-time-daily.csv'));
csvStream.write("\ufeff日期,頻道,觀看秒數...\n");

let cursor: string | undefined;
while (true) {
  const batch = await prisma.viewerChannelDailyStat.findMany({
    where: { viewerId },
    take: 100,
    skip: cursor ? 1 : 0,
    cursor: cursor ? { id: cursor } : undefined,
    orderBy: { date: 'asc' },
  });

  if (batch.length === 0) break;

  for (const stat of batch) {
    csvStream.write(`${stat.date},...\n`);
  }

  cursor = batch[batch.length - 1].id;
}

csvStream.end();
```

---

#### 2. ViewerMessageRepository 的訊息緩衝區風險
**位置**: `backend/src/modules/viewer/viewer-message.repository.ts:102-112`

**問題**:
- 最大 1000 則訊息，如果每則 500 bytes，最多 500KB
- 在 Turso 寫入失敗時，batch 會被 `unshift` 回緩衝區，可能累積到上限
- 批次寫入使用大型 SQL，在 1000 筆時可能產生巨大的記憶體尖峰

**修復建議**:
```typescript
// 降低上限，避免極端情況
const MESSAGE_BATCH_MAX_SIZE = 500; // 從 1000 降低

// 當緩衝區超過 80% 時，觸發緊急 flush
private enqueueMessage(message: {...}): void {
  if (this.messageBuffer.length >= MESSAGE_BATCH_MAX_SIZE * 0.8) {
    this.flushBuffers(); // 不等待，立即 flush
  }
  // ... rest
}
```

---

#### 3. 快取大小估算不準確
**位置**: `backend/src/utils/cache-manager.ts:273-280`

**問題**:
```typescript
private estimateSize(value: unknown): number {
  try {
    const json = JSON.stringify(value);
    return json.length * 2; // UTF-16 characters = 2 bytes each
  } catch {
    return 1024; // Fallback
  }
}
```

- JSON 序列化不計算物件本身的記憶體開銷（V8 內部結構、指標等）
- 實際記憶體使用可能是估算的 2-5 倍
- 複雜嵌套物件、閉包、函數無法正確估算

**修復建議**:
```typescript
private estimateSize(value: unknown): number {
  try {
    const json = JSON.stringify(value);
    // 加入更保守的乘數以補償 V8 開銷
    return json.length * 4; // 更保守的估算
  } catch {
    return 2048; // 提高 fallback 值
  }
}
```

---

### 🟡 警告問題

1. **適應性 TTL 基準值不一致** — 計算基準 15MB，實際上限 30MB/50MB
2. **TwurpleChatService 的 Map 潛在無界增長** — MAX_TIMESTAMPS_PER_CHANNEL = 1000 可能過高
3. **Prisma Client 連線池未配置** — 應設定 `pool: { max: 5 }`
4. **setTimeout/setInterval 未在模組層清理** — 延遲啟動的 timeout 無法取消
5. **MemoryQueue 的佇列上限保護不足** — 溢出後無持久化機制
6. **ViewerService getFollowedChannels 查詢可能大量** — 500+ 頻道無分頁
7. **批次聚合的 Map 記憶體使用** — 批次大小增加會線性增長

---

## 三、資料庫寫入量

### 每分鐘寫入量估算

| Job | 頻率 | 每次寫入量 | 每小時寫入 |
|-----|------|-----------|-----------|
| update-live-status | 1 min | 250-600 | 15,000-36,000 |
| watch-time-increment | 6 min | 50-200 | 500-2,000 |
| aggregate-daily-messages | 1 hr | 500-2,000 | 500-2,000 |
| channel-stats-sync | 1 hr | 100-500 | 100-500 |
| 即時訊息寫入 | 即時 | 50/5s | 36,000 |
| **合計** | | | **~52,000-76,500** |

### 🔴 嚴重問題

#### 1. 每分鐘輪詢任務 (update-live-status.job.ts)
**問題描述**:
- **頻率**: 每分鐘執行一次
- **寫入量**: 每次最多 300+ 頻道更新
- **批次大小**: 10-15 筆/transaction
- **預估寫入**: 每分鐘 250-600 次 UPDATE

**衝擊**:
- SQLite 在高頻 UPDATE 下性能急劇下降
- WAL 文件可能快速增長至數 GB
- 每分鐘 20-40 個 transaction，易引發鎖競爭
- 記憶體壓力：300+ 個 update promises 同時存在

**修復建議**:
1. **增加輪詢間隔至 2-3 分鐘** (降低 50-67% 寫入)
2. **只更新真正變化的欄位** (避免冗餘寫入)
3. **使用原生 SQL 批次 upsert** (減少 transaction 數量)
4. **引入 Diff 比較**，避免相同數值重複寫入

**預期效果**: 每分鐘寫入從 250-600 降至 80-200 (**67-70% 降低**)

---

#### 2. 觀看時間累積 (watch-time-increment.job.ts)
**問題描述**:
- **頻率**: 每 6 分鐘執行一次
- **寫入方式**: SQL upsert (ON CONFLICT DO UPDATE)
- **預估寫入**: 每次 50-200 筆

**修復建議**:
1. **延長間隔至 10-15 分鐘** (減少 40-60% 寫入)
2. **在記憶體中累積觀看時間**，降低寫入頻率
3. **錯開與 update-live-status 的執行時間** (避免鎖競爭)

---

#### 3. update-lifetime-stats.job.ts
**問題描述**:
- **頻率**: 每日凌晨 2 點 (全量更新)
- **並行度**: CONCURRENCY_LIMIT = 10 (可能過高)
- **寫入量**: 每次數千至上萬筆

**修復建議**:
1. **降低並行度至 3-5** (減少鎖競爭)
2. **增加批次間延遲至 500ms** (讓 WAL checkpoint 有時間執行)
3. **使用原生 SQL 批次 upsert** (減少 Prisma overhead)

---

### 🟡 警告問題

#### 1. 即時訊息寫入 (ViewerMessageRepository)
- **批次大小**: 50 筆 / 5 秒
- **高峰寫入**: 熱門頻道可能每秒 200+ 訊息
- **批次上限**: 1000 筆 (可能溢出)

**修復建議**:
1. **增加 MESSAGE_BATCH_SIZE 至 100** (減少寫入次數)
2. **引入訊息優先級** (訂閱/Cheer > 普通聊天)
3. **溢出時寫入暫存檔案** (避免資料遺失)

---

#### 2. 每小時訊息聚合 (aggregate-daily-messages.job.ts)
- **頻率**: 每小時第 5 分鐘執行
- **預估寫入**: 每次 500-2000 筆

**修復建議**:
1. **使用增量時間戳** (避免重複聚合同一時段)
2. **分批處理大型聚合** (每次最多處理 1000 個觀眾)

---

#### 3. channel-stats-sync.job.ts
**問題**: 逐筆 upsert，未使用批次處理

**修復建議**:
```typescript
const upsertOps = Array.from(channelStats).map(([channelId, stats]) =>
  prisma.channelDailyStat.upsert({
    where: { channelId_date: { channelId, date: today } },
    create: { ... },
    update: { ... },
  })
);

const BATCH_SIZE = 50;
for (let i = 0; i < upsertOps.length; i += BATCH_SIZE) {
  const batch = upsertOps.slice(i, i + BATCH_SIZE);
  await prisma.$transaction(batch);
  await new Promise(r => setTimeout(r, 200));
}
```

---

#### 4. 寫入鎖競爭風險

**時間衝突分析**:
```
每分鐘第 0 秒: update-live-status (250-600 次寫入)
每 5 分鐘第 0 秒: stream-status (50-100 次寫入)
每 6 分鐘第 4 分: watch-time-increment (50-200 次寫入)
每小時第 5 分: aggregate-daily-messages (500-2000 次寫入)
每小時第 10 分: channel-stats-sync (100-500 次寫入)
```

**修復建議**: 錯開所有 Job 的執行時間
```typescript
// 建議排程
update-live-status: "0 */2 * * * *"  // 每 2 分鐘 (0, 2, 4...)
stream-status: "30 */5 * * * *"      // 每 5 分鐘第 30 秒
watch-time-increment: "15 1-59/6 * * * *" // 每 6 分鐘第 15 秒
aggregate-daily-messages: "15 * * * *"    // 每小時第 15 分
channel-stats-sync: "35 * * * *"          // 每小時第 35 分
sync-user-follows: "50 * * * *"           // 每小時第 50 分
```

---

### 資料膨脹風險

#### viewer_channel_messages 無自動清理
**預估增長**:
- 每個活躍觀眾每小時 10 則訊息
- 1000 個活躍觀眾 = 每小時 10,000 筆
- 每月約 720 萬筆記錄

**修復建議**:
```typescript
// 新增訊息清理邏輯 (保留 90 天)
const ninetyDaysAgo = new Date();
ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

const deletedMessages = await prisma.viewerChannelMessage.deleteMany({
  where: { timestamp: { lt: ninetyDaysAgo } },
});

logger.info(
  "DataRetention",
  `清理了 ${deletedMessages.count} 則過期訊息 (>90天)`
);
```

---

## 四、前端效能

### 🔴 嚴重問題

#### 1. Recharts 首屏載入過大（✅ 已修復）
**位置**: `frontend/src/features/streamer-dashboard/charts/TimeSeriesChart.tsx:3`

**問題**:
- Recharts 是重量級圖表庫（~500KB），若同步載入會放大首屏成本
- 原本 streamer dashboard 圖表同步載入，會墊高初次 JS 負載

**現況**: 已改為動態引入（`next/dynamic` + `ssr: false`），此項已落地。

**實作結果**:
```typescript
// 已採用動態引入，僅在需要時載入
const TimeSeriesChart = dynamic(
  () => import('@/features/streamer-dashboard/charts/TimeSeriesChart'),
  {
    ssr: false,
    loading: () => <ChartLoading />
  }
);
```

**預期效果**: 首次載入減少 500KB，載入時間減少 40-50%

---

#### 2. Viewer Dashboard 頻繁輪詢造成資源浪費
**位置**: `frontend/src/hooks/useViewer.ts:54`

**問題**:
```typescript
export function useChannels() {
  return useQuery<FollowedChannel[], Error>({
    queryKey: ["viewer", "channels"],
    queryFn: () => viewerApi.getFollowedChannels(),
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000, // ⚠️ 每 60 秒輪詢一次
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
  });
}
```

- 每個開啟 viewer dashboard 的使用者每分鐘都會打一次 API
- 如果有 100 個同時在線使用者 = 100 req/min
- 已經有 WebSocket 推送開台/關台事件，不需要輪詢

**修復建議**:
```typescript
refetchInterval: false, // 改為 false，完全依賴 WebSocket 更新
```

**預期效果**: 消除 100 req/min 浪費

---

#### 3. Viewer Dashboard 頻道列表大量 re-render
**位置**: `frontend/src/app/[locale]/dashboard/viewer/page.tsx:238-269`

**問題**:
```typescript
useEffect(() => {
  let filtered: FollowedChannel[] = [];

  if (searchQuery.trim()) {
    const lowerQuery = searchQuery.toLowerCase();
    filtered = channels.filter(
      (ch) =>
        ch.channelName.toLowerCase().includes(lowerQuery) ||
        ch.displayName.toLowerCase().includes(lowerQuery)
    );
  } else {
    filtered = [...channels];
  }

  // 排序：開台優先 + 觀看時數
  filtered.sort((a, b) => {
    if (a.isLive && !b.isLive) return -1;
    if (!a.isLive && b.isLive) return 1;
    return b.totalWatchMinutes - a.totalWatchMinutes;
  });

  setFilteredChannels(filtered);
}, [searchQuery, channels]);
```

- **每次 `channels` 更新都會重新 filter + sort**
- WebSocket 每次更新觀眾數時，都會觸發 `queryClient.setQueryData`
- 這會導致整個列表重新計算（即使只有 1 個頻道觀眾數變化）
- **沒有使用 `useMemo` 緩存計算結果**

**效能影響**:
- 假設有 50 個追蹤頻道
- 每次 WebSocket 更新 = filter (O(n)) + sort (O(n log n)) = ~300 次操作
- 如果 10 個頻道同時直播 = 每分鐘 10 次重新計算

**修復建議**:
```typescript
const filteredChannels = useMemo(() => {
  let filtered = searchQuery.trim()
    ? channels.filter(ch =>
        ch.channelName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        ch.displayName.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : [...channels];

  return filtered.sort((a, b) => {
    if (a.isLive && !b.isLive) return -1;
    if (!a.isLive && b.isLive) return 1;
    return b.totalWatchMinutes - a.totalWatchMinutes;
  });
}, [channels, searchQuery]);
```

**預期效果**: 渲染效能提升 3-5 倍

---

#### 4. Dashboard Bootstrap 仍造成 Waterfall
**位置**: `frontend/src/app/[locale]/dashboard/streamer/page.tsx:153-201`

**問題**:
```typescript
useEffect(() => {
  if (!user) return;

  const fetchBootstrap = async () => {
    const response = await fetch(
      `/api/streamer/dashboard?range=${chartRange}&granularity=${granularity}&subsRange=${subsChartRange}`
    );
    const data = await response.json();

    // 依序 mutate 4 個快取
    mutate(`/api/streamer/time-series/${chartRange}/${granularity}`, data.timeSeries.data, false);
    mutate(`/api/streamer/heatmap/${chartRange}`, data.heatmap, false);
    mutate(`/api/streamer/subscription-trend/${subsChartRange}`, data.subscriptionTrend, false);
  };

  fetchBootstrap();
}, [user, chartRange, granularity, subsChartRange, mutate]);
```

- `chartRange`, `granularity`, `subsChartRange` 變更時都會重新 fetch bootstrap
- 這會導致使用者切換時間範圍時，**重複載入所有資料**
- 沒有利用 SWR 的自動去重機制

**影響**: 每次切換範圍 = 4 個 API 呼叫（應該只需要 1 個）

**修復建議**:
```typescript
// 應該讓各個圖表自己管理資料請求
const timeSeries = useTimeSeriesData(chartRange, granularity, canFetch);
// useTimeSeriesData 內部已經有 SWR 快取，不需要 bootstrap
```

---

#### 5. 大量 Client Component 濫用
**位置**: 整個專案有 **47 個檔案標記為 "use client"**

**問題清單**:
```
✅ 必須是 Client:
  - AuthContext, SocketProvider, ThemeProvider (需要 hooks/context)
  - Dashboard pages (需要互動)

❌ 不需要 Client:
  - VirtualList.tsx (可以是 Server Component + Client wrapper)
  - Skeleton.tsx (純 UI，不需要互動)
  - SafeResponsiveContainer (可以延遲載入)
```

**影響**:
- 所有標記為 "use client" 的元件都會被打包到 client bundle
- 增加首次載入時間
- 無法利用 Server Components 的優勢（零 JavaScript）

**修復建議**:
```typescript
// components/ui/Skeleton.tsx
// 移除 "use client"，改為純 Server Component
export function Skeleton({ className }: Props) {
  return <div className={cn("animate-pulse bg-gray-200", className)} />;
}
```

---

### 🟡 警告問題

1. **動態引入使用仍可擴大** — `react-grid-layout` 尚未 lazy load
2. **大型依賴仍可進一步分割** — Recharts 已部分動態載入，仍可細拆 chunk
3. **API Route Handler 缺少快取控制** — 應設定 `Cache-Control` headers
4. **WebSocket 更新策略效能問題** — 每次建立全新陣列
5. **頻道卡片沒有 React.memo 優化**
6. **FootprintDashboard 多個 useState 造成多次 re-render**
7. **圖表元件仍可做細部性能配置**
8. **WebSocket 事件監聽器依賴可再精簡**
9. **sessionStorage 快取寫入節流策略可再收斂**
10. **圖片優化尚未全覆蓋** — 仍有局部 `unoptimized`
11. **字體載入策略可優化** — Noto Sans TC 可進一步做 subset

---

## 五、優先修復路線圖（最新版）

### P0 — 立即修復（1-3 天）

| 狀態 | 問題 | 位置 | 備註 |
|---|---|---|---|
| ⏳ 待處理 | BFF Endpoint 加整體 timeout/cancel | `backend/src/modules/viewer/viewer.controller.ts` | 目前仍為 `Promise.allSettled` 聚合 |
| ⏳ 待處理 | 移除 Viewer 60s 輪詢 | `frontend/src/hooks/useViewer.ts` | 與 WebSocket 重疊，可進一步降載 |
| ⏳ 待處理 | 頻道列表 filter/sort `useMemo` | `frontend/src/app/[locale]/dashboard/viewer/page.tsx` | 降低 WebSocket 驅動重算 |
| 🔄 進行中 | Job 時間錯峰與寫入平滑 | `backend/src/jobs/*.ts` | 已做部分降載，仍可再優化排程 |
| ✅ 已完成 | live-status 寫入壓力優化 | `backend/src/jobs/update-live-status.job.ts` | 已做差異更新與檢查時間更新節流 |

### P1 — 短期修復（1-2 週）

| 狀態 | 問題 | 位置 | 備註 |
|---|---|---|---|
| ✅ 已完成 | Recharts dynamic import | `frontend/src/app/[locale]/dashboard/streamer/page.tsx` | 圖表改為動態載入 |
| ⏳ 待處理 | channel-stats-sync 批次並行 | `backend/src/jobs/channel-stats-sync.job.ts` | 批次內目前仍循序 |
| ⏳ 待處理 | DataExportService 串流寫入 | `backend/src/services/data-export.service.ts` | 仍有記憶體尖峰風險 |
| ⏳ 待處理 | 快取大小估算策略收斂 | `backend/src/utils/cache-manager.ts` | 建議補強估算與上限治理 |
| ✅ 已完成 | 訊息寫入聚合批次化 | `backend/src/modules/viewer/viewer-message.repository.ts` | 已改 set-based upsert |
| ✅ 已完成 | watcher time 查詢與寫入優化 | `backend/src/jobs/watch-time-increment.job.ts` | 已改單次 SQL 聚合+upsert |
| ⏳ 待處理 | Revenue 訂閱同步 timeout | `backend/src/modules/streamer/revenue.service.ts` | 仍建議補整體保護 |

### P2 — 中期優化（2-4 週）

| 狀態 | 問題 | 位置 | 備註 |
|---|---|---|---|
| ⏳ 待處理 | ChannelCard `React.memo` | `frontend/src/app/[locale]/dashboard/viewer/page.tsx` | 減少列表重繪 |
| ⏳ 待處理 | `use client` 標記審查 | `frontend/src` | 持續收斂 bundle |
| ⏳ 待處理 | 訊息資料保留策略 | `backend/src/jobs` | 補資料清理 job |
| ⏳ 待處理 | Revenue API 預熱 + SWR | `backend/src/modules/streamer/revenue.service.ts` | 降首請求延遲 |
| ⏳ 待處理 | Prisma 連線治理策略 | `backend/src/db/prisma.ts` | 強化高峰穩定性 |
| ⏳ 待處理 | `getMessageStatsInternal` 重構 | `backend/src/modules/viewer/viewer.controller.ts` | 改 service 化避免 mock req/res |

---

## 六、效能提升追蹤（最新版）

> 原文件的「xx% 提升」多為估算值，建議以 `backend/scripts/perf-compare.ts` 的 before/after 實測為準。

| 指標 | 目前狀態 | 證據來源 |
|---|---|---|
| BFF API 回應尾延遲 | 仍待改善 | 缺少整體 timeout/cancel |
| 前端首屏載入 | 已部分改善 | Streamer dashboard 圖表 dynamic import 已上線 |
| 每分鐘 DB 寫入 | 已下降但未歸零 | Job 寫入差異化與採樣已上線 |
| 記憶體風險 | 可控但仍需監控 | 高峰 job 與匯出場景仍需觀察 |
| 可量測性 | 已補齊基礎能力 | 新增 `perf:capture` / `perf:compare` 腳本 |

---

## 七、架構建議

### 短期 (P0-P1 完成後)
- 引入 Redis (Zeabur 提供 100MB 免費額度) 分擔記憶體快取
- 改善快取策略 (stale-while-revalidate)
- 實作記憶體壓力降級模式

### 中期 (P2 完成後)
- 分離 Job Worker (獨立 Zeabur 實例)
- 引入 Message Queue (BullMQ + Redis)
- 實作分散式鎖機制

### 長期 (6-12 個月)
- 考慮遷移至 PostgreSQL (Turso 對複雜查詢效能不佳)
- 引入 Read Replica 分離讀寫
- 實作資料分區策略（按時間分區聚合表）
- 考慮使用 CDN 快取靜態資源

---

## 八、監控指標建議

### 新增監控指標

**後端**:
- WAL 文件大小（警告 > 100MB）
- 每分鐘寫入次數（警告 > 500）
- 鎖等待時間（嚴重 > 1s）
- 各表記錄數（viewer_channel_messages 警告 > 1000 萬）
- 記憶體使用百分比（警告 > 70%，嚴重 > 85%）

**前端**:
- Lighthouse Performance Score（目標 > 90）
- First Contentful Paint（目標 < 1.5s）
- Time to Interactive（目標 < 3s）
- Total Blocking Time（目標 < 200ms）
- Cumulative Layout Shift（目標 < 0.1）

---

## 九、總結

### 整體評價

專案已經過相當程度的優化（使用批次處理、適應性輪詢、記憶體管理、快取策略），但在**效能瓶頸**、**記憶體尖峰**和**資料庫寫入頻率**方面仍有顯著改善空間。

### 關鍵發現

1. **目前主要瓶頸**: BFF 聚合端點缺少整體 timeout/cancel，慢查詢時尾延遲高。
2. **目前主要風險**: 高頻 Job 仍存在寫入競爭與尖峰壓力（雖已較先前下降）。
3. **目前主要浪費**: Viewer Dashboard 60 秒輪詢與 WebSocket 並存，可再降載。
4. **已完成優化**: Recharts 動態載入已上線，首屏 bundle 壓力已下降。

### 風險評估

- **若不持續改善**: 頻道數增長後仍可能在尖峰時段出現尾延遲與寫入競爭。
- **目前狀態**: 已完成一輪高影響優化，風險由「高」下降至「中」。
- **後續完成 P0/P1 待辦後**: 預期可進一步把風險降至「中低」。

### 建議執行順序（校正版）

1. **本週**: 完成 P0 待處理 3 項（BFF timeout、viewer 輪詢、viewer 列表 memo）。
2. **下週**: 完成 P1 待處理項（channel-stats-sync 並行、DataExport 串流、Revenue timeout）。
3. **雙週迭代**: 依 `perf-compare` 實測結果滾動調整 P2 項目。
4. **持續**: 以實測數據更新本報告，不再使用未驗證百分比作結論。

---

**報告完成日期**: 2026-02-06
**審查工時**: 約 6 小時（四個代理平行審查）
**下一步**: 先執行一輪 before/after 實測，然後依最新路線圖收斂剩餘 P0/P1 項目

---

## 附錄

### 相關文檔

- [演算法複雜度分析](algorithm-analysis.md)
- [資料庫優化方案](db-optimization.md)
- [專案記憶體](MEMORY.md)

### 審查代理

- **後端效能審查**: 資料庫查詢、API 回應、排程任務、系統載入
- **記憶體使用審查**: 快取策略、記憶體洩漏、記憶體尖峰、監控機制
- **資料庫寫入審查**: 寫入頻率、批次效率、SQLite 特定問題、資料膨脹
- **前端效能審查**: 載入時間、API 呼叫、渲染效能、Next.js 最佳實踐
