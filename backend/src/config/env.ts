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

const defaultViewerEncryptionKey =
  process.env.NODE_ENV === "production"
    ? ""
    : "dmlld2VyLXRva2VuLWVuY3J5cHRpb24ta2V5LTMyISE="; // 32 bytes base64 (dev/test fallback)

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 4000),
  twitchClientId: process.env.TWITCH_CLIENT_ID ?? "",
  twitchClientSecret: process.env.TWITCH_CLIENT_SECRET ?? "",
  twitchRedirectUri:
    process.env.TWITCH_REDIRECT_URI ?? "http://localhost:3000/auth/callback",
  twitchViewerRedirectUri:
    process.env.TWITCH_VIEWER_REDIRECT_URI ?? "http://localhost:4000/auth/viewer/callback",
  jwtSecret: process.env.APP_JWT_SECRET ?? "dev-secret-change-in-production",
  frontendUrl: process.env.FRONTEND_URL ?? "http://localhost:3000",
  viewerTokenEncryptionKey: process.env.VIEWER_TOKEN_ENCRYPTION_KEY ?? defaultViewerEncryptionKey,
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

if (!env.twitchClientId || !env.twitchClientSecret) {
  // 在開發階段給出明確警告，但不強制中止，方便先跑起流程
  // 真正部署前應確保環境變數正確設定
    console.warn(
    "[backend/env] TWITCH_CLIENT_ID 或 TWITCH_CLIENT_SECRET 尚未設定，Twitch OAuth 相關功能將無法正常運作。"
  );
}

if (!env.viewerTokenEncryptionKey) {
  throw new Error(
    "[backend/env] VIEWER_TOKEN_ENCRYPTION_KEY 未設定，請提供 32-byte base64 key（ex: dmlld2VyLXRva2VuLWVuY3J5cHRpb24ta2V5LTMyISE=）。"
  );
}

