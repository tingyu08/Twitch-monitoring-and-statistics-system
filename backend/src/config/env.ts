import dotenv from "dotenv";
import fs from "fs";
import path from "path";

// #region agent log
const logPath = path.resolve(__dirname, "..", "..", ".cursor", "debug.log");
const logDir = path.dirname(logPath);
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
// 檢查 backend/.env 和項目根目錄的 .env
const backendEnvPath = path.resolve(__dirname, "..", "..", ".env");
const rootEnvPath = path.resolve(__dirname, "..", "..", "..", ".env");
const envFileExists = fs.existsSync(backendEnvPath) || fs.existsSync(rootEnvPath);
const logEntry1 = JSON.stringify({
  location: "env.ts:5",
  message: "Loading environment variables",
  data: { envFileExists, cwd: process.cwd() },
  timestamp: Date.now(),
  sessionId: "debug-session",
  runId: "env-check",
  hypothesisId: "H2",
}) + "\n";
fs.appendFileSync(logPath, logEntry1);
// #endregion

// 嘗試從 backend 目錄載入 .env，如果不存在則從項目根目錄載入
dotenv.config({ path: backendEnvPath });
if (!fs.existsSync(backendEnvPath) && fs.existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath });
}

const isProduction = process.env.NODE_ENV === "production";
const isTest = process.env.NODE_ENV === "test";

// 開發/測試環境的預設加密金鑰（僅用於本地開發）
const DEV_ENCRYPTION_KEY = "dmlld2VyLXRva2VuLWVuY3J5cHRpb24ta2V5LTMyISE=";
const DEV_JWT_SECRET = "dev-secret-change-in-production";

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 4000),
  twitchClientId: process.env.TWITCH_CLIENT_ID ?? "",
  twitchClientSecret: process.env.TWITCH_CLIENT_SECRET ?? "",
  twitchRedirectUri:
    process.env.TWITCH_REDIRECT_URI ?? "http://localhost:3000/auth/callback",
  twitchViewerRedirectUri:
    process.env.TWITCH_VIEWER_REDIRECT_URI ?? "http://localhost:4000/auth/viewer/callback",
  jwtSecret: process.env.APP_JWT_SECRET ?? (isProduction ? "" : DEV_JWT_SECRET),
  frontendUrl: process.env.FRONTEND_URL ?? "http://localhost:3000",
  viewerTokenEncryptionKey: process.env.VIEWER_TOKEN_ENCRYPTION_KEY ?? (isProduction ? "" : DEV_ENCRYPTION_KEY),
};

// #region agent log
const logEntry2 = JSON.stringify({
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
fs.appendFileSync(logPath, logEntry2);
// #endregion

// 生產環境嚴格驗證必要的環境變數
if (isProduction) {
  const missingVars: string[] = [];

  if (!process.env.APP_JWT_SECRET) {
    missingVars.push("APP_JWT_SECRET");
  }
  if (!process.env.VIEWER_TOKEN_ENCRYPTION_KEY) {
    missingVars.push("VIEWER_TOKEN_ENCRYPTION_KEY");
  }
  if (!process.env.TWITCH_CLIENT_ID) {
    missingVars.push("TWITCH_CLIENT_ID");
  }
  if (!process.env.TWITCH_CLIENT_SECRET) {
    missingVars.push("TWITCH_CLIENT_SECRET");
  }

  if (missingVars.length > 0) {
    throw new Error(
      `[backend/env] 生產環境缺少必要的環境變數: ${missingVars.join(", ")}。請確保這些變數已正確設定。`
    );
  }
}

// 開發/測試環境的警告
if (!isProduction && !isTest) {
  if (!env.twitchClientId || !env.twitchClientSecret) {
    console.warn(
      "[backend/env] TWITCH_CLIENT_ID 或 TWITCH_CLIENT_SECRET 尚未設定，Twitch OAuth 相關功能將無法正常運作。"
    );
  }
}

// 驗證加密金鑰格式
if (!env.viewerTokenEncryptionKey) {
  throw new Error(
    "[backend/env] VIEWER_TOKEN_ENCRYPTION_KEY 未設定，請提供 32-byte base64 key（ex: dmlld2VyLXRva2VuLWVuY3J5cHRpb24ta2V5LTMyISE=）。"
  );
}

if (!env.jwtSecret) {
  throw new Error(
    "[backend/env] APP_JWT_SECRET 未設定，請提供安全的 JWT 密鑰。"
  );
}

