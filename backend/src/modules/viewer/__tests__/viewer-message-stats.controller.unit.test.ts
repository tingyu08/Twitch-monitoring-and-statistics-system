import type { Response } from "express";
import type { AuthRequest } from "../../auth/auth.middleware";

jest.mock("../viewer-message-stats.service", () => ({
  getViewerMessageStats: jest.fn(),
}));

jest.mock("../../../utils/logger", () => ({
  logger: { debug: jest.fn(), info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

import { getViewerMessageStats } from "../viewer-message-stats.service";
import { ViewerMessageStatsController } from "../viewer-message-stats.controller";

function makeReq(overrides: Partial<AuthRequest> = {}): AuthRequest {
  return {
    params: {},
    query: {},
    body: {},
    user: { viewerId: "viewer1", role: "viewer" },
    ...overrides,
  } as AuthRequest;
}

function makeRes() {
  const res = {
    status: jest.fn(),
    json: jest.fn(),
  } as unknown as Response & { status: jest.Mock; json: jest.Mock };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

describe("ViewerMessageStatsController unit", () => {
  let controller: ViewerMessageStatsController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new ViewerMessageStatsController();
  });

  it("returns 400 when viewerId or channelId is missing", async () => {
    const req = makeReq({ params: { viewerId: "viewer1" } as AuthRequest["params"] });
    const res = makeRes();

    await controller.getMessageStats(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "viewerId and channelId are required" });
    expect(getViewerMessageStats).not.toHaveBeenCalled();
  });
});
