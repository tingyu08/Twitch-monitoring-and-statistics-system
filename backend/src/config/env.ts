import dotenv from "dotenv";
import fs from "fs";
import path from "path";
const isProduction = process.env.NODE_ENV === "production";
const isTest = process.env.NODE_ENV === "test";
const shouldWriteDebugLog = !isProduction && !isTest;
const logPath = path.resolve(__dirname, "..", "..", ".cursor", "debug.log");
const logDir = path.dirname(logPath);
const writeDebugLog = (entry: string) => {
  if (!shouldWriteDebugLog) return;
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  fs.appendFileSync(logPath, entry);
};

// #region agent log
// 檢查 backend/.env 和項目根目錄的 .env
const backendEnvPath = path.resolve(__dirname, "..", "..", ".env");
const rootEnvPath = path.resolve(__dirname, "..", "..", "..", ".env");
const envFileExists = fs.existsSync(backendEnvPath) || fs.existsSync(rootEnvPath);
const logEntry1 =
  JSON.stringify({
    location: "env.ts:5",
    message: "Loading environment variables",
    data: { envFileExists, cwd: process.cwd() },
    timestamp: Date.now(),
    sessionId: "debug-session",
    runId: "env-check",
    hypothesisId: "H2",
  }) + "\n";
writeDebugLog(logEntry1);
// #endregion

// 嘗試從 backend 目錄載入 .env，如果不存在則從項目根目錄載入
dotenv.config({ path: backendEnvPath });
if (!fs.existsSync(backendEnvPath) && fs.existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath });
}

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

// #region agent log
const logEntry2 =
  JSON.stringify({
    location: "env.ts:25",
    message: "Environment variables loaded",
    data: {
      twitchClientIdSet: !!env.twitchClientId,
      twitchClientIdLength: env.twitchClientId.length,
      twitchClientSecretSet: !!env.twitchClientSecret,
      twitchClientSecretLength: env.twitchClientSecret.length,
      viewerTokenEncryptionKeySet: !!env.viewerTokenEncryptionKey,
      viewerTokenEncryptionKeyLength: env.viewerTokenEncryptionKey.length,
    },
    timestamp: Date.now(),
    sessionId: "debug-session",
    runId: "env-check",
    hypothesisId: "H1",
  }) + "\n";
writeDebugLog(logEntry2);
// #endregion

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
