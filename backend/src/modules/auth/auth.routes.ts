import { Router } from "express";
import { twitchLoginHandler, twitchCallbackHandler } from "./auth.controller";
import { requireAuth, type AuthRequest } from "./auth.middleware";
import type { Response } from "express";

// OAuth 路由（公開）
const oauthRouter = Router();
oauthRouter.get("/login", twitchLoginHandler);
oauthRouter.get("/callback", twitchCallbackHandler);

// API 路由（需要認證）
const apiRouter = Router();
apiRouter.get("/me", requireAuth, getMeHandler);
apiRouter.post("/logout", requireAuth, logoutHandler);

// Handler 函數
export function getMeHandler(req: AuthRequest, res: Response): void {
  // requireAuth 中間件已確保 req.user 存在
  res.json({
    streamerId: req.user!.streamerId,
    twitchUserId: req.user!.twitchUserId,
    displayName: req.user!.displayName,
    avatarUrl: req.user!.avatarUrl,
    channelUrl: req.user!.channelUrl,
  });
}

export function logoutHandler(_req: AuthRequest, res: Response): void {
  res.clearCookie("auth_token", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
  res.json({ message: "Logged out successfully" });
}

// 匯出路由和函數供測試使用
export { requireAuth };
export const oauthRoutes = oauthRouter;
export const apiRoutes = apiRouter;
