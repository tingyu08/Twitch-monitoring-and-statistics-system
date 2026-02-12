import { Router } from "express";
import { AuthController, clearAuthCookies } from "./auth.controller";
import { requireAuth, type AuthRequest } from "./auth.middleware";
import type { Response } from "express";
import { prisma } from "../../db/prisma";
import { getFollowedChannels } from "../viewer/viewer.service";
import { logger } from "../../utils/logger";

// 建立 AuthController 實例
const authController = new AuthController();

// OAuth 路由（公開）
const oauthRouter = Router();
oauthRouter.get("/login", authController.login);
oauthRouter.get("/callback", authController.twitchCallback);
oauthRouter.post("/exchange", authController.exchange);

// API 路由（需要認證）
const apiRouter = Router();
apiRouter.get("/me", (req, res, next) => requireAuth(req, res, next), getMeHandler);
apiRouter.post("/logout", (req, res, next) => requireAuth(req, res, next), logoutHandler);
apiRouter.post("/refresh", authController.refresh);

// Handler 函數（保留原有函數供測試使用）
export async function getMeHandler(req: AuthRequest, res: Response): Promise<void> {
  try {
    let consentedAt: string | null = null;
    let consentVersion: number | null = null;

    if (req.user?.role === "viewer" && req.user.viewerId) {
      const viewerRecord = await prisma.viewer.findUnique({
        where: { id: req.user.viewerId },
        select: { consentedAt: true, consentVersion: true },
      });

      consentedAt = viewerRecord?.consentedAt?.toISOString() ?? null;
      consentVersion = viewerRecord?.consentVersion ?? null;

      // P1 優化：預熱 channels 快取，讓使用者進入 dashboard 時資料已經準備好
      // 使用 Promise 但不等待，讓它在背景執行，不阻塞回應
      getFollowedChannels(req.user.viewerId)
        .then(() => {
          logger.info("AuthAPI", `Preheated channels cache for viewer ${req.user.viewerId}`);
        })
        .catch((err) => {
          logger.warn("AuthAPI", "Failed to preheat channels cache:", err);
        });
    }

    const response = {
      streamerId: req.user?.streamerId,
      viewerId: req.user?.viewerId,
      twitchUserId: req.user?.twitchUserId,
      displayName: req.user?.displayName,
      avatarUrl: req.user?.avatarUrl,
      channelUrl: req.user?.channelUrl,
      role: req.user?.role,
      consentedAt: consentedAt ?? req.user?.consentedAt ?? null,
      consentVersion: consentVersion ?? req.user?.consentVersion ?? null,
    };

    res.json(response);
  } catch {
    res.status(500).json({ error: "Failed to load user profile" });
  }
}

export async function logoutHandler(req: AuthRequest, res: Response): Promise<void> {
  clearAuthCookies(res);

  if (req.user?.role === "viewer" && req.user.viewerId) {
    await prisma.twitchToken.deleteMany({
      where: { viewerId: req.user.viewerId },
    });
  } else if (req.user?.role === "streamer" && req.user.streamerId) {
    await prisma.twitchToken.deleteMany({
      where: { streamerId: req.user.streamerId },
    });
  }

  res.json({ message: "Logged out successfully" });
}

// 匯出路由和函數供測試使用
export { requireAuth };
export const oauthRoutes = oauthRouter;
export const apiRoutes = apiRouter;
