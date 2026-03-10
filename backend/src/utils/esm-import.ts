/**
 * ESM dynamic import helper for CommonJS builds.
 * This file intentionally keeps imports limited to Twurple modules.
 */

const allowedEsmModules = new Set([
  "@twurple/api",
  "@twurple/auth",
  "@twurple/chat",
  "@twurple/eventsub-http",
  "p-limit",
]);

const nativeImport = new Function("modulePath", "return import(modulePath);") as (
  modulePath: string
) => Promise<unknown>;
const moduleCache = new Map<string, Promise<unknown>>();

type LimitRunner = <T>(task: () => Promise<T>) => Promise<T>;
type PLimitModule = {
  default: (concurrency: number) => LimitRunner;
};

async function importEsm<T = unknown>(moduleName: string): Promise<T> {
  if (!allowedEsmModules.has(moduleName)) {
    throw new Error(`[esm-import] Module not allowed: ${moduleName}`);
  }

  if (!moduleCache.has(moduleName)) {
    moduleCache.set(moduleName, nativeImport(moduleName));
  }

  return moduleCache.get(moduleName) as Promise<T>;
}

export async function importTwurpleApi() {
  return importEsm<typeof import("@twurple/api")>("@twurple/api");
}

export async function importTwurpleAuth() {
  return importEsm<typeof import("@twurple/auth")>("@twurple/auth");
}

export async function importTwurpleChat() {
  return importEsm<typeof import("@twurple/chat")>("@twurple/chat");
}

export async function importTwurpleEventSub() {
  return importEsm<typeof import("@twurple/eventsub-http")>("@twurple/eventsub-http");
}

export async function importPLimit(): Promise<PLimitModule> {
  if (process.env.JEST_WORKER_ID) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("./p-limit-shim") as PLimitModule;
  }

  return importEsm<PLimitModule>("p-limit");
}
