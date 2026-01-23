import { z } from "zod";

/**
 * Viewer API 路由的 Zod 驗證 schemas
 */

// POST /api/viewer/consent - 同意隱私政策
export const consentSchema = {
  body: z.object({
    consent: z.boolean(),
  }),
};

// POST /api/viewer/listen-channels - 設定監聽頻道
export const listenChannelsSchema = {
  body: z.object({
    channels: z.array(
      z.object({
        channelName: z.string().min(1),
        isLive: z.boolean(),
      })
    ),
  }),
};

// PATCH /api/viewer/privacy/consent - 更新同意設定
export const updateConsentSettingsSchema = {
  body: z.object({
    trackWatchTime: z.boolean().optional(),
    trackChatActivity: z.boolean().optional(),
    allowDataExport: z.boolean().optional(),
    allowDataDeletion: z.boolean().optional(),
  }),
};

// PUT /api/viewer/privacy/settings - 更新隱私設定
export const updatePrivacySettingsSchema = {
  body: z.object({
    dataRetentionDays: z.number().int().min(1).max(730).optional(),
    allowPublicProfile: z.boolean().optional(),
    allowStatsSharing: z.boolean().optional(),
  }),
};

// DELETE /api/viewer/privacy/messages/:channelId - 清除頻道訊息
export const clearChannelMessagesSchema = {
  params: z.object({
    channelId: z.string().uuid(),
  }),
};

// POST /api/viewer/privacy/export - 請求資料匯出
export const requestExportSchema = {
  body: z.object({
    format: z.enum(["json", "csv"]).optional(),
  }),
};

// GET /api/viewer/privacy/export/:jobId - 取得匯出狀態
export const getExportStatusSchema = {
  params: z.object({
    jobId: z.string().uuid(),
  }),
};

// POST /api/viewer/privacy/delete-account - 請求刪除帳戶
export const deleteAccountSchema = {
  body: z.object({
    confirmPassword: z.string().min(1).optional(),
    reason: z.string().max(500).optional(),
  }),
};

// POST /api/viewer/dashboard-layout - 儲存儀表板佈局
export const saveDashboardLayoutSchema = {
  body: z.object({
    channelId: z.string().uuid(),
    layout: z.any(), // 允許任意 JSON 結構（包括陣列）
  }),
};

// GET /api/viewer/dashboard-layout/:channelId - 取得佈局
export const getDashboardLayoutSchema = {
  params: z.object({
    channelId: z.string().uuid(),
  }),
};
