import type { NextFunction, Response } from "express";

import type { ExtensionAuthRequest } from "../extension.middleware";
import { extensionAuthMiddleware } from "../extension.middleware";
import { verifyExtensionToken } from "../../auth/jwt.utils";
import { getViewerAuthSnapshotById } from "../../viewer/viewer-auth-snapshot.service";

jest.mock("../../auth/jwt.utils", () => ({
  verifyExtensionToken: jest.fn(),
}));

jest.mock("../../viewer/viewer-auth-snapshot.service", () => ({
  getViewerAuthSnapshotById: jest.fn(),
}));

function makeReq(overrides: Partial<ExtensionAuthRequest> = {}): ExtensionAuthRequest {
  return {
    headers: {},
    ...overrides,
  } as ExtensionAuthRequest;
}

function makeRes(): Response {
  const res = {
    status: jest.fn(),
    json: jest.fn(),
  } as unknown as Response;

  (res.status as jest.Mock).mockReturnValue(res);

  return res;
}

describe("extension.middleware", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 401 when authorization header is missing", async () => {
    const req = makeReq({ headers: {} });
    const res = makeRes();
    const next = jest.fn() as NextFunction;

    await extensionAuthMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Missing authorization header" });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when authorization header is not Bearer", async () => {
    const req = makeReq({ headers: { authorization: "Token abc" } });
    const res = makeRes();
    const next = jest.fn() as NextFunction;

    await extensionAuthMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Missing authorization header" });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when bearer token is empty", async () => {
    const req = makeReq({ headers: { authorization: "Bearer " } });
    const res = makeRes();
    const next = jest.fn() as NextFunction;

    await extensionAuthMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Invalid token format" });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when extension token is invalid", async () => {
    (verifyExtensionToken as jest.Mock).mockReturnValue(null);

    const req = makeReq({ headers: { authorization: "Bearer invalid-token" } });
    const res = makeRes();
    const next = jest.fn() as NextFunction;

    await extensionAuthMiddleware(req, res, next);

    expect(verifyExtensionToken).toHaveBeenCalledWith("invalid-token");
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Invalid or expired extension token" });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when viewer is not found", async () => {
    (verifyExtensionToken as jest.Mock).mockReturnValue({
      viewerId: "viewer-1",
      tokenVersion: 2,
    });
    (getViewerAuthSnapshotById as jest.Mock).mockResolvedValue(null);

    const req = makeReq({ headers: { authorization: "Bearer valid-token" } });
    const res = makeRes();
    const next = jest.fn() as NextFunction;

    await extensionAuthMiddleware(req, res, next);

    expect(getViewerAuthSnapshotById).toHaveBeenCalledWith("viewer-1");
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Viewer not found" });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when token version does not match", async () => {
    (verifyExtensionToken as jest.Mock).mockReturnValue({
      viewerId: "viewer-1",
      tokenVersion: 1,
    });
    (getViewerAuthSnapshotById as jest.Mock).mockResolvedValue({ tokenVersion: 2 });

    const req = makeReq({ headers: { authorization: "Bearer valid-token" } });
    const res = makeRes();
    const next = jest.fn() as NextFunction;

    await extensionAuthMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Token has been invalidated" });
    expect(next).not.toHaveBeenCalled();
  });

  it("attaches extensionUser and calls next on success", async () => {
    (verifyExtensionToken as jest.Mock).mockReturnValue({
      viewerId: "viewer-2",
      tokenVersion: 3,
    });
    (getViewerAuthSnapshotById as jest.Mock).mockResolvedValue({ tokenVersion: 3 });

    const req = makeReq({ headers: { authorization: "Bearer good-token" } });
    const res = makeRes();
    const next = jest.fn() as NextFunction;

    await extensionAuthMiddleware(req, res, next);

    expect(req.extensionUser).toEqual({ viewerId: "viewer-2" });
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it("returns 500 when an unexpected error occurs", async () => {
    (verifyExtensionToken as jest.Mock).mockImplementation(() => {
      throw new Error("unexpected");
    });

    const req = makeReq({ headers: { authorization: "Bearer boom-token" } });
    const res = makeRes();
    const next = jest.fn() as NextFunction;

    await extensionAuthMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Authentication error" });
    expect(next).not.toHaveBeenCalled();
  });
});
