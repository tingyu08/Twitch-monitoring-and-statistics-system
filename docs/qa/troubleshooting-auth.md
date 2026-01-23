# 診斷與修復「無法載入使用者資訊」問題

## 問題根源

跨域 Cookie 與瀏覽器同源策略（Same-Origin Policy）導致後端設定的 Cookie 在前端請求時無法正確傳遞。

## 解決方案：反向代理

我們實作了 Next.js Rewrites 反向代理，將前端的 API 請求代理到後端，解決了以下問題：

1. **跨域 Cookie**：前端請求同源的 `/api/*`，瀏覽器自動帶上 Cookie
2. **CORS**：瀏覽器認為是同源請求，不再需要處理複雜的 CORS 預檢請求

## 快速檢查步驟

### 1. 確認服務正在運行

```bash
# 終端 1
cd backend && npm run dev

# 終端 2
cd frontend && npm run dev
```

### 2. 檢查 Next.js Rewrites 設定

確認 `frontend/next.config.mjs` 包含：

```javascript
rewrites() {
  return [
    { source: "/api/:path*", destination: "http://localhost:4000/api/:path*" },
    { source: "/auth/:path*", destination: "http://localhost:4000/auth/:path*" },
  ];
}
```

### 3. 檢查 API Client 設定

確認 `frontend/src/lib/api/httpClient.ts` 中 `API_BASE_URL` 為空字串（使用相對路徑）：

```typescript
const API_BASE_URL = "";
```

### 4. 測試登入流程

1. 訪問 `http://localhost:3000`
2. 點擊「使用 Twitch 登入」
3. 完成授權後應自動導向 Dashboard
4. 檢查 Network 請求：
   - 請求 URL 應為 `http://localhost:3000/api/auth/me`（不是 4000）
   - Request Headers 應包含 `Cookie: auth_token=...`
   - Response 應為 200 OK

## 常見問題排除

### 仍顯示 401 Unauthorized

- 清除瀏覽器 Cookie 與 Local Storage
- 確認後端 `APP_JWT_SECRET` 與簽發 token 時一致
- 確認 `auth_token` Cookie 的 `Path` 為 `/`

### 請求被導向到 4000 埠

- 確認 `httpClient.ts` 修改已生效（可能需要重啟前端服務）
- 確認瀏覽器沒有快取舊的 JS 檔案

### Cookie 沒有設定

- 檢查後端 `auth.controller.ts` 中的 `redirectUrl` 邏輯
- 開發環境應透過 URL 參數傳遞 token，由前端 callback route 設定 Cookie
- 生產環境由後端直接設定 Secure Cookie
