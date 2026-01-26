/**
 * 動態 import 輔助函數
 * 使用 eval 來防止 TypeScript 將 import() 轉換為 require()
 * 這允許在 CommonJS 環境中導入 ES Modules
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function dynamicImport(modulePath: string): Promise<any> {
  // 使用 Function constructor 而不是 eval，更安全
  return new Function('modulePath', 'return import(modulePath)')(modulePath);
}
