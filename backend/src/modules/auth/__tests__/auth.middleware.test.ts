import { Response, NextFunction } from "express";
import { requireAuth, AuthRequest } from "../auth.middleware";
import * as JwtUtils from "../jwt.utils";

jest.mock("../jwt.utils");

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
