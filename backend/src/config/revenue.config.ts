/**
 * Revenue Service 配置檔
 *
 * 集中管理所有收益相關的常數，避免硬編碼
 */

/**
 * 訂閱層級收益預估 (USD)
 * 標準分潤比例：50%
 */
export const REVENUE_SHARE = {
  tier1: 4.99 * 0.5,  // $2.495
  tier2: 9.99 * 0.5,  // $4.995
  tier3: 24.99 * 0.5, // $12.495
} as const;

/**
 * Bits 轉換率
 * 100 Bits = $1 USD
 */
export const BITS_TO_USD_RATE = 0.01 as const;

/**
 * 同步超時設定（毫秒）
 * Zeabur 免費層有 30 秒請求限制，設定 25 秒超時以保留緩衝
 */
export const SYNC_TIMEOUT_MS = parseInt(
  process.env.REVENUE_SYNC_TIMEOUT || '25000'
);

/**
 * 訂閱同步限制
 */
export const SUBSCRIPTION_SYNC = {
  MAX_SUBSCRIPTIONS: 5000,  // 最大訂閱者數量
  MAX_TIME_MS: 20000,       // 最大執行時間（毫秒）
} as const;

/**
 * PDF 匯出限制
 * 在 Zeabur 免費層上，PDF 生成消耗較多記憶體
 */
export const PDF_EXPORT = {
  MAX_DAYS: 90,             // 最多匯出 90 天的資料
  MAX_RECORDS_PER_TABLE: 10, // 每個表格最多顯示 10 筆記錄
} as const;

/**
 * 查詢參數限制
 */
export const QUERY_LIMITS = {
  MIN_DAYS: 1,
  MAX_DAYS: 365,
  MIN_LIMIT: 1,
  MAX_LIMIT: 100,
  DEFAULT_DAYS: 30,
  DEFAULT_LIMIT: 10,
} as const;

/**
 * API 速率限制配置
 * 針對 Zeabur 免費層的資源限制設計
 */
export const RATE_LIMITS = {
  SYNC: {
    windowMs: 5 * 60 * 1000,  // 5 分鐘
    max: 3,                    // 每 5 分鐘最多 3 次
  },
  EXPORT: {
    windowMs: 15 * 60 * 1000, // 15 分鐘
    max: 10,                   // 每 15 分鐘最多 10 次
  },
} as const;
