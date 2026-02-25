import { Response, NextFunction } from "express";
import { requireAuth, AuthRequest, authMiddleware } from "../auth.middleware";
import * as JwtUtils from "../jwt.utils";

jest.mock("../jwt.utils");
jest.mock("../../../utils/cache-manager", () => ({
  cacheManager: {
    getOrSetWithTags: jest.fn(),
  },
}));
jest.mock("../../viewer/viewer-auth-snapshot.service", () => ({
  getViewerAuthSnapshotById: jest.fn(),
}));

import { cacheManager } from "../../../utils/cache-manager";

describe("auth.middleware", () => {
  let mockReq: Partial<AuthRequest>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;

  beforeEach(() => {
    jsonMock = jest.fn();
    statusMock = jest.fn().mockReturnValue({ json: jsonMock });
    mockReq = {
      cookies: {},
    };
    mockRes = {
      status: statusMock,
      json: jsonMock,
    };
    mockNext = jest.fn();
    jest.clearAllMocks();
  });

  it("should return 401 if no cookies", async () => {
    mockReq.cookies = {};
    await requireAuth(mockReq as AuthRequest, mockRes as Response, mockNext);
    expect(statusMock).toHaveBeenCalledWith(401);
    expect(jsonMock).toHaveBeenCalledWith({ error: "Unauthorized" });
  });

  it("should return 401 if token invalid", async () => {
    mockReq.cookies = { auth_token: "bad" };
    (JwtUtils.verifyAccessToken as jest.Mock).mockReturnValue(null);
    await requireAuth(mockReq as AuthRequest, mockRes as Response, mockNext);
    expect(statusMock).toHaveBeenCalledWith(401);
  });

  it("should call next if token valid and no roles required", async () => {
    mockReq.cookies = { auth_token: "good" };
    const user = { userId: "u1", role: "viewer" };
    (JwtUtils.verifyAccessToken as jest.Mock).mockReturnValue(user);

    await requireAuth(mockReq as AuthRequest, mockRes as Response, mockNext);

    expect(mockReq.user).toEqual(user);
    expect(mockNext).toHaveBeenCalled();
  });

  it("should return 403 if role not allowed", async () => {
    mockReq.cookies = { auth_token: "good" };
    (JwtUtils.verifyAccessToken as jest.Mock).mockReturnValue({
      role: "viewer",
    });

    await requireAuth(mockReq as AuthRequest, mockRes as Response, mockNext, ["streamer"]);

    expect(statusMock).toHaveBeenCalledWith(403);
    expect(jsonMock).toHaveBeenCalledWith({ error: "Forbidden" });
  });

  it("should allow streamer if viewer role required", async () => {
    mockReq.cookies = { auth_token: "good" };
    (JwtUtils.verifyAccessToken as jest.Mock).mockReturnValue({
      role: "streamer",
    });

    await requireAuth(mockReq as AuthRequest, mockRes as Response, mockNext, ["viewer"]);

    expect(mockNext).toHaveBeenCalled();
  });

  it("should handle unexpected errors with 401", async () => {
    mockReq.cookies = { auth_token: "good" };
    (JwtUtils.verifyAccessToken as jest.Mock).mockImplementation(() => {
      throw new Error("Unexpected");
    });

    await requireAuth(mockReq as AuthRequest, mockRes as Response, mockNext);

    expect(statusMock).toHaveBeenCalledWith(401);
  });
});

describe("auth.middleware - factory pattern & tokenVersion", () => {
  let mockReq: any;
  let mockRes: any;
  let mockNext: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockNext = jest.fn();
    mockReq = { cookies: {} };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
  });

  it("requireAuth() factory pattern should return a middleware function", () => {
    const middleware = requireAuth([]);
    expect(typeof middleware).toBe("function");
  });

  it("factory middleware should work when called", async () => {
    mockReq.cookies = { auth_token: "valid" };
    (JwtUtils.verifyAccessToken as jest.Mock).mockReturnValue({ role: "streamer" });
    const middleware = requireAuth([]);
    await middleware(mockReq, mockRes, mockNext);
    expect(mockNext).toHaveBeenCalled();
  });

  it("factory middleware should enforce roles", async () => {
    mockReq.cookies = { auth_token: "valid" };
    (JwtUtils.verifyAccessToken as jest.Mock).mockReturnValue({ role: "viewer" });
    const middleware = requireAuth(["streamer"]);
    await middleware(mockReq, mockRes, mockNext);
    expect(mockRes.status).toHaveBeenCalledWith(403);
  });

  it("authMiddleware alias should work", () => {
    expect(typeof authMiddleware).toBe("function");
  });
});

describe("auth.middleware - tokenVersion checks", () => {
  let mockReq: any;
  let mockRes: any;
  let mockNext: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockNext = jest.fn();
    mockReq = { cookies: { auth_token: "valid" } };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
  });

  it("should return 401 Token expired when currentVersion is null", async () => {
    (cacheManager.getOrSetWithTags as jest.Mock).mockResolvedValue(null);

    (JwtUtils.verifyAccessToken as jest.Mock).mockReturnValue({
      viewerId: "v1",
      tokenVersion: 1,
      role: "viewer",
    });

    await requireAuth(mockReq, mockRes, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockRes.json).toHaveBeenCalledWith({ error: "Token expired" });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it("should return 401 Token expired when currentVersion does not match decoded.tokenVersion", async () => {
    (cacheManager.getOrSetWithTags as jest.Mock).mockResolvedValue(2);

    (JwtUtils.verifyAccessToken as jest.Mock).mockReturnValue({
      viewerId: "v1",
      tokenVersion: 1,
      role: "viewer",
    });

    await requireAuth(mockReq, mockRes, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockRes.json).toHaveBeenCalledWith({ error: "Token expired" });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it("should allow streamer role when allowedRoles includes only viewer (super role)", async () => {
    (JwtUtils.verifyAccessToken as jest.Mock).mockReturnValue({
      role: "streamer",
    });

    await requireAuth(mockReq, mockRes, mockNext, ["viewer"]);

    expect(mockNext).toHaveBeenCalled();
    expect(mockRes.status).not.toHaveBeenCalled();
  });
});
