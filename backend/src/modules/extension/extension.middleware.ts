/**
 * Extension Authentication Middleware
 * P0 Security: Use dedicated JWT instead of raw viewerId
 */

import { Request, Response, NextFunction } from "express";
import { verifyExtensionToken, type ExtensionJWTPayload } from "../auth/jwt.utils";
import { prisma } from "../../db/prisma";

// Extend Express Request to include extension user
export interface ExtensionAuthRequest extends Request {
  extensionUser?: {
    viewerId: string;
  };
}

/**
 * Middleware to authenticate extension requests using dedicated JWT
 * Replaces the old raw viewerId authentication
 */
export async function extensionAuthMiddleware(
  req: ExtensionAuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Extract token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({ error: "Missing authorization header" });
      return;
    }

    const token = authHeader.substring(7); // Remove "Bearer " prefix
    if (!token) {
      res.status(401).json({ error: "Invalid token format" });
      return;
    }

    // Verify JWT token
    const payload: ExtensionJWTPayload | null = verifyExtensionToken(token);
    if (!payload) {
      res.status(401).json({ error: "Invalid or expired extension token" });
      return;
    }

    // Validate that viewer exists in database
    const viewer = await prisma.viewer.findUnique({
      where: { id: payload.viewerId },
      select: { id: true },
    });

    if (!viewer) {
      res.status(401).json({ error: "Viewer not found" });
      return;
    }

    // Attach viewer info to request
    req.extensionUser = {
      viewerId: payload.viewerId,
    };

    next();
  } catch (error) {
    res.status(500).json({ error: "Authentication error" });
  }
}
