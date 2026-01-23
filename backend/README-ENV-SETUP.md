# 環境變數設定說明

## 問題

如果看到 "missing client id" 錯誤，表示缺少 Twitch OAuth 憑證。

## 解決步驟

### 1. 建立 `.env` 檔案

在 `backend/` 目錄下建立 `.env` 檔案（複製以下內容並填入你的 Twitch 憑證）：

```env
# Twitch OAuth 設定
# 請到 https://dev.twitch.tv/console/apps 建立應用程式並取得以下資訊
TWITCH_CLIENT_ID=your_twitch_client_id_here
TWITCH_CLIENT_SECRET=your_twitch_client_secret_here
TWITCH_REDIRECT_URI=http://localhost:3000/auth/callback

# JWT 簽章密鑰（生產環境請使用強隨機字串）
APP_JWT_SECRET=dev-secret-change-in-production

# 前端 URL
FRONTEND_URL=http://localhost:3000

# 後端服務端口
PORT=4000

# 環境
NODE_ENV=development
```

### 2. 取得 Twitch OAuth 憑證

1. 前往 [Twitch Developer Console](https://dev.twitch.tv/console/apps)
2. 登入你的 Twitch 帳號
3. 點擊 "Register Your Application"
4. 填寫應用程式資訊：
   - **Name**: 你的應用程式名稱（例如：Twitch Analytics Dashboard）
   - **OAuth Redirect URLs**: `http://localhost:3000/auth/callback`
   - **Category**: 選擇 "Website Integration" 或 "Desktop Application"
5. 建立後，你會看到：
   - **Client ID**: 複製到 `.env` 的 `TWITCH_CLIENT_ID`
   - **Client Secret**: 點擊 "New Secret" 生成，複製到 `.env` 的 `TWITCH_CLIENT_SECRET`

### 3. 重新啟動後端

設定完成後，重新啟動後端開發伺服器：

```bash
cd backend
npm run dev
```

### 4. 驗證設定

重新啟動後，檢查終端輸出：

- 不應該看到 "[backend/env] TWITCH_CLIENT_ID 或 TWITCH_CLIENT_SECRET 尚未設定" 的警告
- 如果仍有警告，請確認 `.env` 檔案路徑正確且格式正確

## 注意事項

- **不要**將 `.env` 檔案 commit 到版本控制系統
- `.env` 檔案應在 `.gitignore` 中
- 生產環境請使用環境變數管理服務（如 AWS Secrets Manager、Azure Key Vault 等）
