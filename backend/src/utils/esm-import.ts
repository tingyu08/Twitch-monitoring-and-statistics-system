/**
 * ESM dynamic import helper for CommonJS builds.
 * This file intentionally keeps imports limited to Twurple modules.
 */

const allowedEsmModules = new Set([
  "@twurple/api",
  "@twurple/auth",
  "@twurple/chat",
  "@twurple/eventsub-http",
]);

async function importEsm<T = unknown>(moduleName: string): Promise<T> {
  if (!allowedEsmModules.has(moduleName)) {
    throw new Error(`[esm-import] Module not allowed: ${moduleName}`);
  }
  // Avoid TypeScript rewriting import() into require() in CommonJS output.
  const dynamicImport = new Function("moduleName", "return import(moduleName)");
  return dynamicImport(moduleName);
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
