# 後端技術棧指南

本文件說明專案後端的技術選擇與開發指南。

## 技術棧總覽

| 類別         | 技術            | 版本   | 用途                  |
| ------------ | --------------- | ------ | --------------------- |
| **語言**     | TypeScript      | 5.6.3  | 類型安全的 JavaScript |
| **執行環境** | Node.js         | -      | JavaScript 執行時     |
| **Web 框架** | Express         | 4.19.2 | HTTP 伺服器與路由     |
| **ORM**      | Prisma          | 7.1.0  | 資料庫抽象層          |
| **資料庫**   | SQLite (LibSQL) | -      | 嵌入式資料庫          |

## Twitch 整合架構

### 核心套件：Twurple

專案使用 **Twurple** 作為 Twitch 整合的核心技術：

| 套件            | 用途                    |
| --------------- | ----------------------- |
| `@twurple/api`  | Twitch Helix API 客戶端 |
| `@twurple/auth` | OAuth Token 管理        |
| `@twurple/chat` | Twitch 聊天室監聽       |

### 輔助服務：DecAPI

**DecAPI** (decapi.me) 僅用於特定功能：

| 功能              | 為什麼使用 DecAPI？                        |
| ----------------- | ------------------------------------------ |
| `getFollowage()`  | 查詢追蹤時長，無需額外 OAuth scope         |
| `getAccountAge()` | 回傳人類可讀格式（如 "2 years, 3 months"） |

### 通用 HTTP：Axios

**Axios** 用於非 Twitch 的 HTTP 請求：

| 用途        | 說明                           |
| ----------- | ------------------------------ |
| DecAPI 呼叫 | 呼叫 decapi.me 服務            |
| API 代理    | `proxy.routes.ts` 功能         |
| 第三方整合  | Discord、Streamlabs 等未來需求 |

---

## 開發決策指南

### 新增功能時的技術選擇

```
功能需求
   │
   ├── 與 Twitch 相關？
   │      │
   │      ├── 是 → 使用 Twurple ✅
   │      │       • @twurple/api (Helix API)
   │      │       • @twurple/chat (聊天監聽)
   │      │       • @twurple/eventsub-ws (事件訂閱)
   │      │
   │      └── 否 → 使用 Axios ✅
   │              • 第三方 API
   │              • DecAPI
   │              • 其他 HTTP 請求
```

### 具體示例

| 需求          | 技術選擇               | 原因             |
| ------------- | ---------------------- | ---------------- |
| 獲取用戶資訊  | `@twurple/api`         | Twitch Helix API |
| 監聽聊天訊息  | `@twurple/chat`        | Twitch IRC       |
| 查詢追蹤時長  | `DecAPI`               | 無需額外權限     |
| 整合 Discord  | `Axios`                | 非 Twitch API    |
| EventSub 訂閱 | `@twurple/eventsub-ws` | Twitch 事件      |

---

## 服務層架構

```
backend/src/services/
├── twurple-auth.service.ts      # Token 管理
├── twitch-helix.service.ts      # Helix API (使用 @twurple/api)
├── twitch-chat.service.ts       # 聊天監聽 (使用 @twurple/chat)
├── unified-twitch.service.ts    # 統一服務層
└── decapi.service.ts            # DecAPI 獨特功能
```

### 服務職責

| 服務                        | 職責                           |
| --------------------------- | ------------------------------ |
| `twurple-auth.service.ts`   | App/User Token 管理、自動刷新  |
| `twitch-helix.service.ts`   | 用戶、頻道、直播、追蹤者 API   |
| `twitch-chat.service.ts`    | 聊天室連接、訊息監聽、事件處理 |
| `unified-twitch.service.ts` | 整合所有服務，提供高階 API     |
| `decapi.service.ts`         | followage、accountAge          |

---

## 不再使用的技術

以下技術已被移除或取代：

| 技術                       | 狀態          | 取代方案                |
| -------------------------- | ------------- | ----------------------- |
| `tmi.js`                   | ❌ 已移除     | `@twurple/chat`         |
| 直接呼叫 Helix API (axios) | ⚠️ 保留舊代碼 | 新功能用 `@twurple/api` |

---

## 環境變數

```bash
# Twitch OAuth（Twurple 和舊 OAuth 共用）
TWITCH_CLIENT_ID=your_client_id
TWITCH_CLIENT_SECRET=your_client_secret

# 聊天監聽（Twurple Chat）
TWITCH_BOT_USERNAME=your_bot_username
TWITCH_BOT_OAUTH_TOKEN=oauth:your_token
```

---

## 相關文件

- [Story 2.4: Twitch API 整合](./stories/2.4.twitch-api-integration.md)
- [開發環境設定](./dev-setup.md)
