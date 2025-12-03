import type { Request, Response, NextFunction } from "express";
import { verifyToken, type JWTPayload } from "./jwt.utils";

// 擴展 Express Request 類型以包含 user 資訊
export interface AuthRequest extends Request {
  user?: JWTPayload;
}

export function requireAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void {
  // 從 Cookie 讀取 auth_token（我們設定的 Cookie 名稱）
  const token = req.cookies?.auth_token;

  if (!token) {
    res.status(401).json({ error: "Unauthorized: No token provided" });
    return;
  }

  const payload = verifyToken(token);

  if (!payload) {
    res.status(401).json({ error: "Unauthorized: Invalid token" });
    return;
  }

  req.user = payload;
  next();
}

// 為了向後兼容，也導出 authMiddleware
export const authMiddleware = requireAuth;
