import { Router } from "express";
import { ViewerController } from "./viewer.controller";
import { requireAuth } from "../auth/auth.middleware";

import { ViewerMessageStatsController } from "./viewer-message-stats.controller";
import { ViewerPrivacyController } from "./viewer-privacy.controller";

const controller = new ViewerController();
const messageStatsController = new ViewerMessageStatsController();
const privacyController = new ViewerPrivacyController();
import { viewerLifetimeStatsController } from "./viewer-lifetime-stats.controller";
import { dashboardLayoutController } from "./dashboard-layout.controller";

const viewerApiRoutes = Router();
viewerApiRoutes.post(
  "/consent",
  (req, res, next) => requireAuth(req, res, next, ["viewer"]),
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

export { viewerApiRoutes };
