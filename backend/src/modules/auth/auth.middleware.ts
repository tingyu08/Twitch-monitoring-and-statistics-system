import type {
  Request,
  Response,
  NextFunction,
  ParamsDictionary,
  Query,
} from "express-serve-static-core";
import { verifyAccessToken, type JWTPayload, type UserRole } from "./jwt.utils";

// 擴展 Express Request 類型以包含 user 資訊
export interface AuthRequest {
  user?: JWTPayload;
  params: ParamsDictionary;
  query: Query;
  body: unknown;
  cookies: Record<string, string>;
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
