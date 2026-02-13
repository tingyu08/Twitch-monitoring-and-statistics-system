import { Router } from "express";
import { ViewerController } from "./viewer.controller";
import { requireAuth } from "../auth/auth.middleware";
import { validateRequest } from "../../middlewares/validate.middleware";
import * as schemas from "./viewer.schema";

import { ViewerMessageStatsController } from "./viewer-message-stats.controller";
import { ViewerPrivacyController } from "./viewer-privacy.controller";
import { chatListenerManager } from "../../services/chat-listener-manager";
import type { AuthRequest } from "../auth/auth.middleware";
import { logger } from "../../utils/logger";
import { semiStaticCache, dynamicCache, noCache } from "../../middlewares/cache-control.middleware";

const controller = new ViewerController();
const messageStatsController = new ViewerMessageStatsController();
const privacyController = new ViewerPrivacyController();
import { viewerLifetimeStatsController } from "./viewer-lifetime-stats.controller";
import { dashboardLayoutController } from "./dashboard-layout.controller";

const viewerApiRoutes = Router();
viewerApiRoutes.post(
  "/consent",
  requireAuth(["viewer"]),
  validateRequest(schemas.consentSchema),
  controller.consent
);

viewerApiRoutes.get(
  "/stats/:channelId",
  requireAuth(["viewer"]),
  dynamicCache, // P2 優化：10 秒快取
  controller.getChannelStats
);

// P0 BFF Endpoint: 聚合詳細頁所有資料
viewerApiRoutes.get(
  "/channel-detail/:channelId",
  requireAuth(["viewer"]),
  dynamicCache, // P2 優化：10 秒快取（BFF 聚合端點）
  controller.getChannelDetailAll
);

// New Interaction Stats Route
viewerApiRoutes.get(
  "/:viewerId/channels/:channelId/message-stats",
  requireAuth(["viewer"]),
  dynamicCache, // P2 優化：10 秒快取
  messageStatsController.getMessageStats
);

viewerApiRoutes.get(
  "/channels",
  requireAuth(["viewer"]),
  semiStaticCache, // P2 優化：30 秒快取
  controller.getChannels
);

// Privacy Control Routes (Legacy)
viewerApiRoutes.get(
  "/privacy/settings",
  requireAuth(["viewer"]),
  noCache, // P2 優化：隱私資料不快取
  privacyController.getPrivacySettings.bind(privacyController)
);

viewerApiRoutes.put(
  "/privacy/settings",
  requireAuth(["viewer"]),
  validateRequest(schemas.updatePrivacySettingsSchema),
  noCache, // P2 優化：隱私資料不快取
  privacyController.updatePrivacySettings.bind(privacyController)
);

viewerApiRoutes.get(
  "/privacy/data-summary",
  requireAuth(["viewer"]),
  noCache, // P2 優化：隱私資料不快取
  privacyController.getDataSummary.bind(privacyController)
);

viewerApiRoutes.delete(
  "/privacy/messages",
  requireAuth(["viewer"]),
  privacyController.clearAllMessages.bind(privacyController)
);

viewerApiRoutes.delete(
  "/privacy/messages/:channelId",
  requireAuth(["viewer"]),
  validateRequest(schemas.clearChannelMessagesSchema),
  privacyController.clearChannelMessages.bind(privacyController)
);

// Story 2.5: Privacy Consent Routes (Fine-grained)
viewerApiRoutes.get(
  "/pref/status",
  requireAuth(["viewer"]),
  privacyController.getConsentSettings.bind(privacyController)
);

viewerApiRoutes.patch(
  "/pref/status",
  requireAuth(["viewer"]),
  validateRequest(schemas.updateConsentSettingsSchema),
  privacyController.updateConsentSettings.bind(privacyController)
);

viewerApiRoutes.post(
  "/pref/opt-all",
  requireAuth(["viewer"]),
  privacyController.acceptAllConsent.bind(privacyController)
);

// Story 2.5: Data Export Routes
viewerApiRoutes.post(
  "/privacy/export",
  requireAuth(["viewer"]),
  validateRequest(schemas.requestExportSchema),
  privacyController.requestExport.bind(privacyController)
);

viewerApiRoutes.get(
  "/privacy/export/:jobId",
  requireAuth(["viewer"]),
  privacyController.getExportStatus.bind(privacyController)
);

viewerApiRoutes.get(
  "/privacy/export/:jobId/download",
  requireAuth(["viewer"]),
  privacyController.downloadExport.bind(privacyController)
);

// Story 2.5: Account Deletion Routes
viewerApiRoutes.post(
  "/privacy/delete-account",
  requireAuth(["viewer"]),
  validateRequest(schemas.deleteAccountSchema),
  privacyController.requestDeleteAccount.bind(privacyController)
);

viewerApiRoutes.post(
  "/privacy/cancel-deletion",
  requireAuth(["viewer"]),
  privacyController.cancelDeletion.bind(privacyController)
);

viewerApiRoutes.get(
  "/privacy/deletion-status",
  requireAuth(["viewer"]),
  privacyController.getDeletionStatus.bind(privacyController)
);

// Lifetime Stats Routes
viewerApiRoutes.get(
  "/:viewerId/channels/:channelId/lifetime-stats",
  requireAuth(["viewer"]),
  viewerLifetimeStatsController.getLifetimeStats
);

// Dashboard Layout Routes
viewerApiRoutes.post(
  "/dashboard-layout",
  requireAuth(["viewer"]),
  validateRequest(schemas.saveDashboardLayoutSchema),
  dashboardLayoutController.saveLayout
);

viewerApiRoutes.get(
  "/dashboard-layout/:channelId",
  requireAuth(["viewer"]),
  dashboardLayoutController.getLayout
);

viewerApiRoutes.delete(
  "/dashboard-layout/:channelId",
  requireAuth(["viewer"]),
  dashboardLayoutController.resetLayout
);

// 設定監聽頻道（前端分頁換頁時調用）
viewerApiRoutes.post(
  "/listen-channels",
  requireAuth(["viewer"]),
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
      logger.error("ViewerAPI", "Error setting listen channels:", error);
      return res.status(500).json({ error: "Internal Server Error" });
    }
  }
);

export { viewerApiRoutes };
