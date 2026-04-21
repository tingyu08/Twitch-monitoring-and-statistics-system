# 環境變數設定說明

## 必要環境變數

在 `backend/` 目錄下建立 `.env` 檔案，填入以下設定：

```env
# ─── Twitch OAuth ────────────────────────────────────────────
# 請到 https://dev.twitch.tv/console/apps 建立應用程式
TWITCH_CLIENT_ID=your_twitch_client_id_here
TWITCH_CLIENT_SECRET=your_twitch_client_secret_here
TWITCH_REDIRECT_URI=http://localhost:3000/auth/callback

# ─── Supabase 資料庫 ─────────────────────────────────────────
# 請到 https://supabase.com/dashboard 建立專案後取得連線字串
# Transaction Mode（一般查詢，走 PgBouncer port 6543）
DATABASE_URL=postgresql://postgres.xxxx:password@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true

# Session Mode（Prisma migrate 專用，走直連 port 5432）
DIRECT_DATABASE_URL=postgresql://postgres.xxxx:password@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres

# ─── JWT ─────────────────────────────────────────────────────
# 生產環境請使用強隨機字串（建議 64 字元以上）
APP_JWT_SECRET=dev-secret-change-in-production

# ─── 服務設定 ─────────────────────────────────────────────────
FRONTEND_URL=http://localhost:3000
PORT=4000
NODE_ENV=development
```

---

## 一、取得 Twitch OAuth 憑證

1. 前往 [Twitch Developer Console](https://dev.twitch.tv/console/apps)
2. 登入 Twitch 帳號，點擊 **Register Your Application**
3. 填寫應用程式資訊：
   - **Name**：你的應用程式名稱
   - **OAuth Redirect URLs**：`http://localhost:3000/auth/callback`
   - **Category**：Website Integration
4. 建立後取得：
   - **Client ID** → 填入 `TWITCH_CLIENT_ID`
   - **Client Secret**（點 New Secret 產生）→ 填入 `TWITCH_CLIENT_SECRET`

---

## 二、設定 Supabase 資料庫

本專案使用 **Supabase（PostgreSQL）** 作為資料庫，透過 Prisma ORM 存取。

### 建立 Supabase 專案

1. 前往 [Supabase Dashboard](https://supabase.com/dashboard)
2. 點擊 **New Project**，選擇組織與區域（建議選亞太區：`ap-northeast-1`）
3. 設定資料庫密碼（請記住，後續連線字串會用到）

### 取得連線字串

進入專案後，前往 **Project Settings → Database → Connection string**：

| 用途 | 模式 | Port | 對應環境變數 |
|---|---|---|---|
| 一般查詢 / 應用程式執行 | Transaction Mode | `6543` | `DATABASE_URL` |
| Prisma migrate / schema push | Session Mode | `5432` | `DIRECT_DATABASE_URL` |

連線字串格式：
```
postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:[port]/postgres
```

> **Transaction Mode** 需在 `DATABASE_URL` 結尾加上 `?pgbouncer=true`

### 執行資料庫 Migration

```bash
cd backend
npx prisma migrate deploy   # 套用所有 migration（生產 / CI 用）
# 或開發時使用：
npx prisma migrate dev
```

### 注意事項

- Supabase 預設開啟 **Row Level Security（RLS）**，本專案透過 Prisma service role 存取，不受 RLS 限制
- 不要使用 Supabase 的 Pooler REST API，請直接使用 PostgreSQL 連線字串

---

## 三、啟動後端

```bash
cd backend
npm install
npm run dev
```

啟動後終端不應出現以下警告：
- `TWITCH_CLIENT_ID 或 TWITCH_CLIENT_SECRET 尚未設定`
- Prisma 連線錯誤（表示 `DATABASE_URL` 設定有誤）

---

## 注意事項

- **不要**將 `.env` 檔案 commit 到版本控制，`.gitignore` 已排除
- 生產環境（Zeabur / Railway 等）請在平台的環境變數設定介面填入，不要使用 `.env` 檔
- `DATABASE_URL` 與 `DIRECT_DATABASE_URL` 都是必填，缺一不可
