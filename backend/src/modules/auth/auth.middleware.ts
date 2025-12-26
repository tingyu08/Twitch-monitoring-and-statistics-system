import type { Request, Response, NextFunction } from "express";
import { verifyAccessToken, type JWTPayload, type UserRole } from "./jwt.utils";
import { prisma } from "../../db/prisma";

// 擴展 Express Request 類型以包含 user 資訊
// 注意：顯式聲明所有屬性以確保生產環境相容性
export interface AuthRequest extends Request {
  user?: JWTPayload;
  // Express Request 屬性 (顯式聲明以確保類型解析)
  params: Record<string, string>;
  query: Record<string, string | string[] | undefined>;
  body: unknown;
}

export const requireAuth = async (
  req: Request,
  res: Response,
  next: NextFunction,
  allowedRoles: UserRole[] = []
) => {
  try {
    const token = req.cookies.auth_token;

    if (!token) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const decoded = verifyAccessToken(token);
    if (!decoded) {
      console.log("[Auth] Token verification failed");
      return res.status(401).json({ error: "Invalid token" });
    }

    // 驗證 tokenVersion（只對 Viewer 進行驗證）
    if (decoded.viewerId && decoded.tokenVersion !== undefined) {
      const viewer = await prisma.viewer.findUnique({
        where: { id: decoded.viewerId },
        select: { tokenVersion: true },
      });

      if (!viewer || viewer.tokenVersion !== decoded.tokenVersion) {
        console.log("[Auth] Token version mismatch, user logged out");
        return res.status(401).json({ error: "Token expired" });
      }
    }

    (req as AuthRequest).user = decoded;

    // Check role if specified
    if (allowedRoles.length > 0) {
      const userRole = decoded.role;

      // Streamer 角色自動包含 Viewer 權限 (Super Role)
      const hasPermission =
        allowedRoles.includes(userRole) ||
        (userRole === "streamer" && allowedRoles.includes("viewer"));

      if (!hasPermission) {
        return res.status(403).json({ error: "Forbidden" });
      }
    }

    next();
  } catch {
    return res.status(401).json({ error: "Unauthorized" });
  }
};

// 為了向後兼容，也導出 authMiddleware
export const authMiddleware = requireAuth;
