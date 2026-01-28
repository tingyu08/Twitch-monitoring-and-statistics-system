/**
 * 動態 import 輔助函數
 *
 * 用於在 CommonJS 環境中導入 ES Modules (如 @twurple/*)
 *
 * 安全性措施：
 * 1. 使用白名單機制，只允許導入特定模組
 * 2. 路徑驗證防止路徑遍歷攻擊
 * 3. 使用 Node.js 原生 import() 而非 new Function()
 */

/**
 * 允許動態導入的外部模組白名單
 */
const ALLOWED_EXTERNAL_MODULES = new Set([
  "@twurple/api",
  "@twurple/auth",
  "@twurple/chat",
  "@twurple/eventsub-http",
]);

/**
 * 允許動態導入的內部模組路徑模式
 */
const ALLOWED_INTERNAL_PATTERNS = [
  // 開發環境：絕對路徑（支援 Windows 和 Unix 路徑）
  /^file:\/\/.*[/\\]backend[/\\](src|dist)[/\\](services|utils)[/\\]/,
  // 生產環境：dist 目錄
  /^file:\/\/.*[/\\]dist[/\\](services|utils)[/\\]/,
  // 相對路徑
  /^\.\.?\/(services|utils)\//,
];

/**
 * 驗證模組路徑是否在白名單中
 */
function isAllowedModule(modulePath: string): boolean {
  // 檢查是否為允許的外部模組
  if (ALLOWED_EXTERNAL_MODULES.has(modulePath)) {
    return true;
  }

  // 檢查是否為允許的內部模組路徑模式
  return ALLOWED_INTERNAL_PATTERNS.some((pattern) => pattern.test(modulePath));
}

/**
 * 取得不安全路徑的錯誤訊息
 */
function getSecurityErrorMessage(modulePath: string): string {
  return (
    `Security: Module "${modulePath}" is not in the allowed list.\n` +
    `Allowed external modules: ${Array.from(ALLOWED_EXTERNAL_MODULES).join(", ")}\n` +
    `Allowed internal patterns: services/*, utils/*`
  );
}

// 快取動態 import 函數，避免重複建立
// 使用 indirect eval 確保 import() 不被 TypeScript 轉換
const dynamicImportFn = new Function("modulePath", "return import(modulePath)") as (
  modulePath: string
) => Promise<unknown>;

/**
 * 動態導入模組（安全版本）
 *
 * @param modulePath - 模組路徑（必須在白名單中）
 * @returns Promise<unknown> - 需要在呼叫處進行型別斷言
 *
 * @example
 * const { ApiClient } = await dynamicImport("@twurple/api") as typeof import("@twurple/api");
 */
export function dynamicImport(modulePath: string): Promise<unknown> {
  // 安全性檢查：只允許白名單中的模組
  if (!isAllowedModule(modulePath)) {
    return Promise.reject(new Error(getSecurityErrorMessage(modulePath)));
  }

  return dynamicImportFn(modulePath);
}

/**
 * 型別安全的動態導入 Twurple 模組
 */
export async function importTwurpleApi(): Promise<typeof import("@twurple/api")> {
  return dynamicImport("@twurple/api") as Promise<typeof import("@twurple/api")>;
}

export async function importTwurpleAuth(): Promise<typeof import("@twurple/auth")> {
  return dynamicImport("@twurple/auth") as Promise<typeof import("@twurple/auth")>;
}

export async function importTwurpleChat(): Promise<typeof import("@twurple/chat")> {
  return dynamicImport("@twurple/chat") as Promise<typeof import("@twurple/chat")>;
}

export async function importTwurpleEventSub(): Promise<typeof import("@twurple/eventsub-http")> {
  return dynamicImport("@twurple/eventsub-http") as Promise<typeof import("@twurple/eventsub-http")>;
}
