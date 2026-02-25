import type { Request, Response, NextFunction } from "express";
import { verifyAccessToken, type JWTPayload, type UserRole } from "./jwt.utils";
import { cacheManager } from "../../utils/cache-manager";
import { CacheTags } from "../../constants";
import { getViewerAuthSnapshotById } from "../viewer/viewer-auth-snapshot.service";

// 擴展 Express Request 類型以包含 user 資訊
export interface AuthRequest extends Request {
  user?: JWTPayload;
}

async function requireAuthHandler(
  req: Request,
  res: Response,
  next: NextFunction,
  allowedRoles: UserRole[] = []
) {
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
      // P1 Opt: 快取 Token Version 查詢，避免每個請求都打擊遠端 Turso DB
      // 這大幅減少了 Round Trip Latency (N requests * RTT)
      const cacheKey = `auth:viewer:${decoded.viewerId}:token_version`;

      const currentVersion = await cacheManager.getOrSetWithTags(
        cacheKey,
        async () => {
          const snapshot = await getViewerAuthSnapshotById(decoded.viewerId);
          return snapshot?.tokenVersion ?? null;
        },
        60, // 快取 60 秒
        [`viewer:${decoded.viewerId}`, CacheTags.AUTH_TOKEN_VERSION]
      );

      if (currentVersion === null || currentVersion !== decoded.tokenVersion) {
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
}

type RequireAuthMiddleware = (req: Request, res: Response, next: NextFunction) => Promise<Response | void>;

export function requireAuth(allowedRoles?: UserRole[]): RequireAuthMiddleware;
export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
  allowedRoles?: UserRole[]
): Promise<Response | void>;
export function requireAuth(
  first: Request | UserRole[] = [],
  res?: Response,
  next?: NextFunction,
  allowedRoles: UserRole[] = []
): Promise<Response | void> | RequireAuthMiddleware {
  if (Array.isArray(first)) {
    const roles = first;
    return (req: Request, response: Response, nextFn: NextFunction) =>
      requireAuthHandler(req, response, nextFn, roles);
  }

  return requireAuthHandler(first as Request, res as Response, next as NextFunction, allowedRoles);
}

// 為了向後兼容，也導出 authMiddleware
export const authMiddleware = requireAuth;
