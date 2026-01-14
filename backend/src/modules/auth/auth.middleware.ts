import type { Request, Response, NextFunction } from "express";
import { verifyAccessToken, type JWTPayload, type UserRole } from "./jwt.utils";
import { prisma } from "../../db/prisma";

// 擴展 Express Request 類型以包含 user 資訊
// 不重新定義 params/query/body，讓它們繼承自 Express Request
export interface AuthRequest extends Request {
  user?: JWTPayload;
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
      return res.status(401).json({ error: "Invalid token" });
    }

    // 驗證 tokenVersion（只對 Viewer 進行驗證）
    if (decoded.viewerId && decoded.tokenVersion !== undefined) {
      const viewer = await prisma.viewer.findUnique({
        where: { id: decoded.viewerId },
        select: { tokenVersion: true },
      });

      if (!viewer || viewer.tokenVersion !== decoded.tokenVersion) {
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
