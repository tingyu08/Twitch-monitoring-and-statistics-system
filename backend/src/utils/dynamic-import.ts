/**
 * 動態 import 輔助函數
 * 使用 Function constructor 防止 TypeScript 將 import() 轉換為 require()
 * 這允許在 CommonJS 環境中導入 ES Modules
 *
 * 安全性：使用白名單機制，只允許導入特定模組
 */

/**
 * 允許動態導入的模組白名單
 * 只有此列表中的模組才能被動態導入
 */
const ALLOWED_MODULES = [
  "@twurple/api",
  "@twurple/auth",
  "@twurple/chat",
  "@twurple/eventsub-http",
] as const;

/**
 * 允許動態導入的內部模組前綴
 * 以這些前綴開頭的相對路徑可以被導入
 */
const ALLOWED_INTERNAL_PREFIXES = [
  "../../services/",
  "../../utils/",
  "../services/",
  "../utils/",
  "./services/",
  "./utils/",
] as const;

/**
 * 允許動態導入的模組類型
 */
export type AllowedModule = (typeof ALLOWED_MODULES)[number];

/**
 * 驗證模組路徑是否在白名單中
 */
function isAllowedModule(modulePath: string): boolean {
  // 檢查是否為允許的外部模組
  // 使用類型斷言將 readonly array視為 string array 以使用 includes
  if ((ALLOWED_MODULES as readonly string[]).includes(modulePath)) {
    return true;
  }

  // 檢查是否為允許的內部模組
  return (
    ALLOWED_INTERNAL_PREFIXES.some((prefix) => modulePath.startsWith(prefix)) ||
    (!!process.env.TS_NODE_DEV && modulePath.includes("Coding1/Bmad/backend/src")) ||
    // Production: Allow absolute paths pointing to dist folder
    (!process.env.TS_NODE_DEV && modulePath.startsWith("file://") && modulePath.includes("/dist/"))
  );
}

/**
 * 動態導入模組
 * @returns Promise<unknown> - 返回 unknown 類型，使用時需要進行類型斷言
 */
export function dynamicImport(modulePath: string): Promise<unknown> {
  // 安全性檢查：只允許白名單中的模組
  if (!isAllowedModule(modulePath)) {
    throw new Error(
      `Security: Module "${modulePath}" is not in the allowed list. ` +
        `Allowed modules: ${ALLOWED_MODULES.join(", ")}`
    );
  }

  // Development environment specific handling for absolute paths
  if (process.env.TS_NODE_DEV && modulePath.includes("Coding1/Bmad/backend/src")) {
    return new Function("modulePath", "return import(modulePath)")(modulePath);
  }

  // 使用 Function constructor 而不是 eval（相對安全）
  return new Function("modulePath", "return import(modulePath)")(modulePath);
}
