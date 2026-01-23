import { Router } from "express";
import { ViewerController } from "./viewer.controller";
import { requireAuth } from "../auth/auth.middleware";
import { validateRequest } from "../../middlewares/validate.middleware";
import * as schemas from "./viewer.schema";

import { ViewerMessageStatsController } from "./viewer-message-stats.controller";
import { ViewerPrivacyController } from "./viewer-privacy.controller";
import { chatListenerManager } from "../../services/chat-listener-manager";
import type { AuthRequest } from "../auth/auth.middleware";

const controller = new ViewerController();
const messageStatsController = new ViewerMessageStatsController();
const privacyController = new ViewerPrivacyController();
import { viewerLifetimeStatsController } from "./viewer-lifetime-stats.controller";
import { dashboardLayoutController } from "./dashboard-layout.controller";

const viewerApiRoutes = Router();
viewerApiRoutes.post(
  "/consent",
  (req, res, next) => requireAuth(req, res, next, ["viewer"]),
  validateRequest(schemas.consentSchema),
  controller.consent
);

viewerApiRoutes.get(
  "/stats/:channelId",
  (req, res, next) => requireAuth(req, res, next, ["viewer"]),
  controller.getChannelStats
);

// New Interaction Stats Route
viewerApiRoutes.get(
  "/:viewerId/channels/:channelId/message-stats",
  (req, res, next) => requireAuth(req, res, next, ["viewer"]),
  messageStatsController.getMessageStats
);

viewerApiRoutes.get(
  "/channels",
  (req, res, next) => requireAuth(req, res, next, ["viewer"]),
  controller.getChannels
);

// Privacy Control Routes (Legacy)
viewerApiRoutes.get(
  "/privacy/settings",
  (req, res, next) => requireAuth(req, res, next, ["viewer"]),
  privacyController.getPrivacySettings.bind(privacyController)
);

viewerApiRoutes.put(
  "/privacy/settings",
  (req, res, next) => requireAuth(req, res, next, ["viewer"]),
  validateRequest(schemas.updatePrivacySettingsSchema),
  privacyController.updatePrivacySettings.bind(privacyController)
);

viewerApiRoutes.get(
  "/privacy/data-summary",
  (req, res, next) => requireAuth(req, res, next, ["viewer"]),
  privacyController.getDataSummary.bind(privacyController)
);

viewerApiRoutes.delete(
  "/privacy/messages",
  (req, res, next) => requireAuth(req, res, next, ["viewer"]),
  privacyController.clearAllMessages.bind(privacyController)
);

viewerApiRoutes.delete(
  "/privacy/messages/:channelId",
  (req, res, next) => requireAuth(req, res, next, ["viewer"]),
  validateRequest(schemas.clearChannelMessagesSchema),
  privacyController.clearChannelMessages.bind(privacyController)
);

// Story 2.5: Privacy Consent Routes (Fine-grained)
viewerApiRoutes.get(
  "/privacy/consent",
  (req, res, next) => requireAuth(req, res, next, ["viewer"]),
  privacyController.getConsentSettings.bind(privacyController)
);

viewerApiRoutes.patch(
  "/privacy/consent",
  (req, res, next) => requireAuth(req, res, next, ["viewer"]),
  validateRequest(schemas.updateConsentSettingsSchema),
  privacyController.updateConsentSettings.bind(privacyController)
);

viewerApiRoutes.post(
  "/privacy/consent/accept-all",
  (req, res, next) => requireAuth(req, res, next, ["viewer"]),
  privacyController.acceptAllConsent.bind(privacyController)
);

// Story 2.5: Data Export Routes
viewerApiRoutes.post(
  "/privacy/export",
  (req, res, next) => requireAuth(req, res, next, ["viewer"]),
  validateRequest(schemas.requestExportSchema),
  privacyController.requestExport.bind(privacyController)
);

viewerApiRoutes.get(
  "/privacy/export/:jobId",
  (req, res, next) => requireAuth(req, res, next, ["viewer"]),
  privacyController.getExportStatus.bind(privacyController)
);

viewerApiRoutes.get(
  "/privacy/export/:jobId/download",
  (req, res, next) => requireAuth(req, res, next, ["viewer"]),
  privacyController.downloadExport.bind(privacyController)
);

// Story 2.5: Account Deletion Routes
viewerApiRoutes.post(
  "/privacy/delete-account",
  (req, res, next) => requireAuth(req, res, next, ["viewer"]),
  validateRequest(schemas.deleteAccountSchema),
  privacyController.requestDeleteAccount.bind(privacyController)
);

viewerApiRoutes.post(
  "/privacy/cancel-deletion",
  (req, res, next) => requireAuth(req, res, next, ["viewer"]),
  privacyController.cancelDeletion.bind(privacyController)
);

viewerApiRoutes.get(
  "/privacy/deletion-status",
  (req, res, next) => requireAuth(req, res, next, ["viewer"]),
  privacyController.getDeletionStatus.bind(privacyController)
);

// Lifetime Stats Routes
viewerApiRoutes.get(
  "/:viewerId/channels/:channelId/lifetime-stats",
  (req, res, next) => requireAuth(req, res, next, ["viewer"]),
  viewerLifetimeStatsController.getLifetimeStats
);

// Dashboard Layout Routes
viewerApiRoutes.post(
  "/dashboard-layout",
  (req, res, next) => requireAuth(req, res, next, ["viewer"]),
  validateRequest(schemas.saveDashboardLayoutSchema),
  dashboardLayoutController.saveLayout
);

viewerApiRoutes.get(
  "/dashboard-layout/:channelId",
  (req, res, next) => requireAuth(req, res, next, ["viewer"]),
  dashboardLayoutController.getLayout
);

viewerApiRoutes.delete(
  "/dashboard-layout/:channelId",
  (req, res, next) => requireAuth(req, res, next, ["viewer"]),
  dashboardLayoutController.resetLayout
);

// 設定監聽頻道（前端分頁換頁時調用）
viewerApiRoutes.post(
  "/listen-channels",
  (req, res, next) => requireAuth(req, res, next, ["viewer"]),
  validateRequest(schemas.listenChannelsSchema),
  async (req: AuthRequest, res) => {
    try {
      const { channels } = req.body as {
        channels: Array<{ channelName: string; isLive: boolean }>;
      };

      if (!channels || !Array.isArray(channels)) {
        return res.status(400).json({ error: "channels array is required" });
      }

      // 只處理開台的頻道
      const liveChannels = channels.filter((ch) => ch.isLive);

      // 請求監聽這些頻道
      const results = await Promise.all(
        liveChannels.map((ch) =>
          chatListenerManager.requestListen(ch.channelName, {
            isLive: true,
            priority: 10, // 用戶正在查看的頁面優先級最高
          })
        )
      );

      const successCount = results.filter((r) => r).length;

      return res.json({
        success: true,
        message: `正在監聽 ${successCount}/${liveChannels.length} 個開台頻道`,
        listening: liveChannels.filter((_, i) => results[i]).map((ch) => ch.channelName),
      });
    } catch (error) {
      console.error("Error setting listen channels:", error);
      return res.status(500).json({ error: "Internal Server Error" });
    }
  }
);

export { viewerApiRoutes };
