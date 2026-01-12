# Story 6.6 - 真實每小時觀眾數據採集規劃

## 1. 目標

為了在觀眾與實況主儀表板中顯示真實的「每小時觀眾人數變化曲線」，而非目前的模擬演算法，我們需要建立機制來定期記錄直播過程中的各項指標。

## 2. 資料庫設計 (Database Schema)

新增 `StreamMetric` 模型，用於儲存時間序列數據 (Time Series Data)。

```prisma
// schema.prisma

model StreamSession {
  // ... existing fields
  metrics StreamMetric[] // 新增關聯
}

// 新增模型
model StreamMetric {
  id              String        @id @default(uuid())
  streamSessionId String
  timestamp       DateTime      @default(now())

  // 核心指標
  viewerCount     Int           @default(0) // 當下觀眾數

  // 選填指標 (未來可擴充)
  chatCount       Int?          @default(0) // 當下累積留言數 (或區間增量)
  followerCount   Int?          // 當下總追蹤數

  streamSession   StreamSession @relation(fields: [streamSessionId], references: [id], onDelete: Cascade)

  @@index([streamSessionId, timestamp])
  @@map("stream_metrics")
}
```

## 3. 後端實作邏輯 (Backend Implementation)

### 3.1 數據採集 (Data Collection)

利用現有的 `StreamStatusJob` (負責檢查直播狀態) 來進行數據寫入。

- **Job 位置**: `backend/src/jobs/stream-status.job.ts`
- **執行頻率**: 維持現有頻率 (假設每 5 分鐘或更短)。
- **邏輯變更**:
  1.  當檢測到直播 `isLive` 且關聯到 `activeSession` 時。
  2.  除了更新 `StreamSession` 的 `avgViewers/peakViewers` 外。
  3.  新增一筆 `StreamMetric`：
      ```typescript
      await prisma.streamMetric.create({
        data: {
          streamSessionId: session.id,
          viewerCount: streamData.viewerCount,
          timestamp: new Date(),
        },
      });
      ```

### 3.2 API 查詢 (Data Retrieval)

更新 `getPublicStreamHourlyHandler` (`backend/src/modules/streamer/streamer-stats.controller.ts`)。

- **邏輯**:
  1.  嘗試查詢該 Session 的 `StreamMetric`。
  2.  **如果有數據**:
      - 使用 SQL Group By 或程式邏輯將數據按小時 (Hourly) 或 分鐘 (Granular) 聚合。
      - 回傳真實數據點。
  3.  **如果無數據** (舊直播):
      - 維持目前的「鐘型曲線模擬算法」作為 fallback，確保舊資料仍有圖表可看。

## 4. 前端顯示 (Frontend)

- **組件**: `StreamHourlyDialog.tsx`
- **變更**:
  - 無需大幅修改，因介面已定義為 `timestamp` + `viewers`。
  - 真實數據可能會有波動 (noise)，圖表會反映真實的直播狀況 (如中途斷線、突發高峰等)。

## 5. 執行步驟

1.  **Schema Migration**: 加入 Model 並執行 `prisma db push`。
2.  **Job Update**: 修改 `stream-status.job.ts` 加入寫入邏輯。
3.  **Controller Update**: 修改 API 讀取邏輯。
4.  **Verification**: 啟動直播測試，觀察資料庫是否有數據寫入。
