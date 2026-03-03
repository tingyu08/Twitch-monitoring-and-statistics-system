describe("viewer.routes wiring", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it("registers all viewer routes with middleware and handlers", () => {
    jest.isolateModules(() => {
      const post = jest.fn();
      const get = jest.fn();
      const put = jest.fn();
      const patch = jest.fn();
      const del = jest.fn();
      const routerMock = { post, get, put, patch, delete: del };

      const authMiddleware = jest.fn();
      const requireAuth = jest.fn(() => authMiddleware);

      const consentSchema = { name: "consentSchema" };
      const updatePrivacySettingsSchema = { name: "updatePrivacySettingsSchema" };
      const clearChannelMessagesSchema = { name: "clearChannelMessagesSchema" };
      const updateConsentSettingsSchema = { name: "updateConsentSettingsSchema" };
      const requestExportSchema = { name: "requestExportSchema" };
      const deleteAccountSchema = { name: "deleteAccountSchema" };
      const saveDashboardLayoutSchema = { name: "saveDashboardLayoutSchema" };
      const listenChannelsSchema = { name: "listenChannelsSchema" };

      const validateRequest = jest.fn((schema: unknown) => ({ schema }));
      const dynamicCache = { name: "dynamicCache" };
      const semiStaticCache = { name: "semiStaticCache" };
      const noCache = { name: "noCache" };

      const viewerController = {
        consent: jest.fn(),
        getChannelStats: jest.fn(),
        getChannelDetailAll: jest.fn(),
        getChannels: jest.fn(),
      };

      const messageStatsController = {
        getMessageStats: jest.fn(),
      };

      const privacyController = {
        getPrivacySettings: function getPrivacySettings() {
          return undefined;
        },
        updatePrivacySettings: function updatePrivacySettings() {
          return undefined;
        },
        getDataSummary: function getDataSummary() {
          return undefined;
        },
        clearAllMessages: function clearAllMessages() {
          return undefined;
        },
        clearChannelMessages: function clearChannelMessages() {
          return undefined;
        },
        getConsentSettings: function getConsentSettings() {
          return undefined;
        },
        updateConsentSettings: function updateConsentSettings() {
          return undefined;
        },
        acceptAllConsent: function acceptAllConsent() {
          return undefined;
        },
        requestExport: function requestExport() {
          return undefined;
        },
        getExportStatus: function getExportStatus() {
          return undefined;
        },
        downloadExport: function downloadExport() {
          return undefined;
        },
        requestDeleteAccount: function requestDeleteAccount() {
          return undefined;
        },
        cancelDeletion: function cancelDeletion() {
          return undefined;
        },
        getDeletionStatus: function getDeletionStatus() {
          return undefined;
        },
      };

      const lifetimeStatsController = {
        getLifetimeStats: jest.fn(),
      };

      const layoutController = {
        saveLayout: jest.fn(),
        getLayout: jest.fn(),
        resetLayout: jest.fn(),
      };

      jest.doMock("express", () => ({
        Router: jest.fn(() => routerMock),
      }));
      jest.doMock("../../auth/auth.middleware", () => ({ requireAuth }));
      jest.doMock("../../../middlewares/validate.middleware", () => ({ validateRequest }));
      jest.doMock("../viewer.schema", () => ({
        consentSchema,
        updatePrivacySettingsSchema,
        clearChannelMessagesSchema,
        updateConsentSettingsSchema,
        requestExportSchema,
        deleteAccountSchema,
        saveDashboardLayoutSchema,
        listenChannelsSchema,
      }));
      jest.doMock("../viewer.controller", () => ({
        ViewerController: jest.fn(() => viewerController),
      }));
      jest.doMock("../viewer-message-stats.controller", () => ({
        ViewerMessageStatsController: jest.fn(() => messageStatsController),
      }));
      jest.doMock("../viewer-privacy.controller", () => ({
        ViewerPrivacyController: jest.fn(() => privacyController),
      }));
      jest.doMock("../viewer-lifetime-stats.controller", () => ({
        viewerLifetimeStatsController: lifetimeStatsController,
      }));
      jest.doMock("../dashboard-layout.controller", () => ({
        dashboardLayoutController: layoutController,
      }));
      jest.doMock("../../../middlewares/cache-control.middleware", () => ({
        dynamicCache,
        semiStaticCache,
        noCache,
      }));
      jest.doMock("../../../services/chat-listener-manager", () => ({
        chatListenerManager: { requestListen: jest.fn() },
      }));
      jest.doMock("../../../utils/logger", () => ({
        logger: { error: jest.fn() },
      }));

      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { viewerApiRoutes } = require("../viewer.routes");

      expect(viewerApiRoutes).toBe(routerMock);
      expect(requireAuth).toHaveBeenCalledTimes(24);
      expect(requireAuth).toHaveBeenNthCalledWith(1, ["viewer"]);

      expect(post).toHaveBeenCalledTimes(7);
      expect(get).toHaveBeenCalledTimes(12);
      expect(put).toHaveBeenCalledTimes(1);
      expect(patch).toHaveBeenCalledTimes(1);
      expect(del).toHaveBeenCalledTimes(3);

      expect(post.mock.calls.map((call: unknown[]) => call[0])).toEqual([
        "/consent",
        "/pref/opt-all",
        "/privacy/export",
        "/privacy/delete-account",
        "/privacy/cancel-deletion",
        "/dashboard-layout",
        "/listen-channels",
      ]);

      expect(get.mock.calls.map((call: unknown[]) => call[0])).toEqual([
        "/stats/:channelId",
        "/channel-detail/:channelId",
        "/:viewerId/channels/:channelId/message-stats",
        "/channels",
        "/privacy/settings",
        "/privacy/data-summary",
        "/pref/status",
        "/privacy/export/:jobId",
        "/privacy/export/:jobId/download",
        "/privacy/deletion-status",
        "/:viewerId/channels/:channelId/lifetime-stats",
        "/dashboard-layout/:channelId",
      ]);

      expect(put).toHaveBeenCalledWith(
        "/privacy/settings",
        authMiddleware,
        { schema: updatePrivacySettingsSchema },
        noCache,
        expect.any(Function)
      );

      expect(patch).toHaveBeenCalledWith(
        "/pref/status",
        authMiddleware,
        { schema: updateConsentSettingsSchema },
        expect.any(Function)
      );

      expect(del.mock.calls.map((call: unknown[]) => call[0])).toEqual([
        "/privacy/messages",
        "/privacy/messages/:channelId",
        "/dashboard-layout/:channelId",
      ]);

      expect(post).toHaveBeenCalledWith(
        "/consent",
        authMiddleware,
        { schema: consentSchema },
        viewerController.consent
      );
      expect(get).toHaveBeenCalledWith(
        "/stats/:channelId",
        authMiddleware,
        dynamicCache,
        viewerController.getChannelStats
      );
      expect(get).toHaveBeenCalledWith(
        "/channel-detail/:channelId",
        authMiddleware,
        dynamicCache,
        viewerController.getChannelDetailAll
      );
      expect(get).toHaveBeenCalledWith(
        "/:viewerId/channels/:channelId/message-stats",
        authMiddleware,
        dynamicCache,
        messageStatsController.getMessageStats
      );
      expect(get).toHaveBeenCalledWith(
        "/channels",
        authMiddleware,
        semiStaticCache,
        viewerController.getChannels
      );

      expect(post).toHaveBeenCalledWith(
        "/privacy/export",
        authMiddleware,
        { schema: requestExportSchema },
        expect.any(Function)
      );
      expect(post).toHaveBeenCalledWith(
        "/privacy/delete-account",
        authMiddleware,
        { schema: deleteAccountSchema },
        expect.any(Function)
      );
      expect(post).toHaveBeenCalledWith(
        "/dashboard-layout",
        authMiddleware,
        { schema: saveDashboardLayoutSchema },
        layoutController.saveLayout
      );
      expect(post).toHaveBeenCalledWith(
        "/listen-channels",
        authMiddleware,
        { schema: listenChannelsSchema },
        expect.any(Function)
      );

      const getPrivacySettingsRoute = get.mock.calls.find(
        (call: unknown[]) => call[0] === "/privacy/settings"
      ) as unknown[];
      const updatePrivacySettingsRoute = put.mock.calls.find(
        (call: unknown[]) => call[0] === "/privacy/settings"
      ) as unknown[];

      expect((getPrivacySettingsRoute[3] as (...args: any[]) => any).name).toBe(
        "bound getPrivacySettings"
      );
      expect(getPrivacySettingsRoute[3]).not.toBe(privacyController.getPrivacySettings);

      expect((updatePrivacySettingsRoute[4] as (...args: any[]) => any).name).toBe(
        "bound updatePrivacySettings"
      );
      expect(updatePrivacySettingsRoute[4]).not.toBe(privacyController.updatePrivacySettings);
    });
  });
});
