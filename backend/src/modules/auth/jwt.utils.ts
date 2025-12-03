import jwt from "jsonwebtoken";
import { env } from "../../config/env";

export interface JWTPayload {
  streamerId: string;
  twitchUserId: string;
  displayName: string;
  avatarUrl: string;
  channelUrl: string;
}

const JWT_EXPIRES_IN = "7d"; // 7 天有效期

export function signToken(payload: JWTPayload): string {
  return jwt.sign(payload, env.jwtSecret, {
    expiresIn: JWT_EXPIRES_IN,
  });
}

export function verifyToken(token: string): JWTPayload | null {
  try {
    const decoded = jwt.verify(token, env.jwtSecret) as JWTPayload;
    return decoded;
  } catch (error) {
    return null;
  }
}

