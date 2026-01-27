import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // GCM 建議 12 bytes

function getKey(): Buffer {
  // Use process.env directly to avoid importing config module in dynamic import scenarios
  const keyBase64 = process.env.VIEWER_TOKEN_ENCRYPTION_KEY;
  if (!keyBase64) {
    throw new Error("VIEWER_TOKEN_ENCRYPTION_KEY is not set");
  }
  const key = Buffer.from(keyBase64, "base64");
  if (key.length !== 32) {
    throw new Error("VIEWER_TOKEN_ENCRYPTION_KEY must be 32 bytes (base64-encoded)");
  }
  return key;
}

export function encryptToken(token: string): string {
  try {
    const key = getKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, encrypted]).toString("base64");
  } catch (error) {
    // P0 Security Fix: 避免日誌洩漏敏感資訊（如密鑰、token 內容）
    // 只記錄錯誤類型，不記錄完整 error 物件或 token
    const errorName = error instanceof Error ? error.name : "UnknownError";
    console.error(`[AUTH] encryptToken failed: ${errorName}`);
    throw new Error("Token encryption failed");
  }
}

export function decryptToken(encrypted: string): string {
  try {
    const key = getKey();
    const data = Buffer.from(encrypted, "base64");
    const iv = data.subarray(0, IV_LENGTH);
    const authTag = data.subarray(IV_LENGTH, IV_LENGTH + 16);
    const ciphertext = data.subarray(IV_LENGTH + 16);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString("utf8");
  } catch (error) {
    // P0 Security Fix: 避免日誌洩漏敏感資訊（如密鑰、加密內容）
    // 只記錄錯誤類型，不記錄完整 error 物件或加密資料
    const errorName = error instanceof Error ? error.name : "UnknownError";
    console.error(`[AUTH] decryptToken failed: ${errorName}`);
    throw new Error("Token decryption failed");
  }
}
