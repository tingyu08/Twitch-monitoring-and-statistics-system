import request from "supertest";

describe("viewer.routes /listen-channels", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  const setupApp = () => {
    const requestListen = jest.fn();
    const logError = jest.fn();

    jest.doMock("../../auth/auth.middleware", () => ({
      requireAuth: () => (_req: unknown, _res: unknown, next: () => void) => next(),
    }));

    jest.doMock("../../../middlewares/validate.middleware", () => ({
      validateRequest: () => (_req: unknown, _res: unknown, next: () => void) => next(),
    }));

    jest.doMock("../../../services/chat-listener-manager", () => ({
      chatListenerManager: {
        requestListen,
      },
    }));

    jest.doMock("../viewer.controller", () => ({
      ViewerController: jest.fn(() => ({
        consent: jest.fn(),
        getChannelStats: jest.fn(),
        getChannelDetailAll: jest.fn(),
        getChannels: jest.fn(),
      })),
    }));

    jest.doMock("../viewer-message-stats.controller", () => ({
      ViewerMessageStatsController: jest.fn(() => ({
        getMessageStats: jest.fn(),
      })),
    }));

    jest.doMock("../viewer-privacy.controller", () => ({
      ViewerPrivacyController: jest.fn(() => ({
        getPrivacySettings: jest.fn(),
        updatePrivacySettings: jest.fn(),
        getDataSummary: jest.fn(),
        clearAllMessages: jest.fn(),
        clearChannelMessages: jest.fn(),
        getConsentSettings: jest.fn(),
        updateConsentSettings: jest.fn(),
        acceptAllConsent: jest.fn(),
        requestExport: jest.fn(),
        getExportStatus: jest.fn(),
        downloadExport: jest.fn(),
        requestDeleteAccount: jest.fn(),
        cancelDeletion: jest.fn(),
        getDeletionStatus: jest.fn(),
      })),
    }));

    jest.doMock("../viewer-lifetime-stats.controller", () => ({
      viewerLifetimeStatsController: {
        getLifetimeStats: jest.fn(),
      },
    }));

    jest.doMock("../dashboard-layout.controller", () => ({
      dashboardLayoutController: {
        saveLayout: jest.fn(),
        getLayout: jest.fn(),
        resetLayout: jest.fn(),
      },
    }));

    jest.doMock("../../../utils/logger", () => ({
      logger: {
        error: logError,
        info: jest.fn(),
      },
    }));

    let app: ReturnType<typeof import("express")>;

    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const express = require("express");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { viewerApiRoutes } = require("../viewer.routes");

      app = express();
      app.use(express.json());
      app.use("/api/viewer", viewerApiRoutes);
    });

    return {
      app: app!,
      requestListen,
      logError,
    };
  };

  it("returns 400 when channels is missing or invalid", async () => {
    const { app, requestListen } = setupApp();

    const response = await request(app).post("/api/viewer/listen-channels").send({});

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "channels array is required" });
    expect(requestListen).not.toHaveBeenCalled();
  });

  it("returns success payload and only requests live channels", async () => {
    const { app, requestListen } = setupApp();

    requestListen.mockResolvedValueOnce(true);
    requestListen.mockResolvedValueOnce(false);

    const response = await request(app)
      .post("/api/viewer/listen-channels")
      .send({
        channels: [
          { channelName: "offline-channel", isLive: false },
          { channelName: "live-a", isLive: true },
          { channelName: "live-b", isLive: true },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      message: "正在監聽 1/2 個開台頻道",
      listening: ["live-a"],
    });

    expect(requestListen).toHaveBeenCalledTimes(2);
    expect(requestListen).toHaveBeenNthCalledWith(1, "live-a", { isLive: true, priority: 10 });
    expect(requestListen).toHaveBeenNthCalledWith(2, "live-b", { isLive: true, priority: 10 });
  });

  it("returns 500 and logs when listener setup fails", async () => {
    const { app, requestListen, logError } = setupApp();

    requestListen.mockRejectedValueOnce(new Error("boom"));

    const response = await request(app)
      .post("/api/viewer/listen-channels")
      .send({ channels: [{ channelName: "live-a", isLive: true }] });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: "Internal Server Error" });
    expect(logError).toHaveBeenCalledWith(
      "ViewerAPI",
      "Error setting listen channels:",
      expect.any(Error)
    );
  });
});
