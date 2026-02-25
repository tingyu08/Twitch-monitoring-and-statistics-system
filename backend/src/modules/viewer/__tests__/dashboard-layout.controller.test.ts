import type { Response } from "express";
import { DashboardLayoutController } from "../dashboard-layout.controller";
import type { AuthRequest } from "../../auth/auth.middleware";

jest.mock("../dashboard-layout.service", () => ({
  dashboardLayoutService: {
    getLayout: jest.fn(),
    saveLayout: jest.fn(),
    resetLayout: jest.fn(),
  },
}));
jest.mock("../../../utils/logger", () => ({ logger: { error: jest.fn() } }));

import { dashboardLayoutService } from "../dashboard-layout.service";

function makeRes(): jest.Mocked<Partial<Response>> {
  const json = jest.fn().mockReturnThis();
  const status = jest.fn().mockReturnValue({ json });
  return { status, json } as any;
}

function makeReq(overrides: Partial<AuthRequest> = {}): AuthRequest {
  return {
    params: {},
    body: {},
    ...overrides,
  } as AuthRequest;
}

describe("DashboardLayoutController", () => {
  let controller: DashboardLayoutController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new DashboardLayoutController();
  });

  // ─────────────────────────────── getLayout ───────────────────────────────

  describe("getLayout", () => {
    it("should return layout when viewerId is present", async () => {
      const mockLayout = [{ i: "card1", x: 0, y: 0, w: 1, h: 1 }];
      (dashboardLayoutService.getLayout as jest.Mock).mockResolvedValue(mockLayout);

      const req = makeReq({ user: { viewerId: "v1" } as any, params: { channelId: "ch1" } });
      const res = makeRes();

      await controller.getLayout(req, res as Response);

      expect(res.json).toHaveBeenCalledWith({ layout: mockLayout });
    });

    it("should return layout as null when service returns null", async () => {
      (dashboardLayoutService.getLayout as jest.Mock).mockResolvedValue(null);

      const req = makeReq({ user: { viewerId: "v1" } as any, params: { channelId: "ch1" } });
      const res = makeRes();

      await controller.getLayout(req, res as Response);

      expect(res.json).toHaveBeenCalledWith({ layout: null });
    });

    it("should return 401 when viewerId is missing", async () => {
      const req = makeReq({ user: undefined, params: { channelId: "ch1" } });
      const res = makeRes();

      await controller.getLayout(req, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      const statusRes = (res.status as jest.Mock).mock.results[0].value;
      expect(statusRes.json).toHaveBeenCalledWith({ error: "Unauthorized" });
    });

    it("should return 500 when service throws an error", async () => {
      (dashboardLayoutService.getLayout as jest.Mock).mockRejectedValue(new Error("DB error"));

      const req = makeReq({ user: { viewerId: "v1" } as any, params: { channelId: "ch1" } });
      const res = makeRes();

      await controller.getLayout(req, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      const statusRes = (res.status as jest.Mock).mock.results[0].value;
      expect(statusRes.json).toHaveBeenCalledWith({ error: "Internal server error" });
    });
  });

  // ─────────────────────────────── saveLayout ──────────────────────────────

  describe("saveLayout", () => {
    const mockLayout = [{ i: "card1", x: 0, y: 0, w: 1, h: 1 }];

    it("should save layout and return success when all fields are present", async () => {
      (dashboardLayoutService.saveLayout as jest.Mock).mockResolvedValue(undefined);

      const req = makeReq({
        user: { viewerId: "v1" } as any,
        body: { channelId: "ch1", layout: mockLayout },
      });
      const res = makeRes();

      await controller.saveLayout(req, res as Response);

      expect(dashboardLayoutService.saveLayout).toHaveBeenCalledWith("v1", "ch1", mockLayout);
      expect(res.json).toHaveBeenCalledWith({ success: true });
    });

    it("should return 401 when viewerId is missing", async () => {
      const req = makeReq({
        user: undefined,
        body: { channelId: "ch1", layout: mockLayout },
      });
      const res = makeRes();

      await controller.saveLayout(req, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      const statusRes = (res.status as jest.Mock).mock.results[0].value;
      expect(statusRes.json).toHaveBeenCalledWith({ error: "Unauthorized" });
    });

    it("should return 400 when channelId is missing", async () => {
      const req = makeReq({
        user: { viewerId: "v1" } as any,
        body: { layout: mockLayout },
      });
      const res = makeRes();

      await controller.saveLayout(req, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      const statusRes = (res.status as jest.Mock).mock.results[0].value;
      expect(statusRes.json).toHaveBeenCalledWith({ error: "Missing channelId or layout" });
    });

    it("should return 400 when layout is missing", async () => {
      const req = makeReq({
        user: { viewerId: "v1" } as any,
        body: { channelId: "ch1" },
      });
      const res = makeRes();

      await controller.saveLayout(req, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      const statusRes = (res.status as jest.Mock).mock.results[0].value;
      expect(statusRes.json).toHaveBeenCalledWith({ error: "Missing channelId or layout" });
    });

    it("should return 500 when service throws an error", async () => {
      (dashboardLayoutService.saveLayout as jest.Mock).mockRejectedValue(new Error("DB error"));

      const req = makeReq({
        user: { viewerId: "v1" } as any,
        body: { channelId: "ch1", layout: mockLayout },
      });
      const res = makeRes();

      await controller.saveLayout(req, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      const statusRes = (res.status as jest.Mock).mock.results[0].value;
      expect(statusRes.json).toHaveBeenCalledWith({ error: "Internal server error" });
    });
  });

  // ─────────────────────────────── resetLayout ─────────────────────────────

  describe("resetLayout", () => {
    it("should reset layout and return success when viewerId is present", async () => {
      (dashboardLayoutService.resetLayout as jest.Mock).mockResolvedValue(undefined);

      const req = makeReq({ user: { viewerId: "v1" } as any, params: { channelId: "ch1" } });
      const res = makeRes();

      await controller.resetLayout(req, res as Response);

      expect(dashboardLayoutService.resetLayout).toHaveBeenCalledWith("v1", "ch1");
      expect(res.json).toHaveBeenCalledWith({ success: true, message: "Layout reset to default" });
    });

    it("should return 401 when viewerId is missing", async () => {
      const req = makeReq({ user: undefined, params: { channelId: "ch1" } });
      const res = makeRes();

      await controller.resetLayout(req, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      const statusRes = (res.status as jest.Mock).mock.results[0].value;
      expect(statusRes.json).toHaveBeenCalledWith({ error: "Unauthorized" });
    });

    it("should return 500 when service throws an error", async () => {
      (dashboardLayoutService.resetLayout as jest.Mock).mockRejectedValue(new Error("DB error"));

      const req = makeReq({ user: { viewerId: "v1" } as any, params: { channelId: "ch1" } });
      const res = makeRes();

      await controller.resetLayout(req, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      const statusRes = (res.status as jest.Mock).mock.results[0].value;
      expect(statusRes.json).toHaveBeenCalledWith({ error: "Internal server error" });
    });
  });
});
