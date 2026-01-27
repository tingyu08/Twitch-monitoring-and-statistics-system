/**
 * DecAPI Service (精簡版)
 *
 * 僅保留 DecAPI 獨特的功能：
 * - 追蹤時長 (Followage) - 無需額外 OAuth scope
 * - 帳號年齡 (Account Age) - 格式更友好
 *
 * 其他功能（頻道資訊、直播狀態等）請使用 Twurple
 */

import axios, { AxiosInstance } from "axios";
import { logger } from "../utils/logger";

// ========== 類型定義 ==========

export interface FollowageResult {
  isFollowing: boolean;
  followedAt?: string; // ISO 8601 格式
  duration?: string; // 人類可讀格式，如 "2 years, 3 months"
  error?: string;
}

export interface AccountAgeResult {
  createdAt: string; // ISO 8601 格式
  age: string; // 人類可讀格式
}

// ========== 服務實作 ==========

// P1 Fix: 快取大小上限，避免記憶體無限增長
const MAX_CACHE_SIZE = 1000;

class DecApiService {
  private readonly api: AxiosInstance;
  private readonly cache: Map<string, { data: unknown; expiresAt: number }> = new Map();

  constructor() {
    this.api = axios.create({
      baseURL: "https://decapi.me",
      timeout: 10000,
      headers: {
        Accept: "text/plain",
      },
    });
  }

  // ========== 快取管理 ==========

  private getCached<T>(key: string): T | null {
    const cached = this.cache.get(key);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.data as T;
    }
    this.cache.delete(key);
    return null;
  }

  private setCache(key: string, data: unknown, ttlSeconds: number): void {
    // P1 Fix: 如果快取已滿，清除過期項目或最舊的項目
    if (this.cache.size >= MAX_CACHE_SIZE) {
      this.pruneCache();
    }

    this.cache.set(key, {
      data,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  // P1 Fix: 清理過期或最舊的快取項目
  private pruneCache(): void {
    const now = Date.now();

    // 先嘗試清除過期項目
    for (const [key, value] of this.cache) {
      if (now >= value.expiresAt) {
        this.cache.delete(key);
      }
    }

    // 如果還是超過上限，刪除最舊的 20% 項目（FIFO）
    if (this.cache.size >= MAX_CACHE_SIZE) {
      const deleteCount = Math.floor(MAX_CACHE_SIZE * 0.2);
      let deleted = 0;
      for (const key of this.cache.keys()) {
        if (deleted >= deleteCount) break;
        this.cache.delete(key);
        deleted++;
      }
      logger.debug("DecAPI", `Pruned ${deleted} cache entries`);
    }
  }

  // ========== 追蹤相關（DecAPI 獨特功能）==========

  /**
   * 獲取用戶追蹤某頻道的時長
   * 這是 DecAPI 的獨特功能，無需 moderator:read:followers scope
   *
   * @param channel 頻道名稱（小寫）
   * @param user 用戶名稱（小寫）
   */
  async getFollowage(channel: string, user: string): Promise<FollowageResult> {
    const cacheKey = `followage:${channel}:${user}`;
    const cached = this.getCached<FollowageResult>(cacheKey);
    if (cached) return cached;

    try {
      // 獲取追蹤時長（人類可讀格式）
      const durationResponse = await this.api.get<string>(`/twitch/followage/${channel}/${user}`);
      const duration = durationResponse.data;

      // 檢查是否未追蹤
      if (
        duration.toLowerCase().includes("not following") ||
        duration.toLowerCase().includes("does not follow")
      ) {
        const result: FollowageResult = { isFollowing: false };
        this.setCache(cacheKey, result, 120); // 2 分鐘快取
        return result;
      }

      // 獲取追蹤日期
      const dateResponse = await this.api.get<string>(`/twitch/followed/${channel}/${user}`, {
        params: { format: "Y-m-d H:i:s" },
      });

      const result: FollowageResult = {
        isFollowing: true,
        duration,
        followedAt: dateResponse.data,
      };
      this.setCache(cacheKey, result, 1800); // 30 分鐘快取
      return result;
    } catch (error) {
      logger.error("DecAPI", `Failed to get followage: ${channel}/${user}`, error);
      return { isFollowing: false, error: "查詢失敗" };
    }
  }

  // ========== 帳號相關（DecAPI 格式更友好）==========

  /**
   * 獲取帳號年齡（人類可讀格式）
   * DecAPI 的格式比直接用 Twurple 更友好
   */
  async getAccountAge(user: string): Promise<AccountAgeResult | null> {
    const cacheKey = `accountage:${user}`;
    const cached = this.getCached<AccountAgeResult>(cacheKey);
    if (cached) return cached;

    try {
      // 獲取帳號年齡（人類可讀格式）
      const ageResponse = await this.api.get<string>(`/twitch/accountage/${user}`);

      // 獲取創建日期
      const dateResponse = await this.api.get<string>(`/twitch/creation/${user}`, {
        params: { format: "Y-m-d H:i:s" },
      });

      const result: AccountAgeResult = {
        age: ageResponse.data,
        createdAt: dateResponse.data,
      };
      this.setCache(cacheKey, result, 21600); // 6 小時快取
      return result;
    } catch (error) {
      logger.error("DecAPI", `Failed to get account age: ${user}`, error);
      return null;
    }
  }

  // ========== 服務狀態 ==========

  /**
   * 清除快取
   */
  clearCache(): void {
    this.cache.clear();
    logger.info("DecAPI", "Cache cleared");
  }

  /**
   * 獲取快取統計
   */
  getCacheStats() {
    let validEntries = 0;
    let expiredEntries = 0;
    const now = Date.now();

    this.cache.forEach((value) => {
      if (now < value.expiresAt) {
        validEntries++;
      } else {
        expiredEntries++;
      }
    });

    return {
      totalEntries: this.cache.size,
      validEntries,
      expiredEntries,
    };
  }
}

// 單例模式
export const decApiService = new DecApiService();
