import jwt from "jsonwebtoken";
import { env } from "../../config/env";

export type UserRole = "streamer" | "viewer";
export type TokenType = "access" | "refresh" | "extension";

export interface JWTPayload {
  streamerId?: string;
  viewerId?: string;
  twitchUserId: string;
  displayName: string;
  avatarUrl?: string;
  channelUrl?: string;
  consentedAt?: string | null;
  consentVersion?: number | null;
  tokenVersion?: number; // 用於 Token 失效機制
  role: UserRole;
  tokenType: TokenType;
}

// P0 Security: Dedicated Extension JWT payload (minimal data exposure)
export interface ExtensionJWTPayload {
  viewerId: string;
  tokenVersion: number; // P1 Fix: 加入 tokenVersion 用於 Token 失效機制
  tokenType: "extension";
  iat?: number;
  exp?: number;
}

const ACCESS_EXPIRES_IN = "1h"; // Story 2.1 要求
const REFRESH_EXPIRES_IN = "7d";
const EXTENSION_EXPIRES_IN = "1h"; // P0 Security: Extension tokens expire in 1 hour

export function signAccessToken(payload: Omit<JWTPayload, "tokenType">): string {
  return jwt.sign({ ...payload, tokenType: "access" as const }, env.jwtSecret, {
    expiresIn: ACCESS_EXPIRES_IN,
  });
}

export function signRefreshToken(payload: Omit<JWTPayload, "tokenType">): string {
  return jwt.sign({ ...payload, tokenType: "refresh" as const }, env.jwtSecret, {
    expiresIn: REFRESH_EXPIRES_IN,
  });
}

function verifyToken(token: string, expectedType: TokenType): JWTPayload | null {
  try {
    const decoded = jwt.verify(token, env.jwtSecret) as JWTPayload;
    if (decoded.tokenType !== expectedType) return null;
    return decoded;
  } catch {
    return null;
  }
}

export function verifyAccessToken(token: string): JWTPayload | null {
  return verifyToken(token, "access");
}

export function verifyRefreshToken(token: string): JWTPayload | null {
  return verifyToken(token, "refresh");
}

// P0 Security: Extension-specific JWT functions
// P1 Fix: 加入 tokenVersion 參數
export function signExtensionToken(viewerId: string, tokenVersion: number): string {
  const payload: Omit<ExtensionJWTPayload, "iat" | "exp"> = {
    viewerId,
    tokenVersion,
    tokenType: "extension",
  };
  return jwt.sign(payload, env.jwtSecret, {
    expiresIn: EXTENSION_EXPIRES_IN,
  });
}

export function verifyExtensionToken(token: string): ExtensionJWTPayload | null {
  try {
    const decoded = jwt.verify(token, env.jwtSecret) as ExtensionJWTPayload;
    if (decoded.tokenType !== "extension") return null;
    return decoded;
  } catch {
    return null;
  }
}
