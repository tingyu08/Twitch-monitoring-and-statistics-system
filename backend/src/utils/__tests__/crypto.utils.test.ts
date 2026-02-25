/**
 * crypto.utils.ts 單元測試
 *
 * 測試範圍：
 * - encryptToken：成功加密、金鑰未設定拋出錯誤、金鑰長度不符拋出錯誤
 * - decryptToken：成功解密、無效資料拋出錯誤、篡改資料拋出錯誤
 */

jest.mock("../logger", () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import { encryptToken, decryptToken } from "../crypto.utils";

// setupTests.ts 已設定 VIEWER_TOKEN_ENCRYPTION_KEY = 'dGVzdC1lbmNyeXB0aW9uLWtleS0zMi1ieXRlcyEhISE='
// 這是 32 bytes base64 金鑰

describe("encryptToken", () => {
  it("應對 token 進行加密並回傳 base64 字串", () => {
    const token = "my-secret-access-token";
    const encrypted = encryptToken(token);
    expect(typeof encrypted).toBe("string");
    expect(encrypted).not.toBe(token);
    // base64 字元集驗證
    expect(encrypted).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  it("相同 token 每次加密結果應不同（因 IV 隨機）", () => {
    const token = "same-token";
    const enc1 = encryptToken(token);
    const enc2 = encryptToken(token);
    expect(enc1).not.toBe(enc2);
  });

  it("未設定 VIEWER_TOKEN_ENCRYPTION_KEY 時應拋出錯誤", () => {
    const original = process.env.VIEWER_TOKEN_ENCRYPTION_KEY;
    delete process.env.VIEWER_TOKEN_ENCRYPTION_KEY;
    expect(() => encryptToken("token")).toThrow("Token encryption failed");
    process.env.VIEWER_TOKEN_ENCRYPTION_KEY = original;
  });

  it("金鑰長度不正確時應拋出錯誤", () => {
    const original = process.env.VIEWER_TOKEN_ENCRYPTION_KEY;
    // 設定非 32 bytes 的 base64 key
    process.env.VIEWER_TOKEN_ENCRYPTION_KEY = Buffer.from("short-key").toString("base64");
    expect(() => encryptToken("token")).toThrow("Token encryption failed");
    process.env.VIEWER_TOKEN_ENCRYPTION_KEY = original;
  });
});

describe("decryptToken", () => {
  it("應正確解密已加密的 token", () => {
    const original = "my-secret-refresh-token-12345";
    const encrypted = encryptToken(original);
    const decrypted = decryptToken(encrypted);
    expect(decrypted).toBe(original);
  });

  it("應處理包含特殊字元的 token", () => {
    const original = "token!@#$%^&*()_+-={}|[]\\:\";'<>?,./`~";
    const encrypted = encryptToken(original);
    const decrypted = decryptToken(encrypted);
    expect(decrypted).toBe(original);
  });

  it("應處理 Unicode 字元的 token", () => {
    const original = "token-with-unicode-繁體中文-🎮";
    const encrypted = encryptToken(original);
    const decrypted = decryptToken(encrypted);
    expect(decrypted).toBe(original);
  });

  it("無效的加密資料應拋出錯誤", () => {
    expect(() => decryptToken("invalid-base64-data!!!")).toThrow("Token decryption failed");
  });

  it("篡改加密資料後應拋出錯誤（GCM 完整性驗證）", () => {
    const token = "original-token";
    const encrypted = encryptToken(token);
    // 修改加密資料的中間部分
    const tampered = encrypted.slice(0, 10) + "AAAA" + encrypted.slice(14);
    expect(() => decryptToken(tampered)).toThrow("Token decryption failed");
  });

  it("未設定金鑰時解密應拋出錯誤", () => {
    const encrypted = encryptToken("some-token");
    const original = process.env.VIEWER_TOKEN_ENCRYPTION_KEY;
    delete process.env.VIEWER_TOKEN_ENCRYPTION_KEY;
    expect(() => decryptToken(encrypted)).toThrow("Token decryption failed");
    process.env.VIEWER_TOKEN_ENCRYPTION_KEY = original;
  });
});
