import { z } from "zod";

/**
 * Extension API 路由的 Zod 驗證 schemas
 */

// POST /api/extension/heartbeat - 擴充功能心跳
export const heartbeatSchema = {
  body: z.object({
    channelName: z.string().min(1),
    timestamp: z.string().min(1),
    duration: z.number().int().positive().max(3600),
  }),
};
