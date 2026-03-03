type RouterMock = {
  get: jest.Mock;
  post: jest.Mock;
};

describe("auth.routes", () => {
  let routesModule: typeof import("../auth.routes");
  let routerInstances: RouterMock[];

  let oauthRouter: RouterMock;
  let apiRouter: RouterMock;

  let loginHandler: jest.Mock;
  let callbackHandler: jest.Mock;
  let exchangeHandler: jest.Mock;
  let refreshHandler: jest.Mock;

  let authGuardForMe: jest.Mock;
  let authGuardForLogout: jest.Mock;

  let routerFactoryMock: jest.Mock;
  let requireAuthMock: jest.Mock;
  let authControllerCtorMock: jest.Mock;

  let clearAuthCookiesMock: jest.Mock;
  let prismaMock: {
    viewer: { update: jest.Mock };
    twitchToken: { deleteMany: jest.Mock };
  };
  let getFollowedChannelsMock: jest.Mock;
  let loggerMock: { info: jest.Mock; warn: jest.Mock; error: jest.Mock };
  let snapshotServiceMock: {
    getViewerAuthSnapshotById: jest.Mock;
    invalidateViewerAuthSnapshot: jest.Mock;
  };

  beforeEach(() => {
    jest.resetModules();
    routerInstances = [];

    loginHandler = jest.fn();
    callbackHandler = jest.fn();
    exchangeHandler = jest.fn();
    refreshHandler = jest.fn();

    authGuardForMe = jest.fn();
    authGuardForLogout = jest.fn();

    routerFactoryMock = jest.fn(() => {
      const router: RouterMock = {
        get: jest.fn(),
        post: jest.fn(),
      };
      routerInstances.push(router);
      return router;
    });

    requireAuthMock = jest
      .fn()
      .mockReturnValueOnce(authGuardForMe)
      .mockReturnValueOnce(authGuardForLogout);

    authControllerCtorMock = jest.fn().mockImplementation(() => ({
      login: loginHandler,
      twitchCallback: callbackHandler,
      exchange: exchangeHandler,
      refresh: refreshHandler,
    }));

    clearAuthCookiesMock = jest.fn();
    prismaMock = {
      viewer: { update: jest.fn() },
      twitchToken: { deleteMany: jest.fn() },
    };
    getFollowedChannelsMock = jest.fn();
    loggerMock = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    snapshotServiceMock = {
      getViewerAuthSnapshotById: jest.fn(),
      invalidateViewerAuthSnapshot: jest.fn(),
    };

    jest.doMock("express", () => ({
      Router: routerFactoryMock,
    }));

    jest.doMock("../auth.controller", () => ({
      AuthController: authControllerCtorMock,
      clearAuthCookies: clearAuthCookiesMock,
    }));

    jest.doMock("../auth.middleware", () => ({
      requireAuth: requireAuthMock,
    }));

    jest.doMock("../../../db/prisma", () => ({
      prisma: prismaMock,
    }));

    jest.doMock("../../viewer/viewer.service", () => ({
      getFollowedChannels: getFollowedChannelsMock,
    }));

    jest.doMock("../../../utils/logger", () => ({
      logger: loggerMock,
    }));

    jest.doMock("../../viewer/viewer-auth-snapshot.service", () => ({
      getViewerAuthSnapshotById: snapshotServiceMock.getViewerAuthSnapshotById,
      invalidateViewerAuthSnapshot: snapshotServiceMock.invalidateViewerAuthSnapshot,
    }));

    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      routesModule = require("../auth.routes") as typeof import("../auth.routes");
    });

    [oauthRouter, apiRouter] = routerInstances;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("registers all OAuth routes with controller handlers", () => {
    expect(routerFactoryMock).toHaveBeenCalledTimes(2);
    expect(authControllerCtorMock).toHaveBeenCalledTimes(1);

    expect(oauthRouter.get).toHaveBeenCalledWith("/login", loginHandler);
    expect(oauthRouter.get).toHaveBeenCalledWith("/callback", callbackHandler);
    expect(oauthRouter.post).toHaveBeenCalledWith("/exchange", exchangeHandler);
  });

  it("registers authenticated API routes with middleware and handlers", () => {
    expect(requireAuthMock).toHaveBeenCalledTimes(2);
    expect(requireAuthMock).toHaveBeenNthCalledWith(1);
    expect(requireAuthMock).toHaveBeenNthCalledWith(2);

    expect(apiRouter.get).toHaveBeenCalledWith("/me", authGuardForMe, routesModule.getMeHandler);
    expect(apiRouter.post).toHaveBeenCalledWith(
      "/logout",
      authGuardForLogout,
      routesModule.logoutHandler
    );
  });

  it("registers refresh endpoint without auth middleware", () => {
    expect(apiRouter.post).toHaveBeenCalledWith("/refresh", refreshHandler);
  });

  it("exports the router instances used during route registration", () => {
    expect(routesModule.oauthRoutes).toBe(oauthRouter);
    expect(routesModule.apiRoutes).toBe(apiRouter);
  });

  it("getMeHandler returns viewer profile and preheats channels cache", async () => {
    const req = {
      user: {
        role: "viewer",
        viewerId: "viewer-1",
        twitchUserId: "tw-1",
        displayName: "Viewer One",
      },
    } as any;
    const res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as any;

    snapshotServiceMock.getViewerAuthSnapshotById.mockResolvedValue({
      consentedAt: new Date("2026-03-01T00:00:00.000Z"),
      consentVersion: 3,
    });
    getFollowedChannelsMock.mockResolvedValue([]);

    await routesModule.getMeHandler(req, res);
    await Promise.resolve();

    expect(snapshotServiceMock.getViewerAuthSnapshotById).toHaveBeenCalledWith("viewer-1");
    expect(getFollowedChannelsMock).toHaveBeenCalledWith("viewer-1");
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        viewerId: "viewer-1",
        role: "viewer",
        consentedAt: "2026-03-01T00:00:00.000Z",
        consentVersion: 3,
      })
    );
    expect(loggerMock.info).toHaveBeenCalledWith(
      "AuthAPI",
      "Preheated channels cache for viewer viewer-1"
    );
  });

  it("getMeHandler logs warning when preheat fails", async () => {
    const req = {
      user: {
        role: "viewer",
        viewerId: "viewer-2",
      },
    } as any;
    const res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as any;
    const preheatError = new Error("preheat failed");

    snapshotServiceMock.getViewerAuthSnapshotById.mockResolvedValue(null);
    getFollowedChannelsMock.mockRejectedValue(preheatError);

    await routesModule.getMeHandler(req, res);
    await Promise.resolve();

    expect(loggerMock.warn).toHaveBeenCalledWith(
      "AuthAPI",
      "Failed to preheat channels cache:",
      preheatError
    );
  });

  it("getMeHandler returns 500 when profile lookup throws", async () => {
    const req = {
      user: {
        role: "viewer",
        viewerId: "viewer-3",
      },
    } as any;
    const res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as any;

    snapshotServiceMock.getViewerAuthSnapshotById.mockRejectedValue(new Error("db error"));

    await routesModule.getMeHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Failed to load user profile" });
  });

  it("getMeHandler skips viewer snapshot lookup when viewerId is missing", async () => {
    const req = {
      user: {
        role: "viewer",
        twitchUserId: "tw-missing",
        consentedAt: "2026-03-02T00:00:00.000Z",
        consentVersion: 9,
      },
    } as any;
    const res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as any;

    await routesModule.getMeHandler(req, res);

    expect(snapshotServiceMock.getViewerAuthSnapshotById).not.toHaveBeenCalled();
    expect(getFollowedChannelsMock).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "viewer",
        twitchUserId: "tw-missing",
        consentedAt: "2026-03-02T00:00:00.000Z",
        consentVersion: 9,
      })
    );
  });

  it("logoutHandler clears cookies and revokes viewer tokens", async () => {
    const req = {
      user: {
        role: "viewer",
        viewerId: "viewer-4",
        twitchUserId: "tw-4",
      },
    } as any;
    const res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as any;

    await routesModule.logoutHandler(req, res);

    expect(clearAuthCookiesMock).toHaveBeenCalledWith(res);
    expect(prismaMock.viewer.update).toHaveBeenCalledWith({
      where: { id: "viewer-4" },
      data: { tokenVersion: { increment: 1 } },
    });
    expect(snapshotServiceMock.invalidateViewerAuthSnapshot).toHaveBeenCalledWith(
      "viewer-4",
      "tw-4"
    );
    expect(prismaMock.twitchToken.deleteMany).toHaveBeenCalledWith({
      where: { viewerId: "viewer-4" },
    });
    expect(res.json).toHaveBeenCalledWith({ message: "Logged out successfully" });
  });

  it("logoutHandler revokes streamer tokens for streamer users", async () => {
    const req = {
      user: {
        role: "streamer",
        streamerId: "streamer-1",
      },
    } as any;
    const res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as any;

    await routesModule.logoutHandler(req, res);

    expect(prismaMock.twitchToken.deleteMany).toHaveBeenCalledWith({
      where: { streamerId: "streamer-1" },
    });
    expect(res.json).toHaveBeenCalledWith({ message: "Logged out successfully" });
  });

  it("logoutHandler skips streamer token revoke when streamerId is missing", async () => {
    const req = {
      user: {
        role: "streamer",
      },
    } as any;
    const res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as any;

    await routesModule.logoutHandler(req, res);

    expect(prismaMock.viewer.update).not.toHaveBeenCalled();
    expect(prismaMock.twitchToken.deleteMany).not.toHaveBeenCalled();
    expect(snapshotServiceMock.invalidateViewerAuthSnapshot).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ message: "Logged out successfully" });
  });
});
