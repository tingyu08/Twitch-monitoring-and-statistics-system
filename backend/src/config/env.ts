import dotenv from "dotenv";
import path from "path";
const isProduction = process.env.NODE_ENV === "production";
const isTest = process.env.NODE_ENV === "test";
const backendEnvPath = path.resolve(__dirname, "..", "..", ".env");
const rootEnvPath = path.resolve(__dirname, "..", "..", "..", ".env");

// 嘗試從 backend 目錄載入 .env；若不存在，再嘗試根目錄 .env
dotenv.config({ path: backendEnvPath });
dotenv.config({ path: rootEnvPath });

// 輔助函數：獲取必要的環境變數（生產環境強制，開發環境可選）
function getRequiredEnv(key: string, defaultValue?: string): string {
  const value = process.env[key];

  // 測試環境：使用預設值
  if (isTest && defaultValue !== undefined) {
    return value || defaultValue;
  }

  // 生產環境：必須提供
  if (isProduction && !value) {
    throw new Error(
      `[backend/env] Missing required environment variable: ${key} (production mode)`
    );
  }

  // 開發環境：使用預設值但發出警告
  if (!value && defaultValue !== undefined) {
    return defaultValue;
  }

  return value || "";
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 4000),
  twitchClientId: getRequiredEnv("TWITCH_CLIENT_ID"),
  twitchClientSecret: getRequiredEnv("TWITCH_CLIENT_SECRET"),
  twitchRedirectUri: process.env.TWITCH_REDIRECT_URI ?? "http://localhost:3000/auth/callback",
  twitchViewerRedirectUri:
    process.env.TWITCH_VIEWER_REDIRECT_URI ?? "http://localhost:4000/auth/viewer/callback",
  jwtSecret: getRequiredEnv("APP_JWT_SECRET"),
  frontendUrl: process.env.FRONTEND_URL ?? "http://localhost:3000",
  viewerTokenEncryptionKey: getRequiredEnv("VIEWER_TOKEN_ENCRYPTION_KEY"),
};

// 生產環境嚴格驗證已由 getRequiredEnv() 處理
// 如果到達這裡，表示所有必要的環境變數都已設定

// 開發/測試環境的警告
if (!isProduction && !isTest) {
  if (!env.twitchClientId || !env.twitchClientSecret) {
    console.warn(
      "[backend/env] TWITCH_CLIENT_ID 或 TWITCH_CLIENT_SECRET 尚未設定，Twitch OAuth 相關功能將無法正常運作。"
    );
  }
}

// 驗證加密金鑰格式（測試環境中跳過，因為環境變數在 setupTests.ts 中設置）
if (!isTest) {
  if (!env.viewerTokenEncryptionKey) {
    throw new Error(
      "[backend/env] VIEWER_TOKEN_ENCRYPTION_KEY 未設定，請提供 32-byte base64 key（ex: dmlld2VyLXRva2VuLWVuY3J5cHRpb24ta2V5LTMyISE=）。"
    );
  }

  if (!env.jwtSecret) {
    throw new Error("[backend/env] APP_JWT_SECRET 未設定，請提供安全的 JWT 密鑰。");
  }
}
