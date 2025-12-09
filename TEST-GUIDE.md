# 功能測試指南

## 目前已實作功能

### ✅ Story 1.1 - Twitch OAuth 登入
### ✅ Story 1.2 - 開台統計 API
### ✅ Story 1.3 - 時間與頻率圖表

## 📊 測試統計 (2025-12-09)

- **總測試數**: 62 tests
- **測試通過率**: 100% (1 skipped)
- **覆蓋率**: 74.17% (整體)
  - useChartData hooks: 100%
  - Logger 工具: 100%
  - ChartStates 組件: 100%
  - Chart 組件: 73.21%
  - API 層: 21.87% (待改進)

## 🧪 測試策略

### 單元測試
- **Hooks**: useChartData 使用 SWR mock 測試資料獲取
- **Utils**: Logger 測試各種日誌等級和環境行為
- **Components**: ChartStates 測試 UI 狀態和互動

### 整合測試
- **API**: 使用 Supertest 測試端點
- **Auth**: 完整認證流程測試
- **Dashboard**: 圖表資料流測試

---

## 📋 測試前準備

### 環境配置（可選）

如需自訂測試環境配置，可以建立 `.env.test` 檔案：

```bash
cd backend
cp .env.test.example .env.test
# 編輯 .env.test 以自訂配置
```

預設配置已經可以正常使用，無需額外設定。

---

## 🚀 快速測試步驟

### 1. 啟動服務

**後端 (Port 4000):**
```bash
cd backend
npm run dev
```

**前端 (Port 3000):**
```bash
cd frontend
npm run dev
```

### 2. 測試方式

#### 方式 A：透過瀏覽器測試完整流程

1. **訪問首頁**
   - 開啟瀏覽器：http://localhost:3000
   - 應該看到 Landing Page

2. **測試登入流程**
   - 點擊「Login with Twitch」按鈕
   - 會導向到：http://localhost:4000/auth/twitch/login
   - 如果有設定 Twitch OAuth，會跳轉到 Twitch 授權頁面
   - 授權後會回到：http://localhost:3000/dashboard/streamer

3. **查看 Dashboard**
   - 登入後應該會顯示實況主的資訊
   - 目前可能還沒有完整的 UI，需要查看瀏覽器 Console

---

#### 方式 B：直接測試 API（使用測試腳本）✨ 推薦

**自動化測試腳本** - 包含完整的測試覆蓋率、Schema 驗證和效能監測

```bash
cd backend
npx ts-node test-api-call.ts
```

**此腳本會自動：**
- 🔑 動態生成有效的 JWT Token（無需手動複製）
- ✅ 測試所有時間範圍 (7d, 30d, 90d)
- ✅ 驗證 Response Schema 正確性
- ✅ 測試錯誤處理（無效參數、未認證）
- ⏱️ 監測 API 效能（超過 1000ms 會警告）
- 📊 生成詳細的測試報告

**預期輸出範例：**
```
=== Testing API Endpoints ===

API Base URL: http://localhost:4000

🔑 Generating test JWT token...
✅ Token generated successfully

✅ GET /api/streamer/me/summary?range=7d
{
  "range": "7d",
  "totalStreamHours": 25.5,
  "totalStreamSessions": 6,
  "avgStreamDurationMinutes": 255,
  "isEstimated": false
}

✅ GET /api/streamer/me/summary?range=30d
{
  "range": "30d",
  "totalStreamHours": 65,
  "totalStreamSessions": 18,
  "avgStreamDurationMinutes": 217,
  "isEstimated": false
}

✅ GET /api/streamer/me/summary?range=90d
{
  "range": "90d",
  "totalStreamHours": 108,
  "totalStreamSessions": 30,
  "avgStreamDurationMinutes": 216,
  "isEstimated": false
}

✅ Invalid range test (correctly rejected):
{
  "error": "Invalid range parameter. Use 7d, 30d, or 90d."
}

✅ No auth test (correctly rejected):
{
  "error": "Unauthorized: No token provided"
}

=== Test Summary ===

✅ GET /api/streamer/me/summary?range=7d (245ms)
✅ GET /api/streamer/me/summary?range=30d (156ms)
✅ GET /api/streamer/me/summary?range=90d (168ms)
✅ Invalid range parameter test (89ms)
✅ No authentication test (12ms)

Total: 5 | Passed: 5 | Failed: 0

✅ All tests passed!
```

**手動生成 Token（可選）：**
如果您需要手動測試或使用 curl/Postman：
```bash
cd backend
npx ts-node test-api.ts
```

這會輸出：
- 測試實況主資訊
- JWT Token
- curl 測試指令

---

#### 方式 C：手動 API 測試

**1. 取得 Token**
```bash
cd backend
npx ts-node test-api.ts
```
複製輸出的 JWT token。

**2. 使用 curl 或 Postman 測試**

```bash
# 使用 curl
curl -X GET "http://localhost:4000/api/streamer/me/summary?range=30d" \
  -H "Cookie: auth_token=YOUR_TOKEN_HERE"

# 或使用 Postman
GET http://localhost:4000/api/streamer/me/summary?range=30d
Headers:
  Cookie: auth_token=YOUR_TOKEN_HERE
```

**3. 測試其他 endpoints**

```bash
# 7天統計
GET http://localhost:4000/api/streamer/me/summary?range=7d

# 90天統計
GET http://localhost:4000/api/streamer/me/summary?range=90d

# 測試錯誤處理
GET http://localhost:4000/api/streamer/me/summary?range=invalid
```

---

## 📊 測試資料庫

### 查看資料庫內容

```bash
cd backend
npm run db:studio
```

開啟 Prisma Studio：http://localhost:5555

可以查看：
- Streamer（實況主）
- Channel（頻道）
- StreamSession（開台紀錄）- 54 筆
- ChannelDailyStat（每日統計）- 45 筆

### 重新生成測試資料

```bash
cd backend
npm run db:seed
```

---

## 🔍 驗證清單

### Backend API
- [ ] 後端伺服器啟動成功 (Port 4000)
- [ ] GET /api/streamer/me/summary?range=7d 回傳正確數據
- [ ] GET /api/streamer/me/summary?range=30d 回傳正確數據
- [ ] GET /api/streamer/me/summary?range=90d 回傳正確數據
- [ ] 無 token 時回傳 401 Unauthorized
- [ ] 無效 range 參數時回傳 400 錯誤

### Frontend
- [ ] 前端伺服器啟動成功 (Port 3000)
- [ ] Landing page 顯示正常
- [ ] Login 按鈕可以導向到 Twitch OAuth

### 資料庫
- [ ] Prisma Studio 可以開啟
- [ ] 資料庫中有測試資料
- [ ] Streamer、Channel、StreamSession 資料完整

---

## 🐛 常見問題

### 1. Port 被占用
```bash
# Windows
taskkill //F //IM node.exe

# 檢查 port
netstat -ano | findstr ":3000"
netstat -ano | findstr ":4000"
```

### 2. 資料庫錯誤
```bash
# 重新 push schema
cd backend
npm run db:push

# 重新 seed
npm run db:seed
```

### 3. JWT Token 過期
重新執行 `npx ts-node test-api.ts` 生成新的 token。

---

## 📝 API 文件

### GET /api/streamer/me/summary

**描述：** 取得實況主在指定期間的開台統計總覽

**認證：** 需要 JWT Token (Cookie: auth_token)

**Query Parameters:**
- `range` (optional): 時間範圍，可選值：`7d`, `30d`, `90d`，預設 `30d`

**Response:**
```json
{
  "range": "30d",
  "totalStreamHours": 65,
  "totalStreamSessions": 18,
  "avgStreamDurationMinutes": 217,
  "isEstimated": false
}
```

**欄位說明：**
- `range`: 查詢的時間範圍
- `totalStreamHours`: 總開台時數（小時，小數點後一位）
- `totalStreamSessions`: 總開台場數
- `avgStreamDurationMinutes`: 平均單場時長（分鐘）
- `isEstimated`: 是否為估算值

**錯誤回應：**
```json
// 401 Unauthorized
{
  "error": "Unauthorized: No token provided"
}

// 400 Bad Request
{
  "error": "Invalid range parameter. Use 7d, 30d, or 90d."
}
```

---

## 🎯 下一步開發

1. **Story 1.3** - 開台時間與頻率圖表 API
2. **Story 1.4** - 訂閱數變化趨勢 API
3. **Frontend Dashboard** - 實作 UI 顯示統計數據
4. **測試** - 撰寫單元測試和整合測試
