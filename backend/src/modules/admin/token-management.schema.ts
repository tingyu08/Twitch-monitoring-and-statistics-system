import { z } from "zod";

/**
 * Token Management API 路由的 Zod 驗證 schemas
 */

// PATCH /api/admin/tokens/:tokenId/status - 更新 Token 狀態
export const updateTokenStatusSchema = {
  params: z.object({
    tokenId: z.string().uuid(),
  }),
  body: z.object({
    status: z.enum(["active", "expired", "revoked", "invalid"]),
    reason: z.string().max(500).optional(),
  }),
};
