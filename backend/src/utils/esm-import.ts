/**
 * ESM 動態導入包裝器
 *
 * 在 CommonJS 環境中，TypeScript 會將 `await import()` 編譯為 `require()`，
 * 這會導致無法正確導入純 ESM 模組（如 @twurple/*）。
 *
 * 此包裝器使用 `new Function` 技巧在運行時執行真正的動態 import，
 * 繞過 TypeScript 編譯器的轉換。
 *
 * 注意：這是一個已知的 Node.js ESM/CommonJS 互操作性限制的解決方案。
 * 參考：https://github.com/microsoft/TypeScript/issues/43329
 */

/**
 * 動態導入 ESM 模組
 * @param moduleName 模組名稱（如 "@twurple/api"）
 * @returns 模組的導出內容
 */
export async function importEsm<T = unknown>(moduleName: string): Promise<T> {
  // 使用 new Function 繞過 TypeScript 將 import() 編譯為 require() 的行為
  const dynamicImport = new Function("moduleName", "return import(moduleName)");
  return dynamicImport(moduleName);
}

/**
 * 導入 @twurple/api
 */
export async function importTwurpleApi() {
  return importEsm<typeof import("@twurple/api")>("@twurple/api");
}

/**
 * 導入 @twurple/auth
 */
export async function importTwurpleAuth() {
  return importEsm<typeof import("@twurple/auth")>("@twurple/auth");
}

/**
 * 導入 @twurple/chat
 */
export async function importTwurpleChat() {
  return importEsm<typeof import("@twurple/chat")>("@twurple/chat");
}

/**
 * 導入 @twurple/eventsub-http
 */
export async function importTwurpleEventSub() {
  return importEsm<typeof import("@twurple/eventsub-http")>(
    "@twurple/eventsub-http",
  );
}
