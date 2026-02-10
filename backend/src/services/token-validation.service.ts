/**
 * Token Validation Service
 *
 * 負責驗證 Twitch Token 有效性並管理 Token 狀態
 * - 驗證 Token 是否有效
 * - 標記失效的 Token
 * - 嘗試刷新過期的 Token
 */

import { prisma } from "../db/prisma";
import axios from "axios";
import { logger } from "../utils/logger";
import { decryptToken } from "../utils/crypto.utils";

// Token 狀態常量
export const TokenStatus = {
  ACTIVE: "active",
  EXPIRED: "expired",
  REVOKED: "revoked",
  INVALID: "invalid",
} as const;

export type TokenStatusType = (typeof TokenStatus)[keyof typeof TokenStatus];

interface ValidationResult {
  isValid: boolean;
  status: TokenStatusType;
  message: string;
  shouldRetry: boolean;
}

interface TwitchValidateResponse {
  client_id: string;
  login: string;
  scopes: string[];
  user_id: string;
  expires_in: number;
}

class TokenValidationService {
  private readonly TWITCH_VALIDATE_URL = "https://id.twitch.tv/oauth2/validate";
  private readonly MAX_FAILURE_COUNT = 3;
  private readonly TOKEN_SCAN_BATCH_SIZE = 200;
  private readonly TOKENS_NEEDING_REFRESH_LIMIT = Number.parseInt(
    process.env.TOKENS_NEEDING_REFRESH_LIMIT || "500",
    10
  );

  /**
   * 驗證單個 Token 是否有效
   */
  async validateToken(accessToken: string): Promise<ValidationResult> {
    try {
      const response = await axios.get(this.TWITCH_VALIDATE_URL, {
        headers: {
          Authorization: `OAuth ${accessToken}`,
        },
        validateStatus: (status) => status < 500, // 允許 401 等狀態碼，我們自行處理
      });

      if (response.status === 200) {
        const data: TwitchValidateResponse = response.data;
        logger.debug("Token Validation", `Token valid, expires in ${data.expires_in}s`);
        return {
          isValid: true,
          status: TokenStatus.ACTIVE,
          message: `Token valid, expires in ${data.expires_in} seconds`,
          shouldRetry: false,
        };
      }

      // 處理錯誤狀態碼
      if (response.status === 401) {
        const errorBody = response.data || {};
        const message = errorBody.message || "Invalid access token";

        // 判斷是過期還是已撤銷
        if (message.toLowerCase().includes("expired")) {
          return {
            isValid: false,
            status: TokenStatus.EXPIRED,
            message: "Token has expired",
            shouldRetry: true, // 可嘗試刷新
          };
        }

        return {
          isValid: false,
          status: TokenStatus.INVALID,
          message: message,
          shouldRetry: false,
        };
      }

      // 其他錯誤
      return {
        isValid: false,
        status: TokenStatus.INVALID,
        message: `Unexpected status code: ${response.status}`,
        shouldRetry: true,
      };
    } catch (error) {
      logger.error("Token Validation", "Failed to validate token", error);
      return {
        isValid: false,
        status: TokenStatus.INVALID,
        message: error instanceof Error ? error.message : "Unknown error",
        shouldRetry: true, // 網路錯誤可重試
      };
    }
  }

  /**
   * 驗證並更新資料庫中的 Token 狀態
   */
  async validateAndUpdateToken(tokenId: string): Promise<ValidationResult> {
    const token = await prisma.twitchToken.findUnique({
      where: { id: tokenId },
    });

    if (!token) {
      return {
        isValid: false,
        status: TokenStatus.INVALID,
        message: "Token not found in database",
        shouldRetry: false,
      };
    }

    // 解密 Token 後再驗證（資料庫儲存的是加密的 Token）
    const decryptedToken = decryptToken(token.accessToken);
    const result = await this.validateToken(decryptedToken);

    if (result.isValid) {
      // Token 有效，更新驗證時間並重置失敗計數
      await prisma.twitchToken.update({
        where: { id: tokenId },
        data: {
          status: TokenStatus.ACTIVE,
          lastValidatedAt: new Date(),
          failureCount: 0,
        },
      });
    } else {
      // Token 無效，增加失敗計數
      const newFailureCount = token.failureCount + 1;
      const newStatus = newFailureCount >= this.MAX_FAILURE_COUNT ? result.status : token.status;

      await prisma.twitchToken.update({
        where: { id: tokenId },
        data: {
          status: newStatus,
          failureCount: newFailureCount,
        },
      });

      logger.warn(
        "Token Validation",
        `Token ${tokenId} validation failed (${newFailureCount}/${this.MAX_FAILURE_COUNT})`,
        { status: newStatus, message: result.message }
      );
    }

    return result;
  }

  /**
   * 批量驗證所有活躍的 Token
   */
  async validateAllActiveTokens(): Promise<{
    total: number;
    valid: number;
    invalid: number;
    errors: string[];
  }> {
    let valid = 0;
    let invalid = 0;
    let total = 0;
    const errors: string[] = [];

    logger.info("Token Validation", "Validating active tokens in paged batches...");

    let cursorId: string | undefined;

    while (true) {
      const batch = await prisma.twitchToken.findMany({
        where: {
          status: TokenStatus.ACTIVE,
        },
        select: {
          id: true,
          ownerType: true,
          streamerId: true,
          viewerId: true,
        },
        orderBy: { id: "asc" },
        take: this.TOKEN_SCAN_BATCH_SIZE,
        ...(cursorId
          ? {
              cursor: { id: cursorId },
              skip: 1,
            }
          : {}),
      });

      if (batch.length === 0) {
        break;
      }

      total += batch.length;

      for (const token of batch) {
        try {
          const result = await this.validateAndUpdateToken(token.id);
          if (result.isValid) {
            valid++;
          } else {
            invalid++;
            errors.push(`Token ${token.id} (${token.ownerType}): ${result.message}`);
          }

          // 避免速率限制，每個請求間隔 100ms
          await new Promise((resolve) => setTimeout(resolve, 100));
        } catch (error) {
          invalid++;
          errors.push(
            `Token ${token.id}: ${error instanceof Error ? error.message : "Unknown error"}`
          );
        }

        if (errors.length > 200) {
          errors.splice(0, errors.length - 200);
        }
      }

      cursorId = batch[batch.length - 1]?.id;
      if (batch.length < this.TOKEN_SCAN_BATCH_SIZE) {
        break;
      }
    }

    logger.info(
      "Token Validation",
      `Validation complete: ${valid} valid, ${invalid} invalid out of ${total}`
    );

    return {
      total,
      valid,
      invalid,
      errors,
    };
  }

  /**
   * 標記 Token 為特定狀態
   */
  async markTokenStatus(tokenId: string, status: TokenStatusType, reason?: string): Promise<void> {
    await prisma.twitchToken.update({
      where: { id: tokenId },
      data: {
        status,
        failureCount: status === TokenStatus.ACTIVE ? 0 : undefined,
      },
    });

    logger.info("Token Validation", `Token ${tokenId} marked as ${status}`, {
      reason,
    });
  }

  /**
   * 通過 Twitch User ID 標記 Token 狀態
   */
  async markTokenStatusByTwitchUserId(
    twitchUserId: string,
    ownerType: "streamer" | "viewer",
    status: TokenStatusType,
    reason?: string
  ): Promise<void> {
    const whereClause =
      ownerType === "streamer"
        ? {
            ownerType: "streamer",
            streamer: { twitchUserId },
          }
        : {
            ownerType: "viewer",
            viewer: { twitchUserId },
          };

    const token = await prisma.twitchToken.findFirst({
      where: whereClause,
    });

    if (token) {
      await this.markTokenStatus(token.id, status, reason);
    } else {
      logger.warn(
        "Token Validation",
        `No token found for ${ownerType} with Twitch ID: ${twitchUserId}`
      );
    }
  }

  /**
   * 獲取需要刷新的 Token 列表
   */
  async getTokensNeedingRefresh(): Promise<
    Array<{
      id: string;
      ownerType: string;
      refreshToken: string;
      streamerId: string | null;
      viewerId: string | null;
    }>
  > {
    const refreshLimit =
      Number.isFinite(this.TOKENS_NEEDING_REFRESH_LIMIT) && this.TOKENS_NEEDING_REFRESH_LIMIT > 0
        ? this.TOKENS_NEEDING_REFRESH_LIMIT
        : 500;

    return prisma.twitchToken.findMany({
      where: {
        status: TokenStatus.EXPIRED,
        refreshToken: { not: null },
        failureCount: { lt: this.MAX_FAILURE_COUNT },
      },
      select: {
        id: true,
        ownerType: true,
        refreshToken: true,
        streamerId: true,
        viewerId: true,
      },
      orderBy: { updatedAt: "asc" },
      take: refreshLimit,
    }) as Promise<
      Array<{
        id: string;
        ownerType: string;
        refreshToken: string;
        streamerId: string | null;
        viewerId: string | null;
      }>
    >;
  }

  /**
   * 獲取 Token 狀態統計
   */
  async getTokenStats(): Promise<Record<string, number>> {
    const stats = await prisma.twitchToken.groupBy({
      by: ["status"],
      _count: { status: true },
    });

    return stats.reduce(
      (acc, stat) => {
        acc[stat.status] = stat._count.status;
        return acc;
      },
      {} as Record<string, number>
    );
  }
}

// 單例導出
export const tokenValidationService = new TokenValidationService();
