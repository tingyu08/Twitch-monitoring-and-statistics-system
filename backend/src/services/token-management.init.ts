/**
 * Token Management Initializer
 *
 * 初始化 Token 管理相關的回調和排程
 * - 設定 Token 失敗時的自動標記機制
 * - 註冊 Token 驗證排程任務
 */

import { PrismaClient } from "@prisma/client";
import { twurpleAuthService } from "./twurple-auth.service";
import {
  tokenValidationService,
  TokenStatus,
  type TokenStatusType,
} from "./token-validation.service";
import { logger } from "../utils/logger";

const prisma = new PrismaClient();

/**
 * 初始化 Token 管理系統
 */
export async function initializeTokenManagement(): Promise<void> {
  logger.info("Token Management", "Initializing token management system");

  // 設定 Token 刷新失敗回調
  twurpleAuthService.setOnTokenFailure(async (userId, error, reason) => {
    logger.warn(
      "Token Management",
      `Token failure detected for user ${userId}: ${reason}`,
      { error: error.message }
    );

    // 根據失敗原因決定狀態
    let status: TokenStatusType;
    switch (reason) {
      case "revoked":
        status = TokenStatus.REVOKED;
        break;
      case "invalid_token":
        status = TokenStatus.INVALID;
        break;
      case "refresh_failed":
      default:
        status = TokenStatus.EXPIRED;
        break;
    }

    // 標記 Token 狀態
    try {
      // 先嘗試查找 Viewer Token
      const viewerToken = await prisma.twitchToken.findFirst({
        where: {
          ownerType: "viewer",
          viewer: { twitchUserId: userId },
        },
      });

      if (viewerToken) {
        await tokenValidationService.markTokenStatus(
          viewerToken.id,
          status,
          `Refresh failure: ${reason}`
        );
        return;
      }

      // 再嘗試查找 Streamer Token
      const streamerToken = await prisma.twitchToken.findFirst({
        where: {
          ownerType: "streamer",
          streamer: { twitchUserId: userId },
        },
      });

      if (streamerToken) {
        await tokenValidationService.markTokenStatus(
          streamerToken.id,
          status,
          `Refresh failure: ${reason}`
        );
        return;
      }

      logger.warn(
        "Token Management",
        `No token found for Twitch user ${userId}`
      );
    } catch (dbError) {
      logger.error(
        "Token Management",
        `Failed to update token status for user ${userId}`,
        dbError
      );
    }
  });

  logger.info("Token Management", "Token management system initialized");
}

/**
 * 獲取 Token 管理系統狀態
 */
export async function getTokenManagementStatus(): Promise<{
  authProviderCount: number;
  tokenStats: Record<string, number>;
  activeUserIds: string[];
}> {
  const authStatus = twurpleAuthService.getStatus();
  const tokenStats = await tokenValidationService.getTokenStats();

  return {
    authProviderCount: authStatus.userProviderCount,
    tokenStats,
    activeUserIds: twurpleAuthService.getActiveUserIds(),
  };
}
