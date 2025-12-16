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

// Privacy Control Routes
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
