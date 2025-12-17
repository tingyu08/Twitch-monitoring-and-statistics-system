import request from "supertest";
import express from "express";
import { viewerApiRoutes } from "../viewer.routes";
import { dashboardLayoutService } from "../dashboard-layout.service";

jest.mock("../dashboard-layout.service");
jest.mock("../../auth/auth.middleware", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    req.user = { viewerId: "v1", role: "viewer" };
    next();
  },
}));

const app = express();
app.use(express.json());
app.use("/api/viewer", viewerApiRoutes);

describe("DashboardLayoutController", () => {
  const mockLayout = [{ i: "card1", x: 0, y: 0, w: 1, h: 1 }];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("GET /dashboard-layout/:channelId", () => {
    it("should return layout", async () => {
      (dashboardLayoutService.getLayout as jest.Mock).mockResolvedValue(
        mockLayout
      );

      const res = await request(app).get("/api/viewer/dashboard-layout/c1");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ layout: mockLayout });
      expect(dashboardLayoutService.getLayout).toHaveBeenCalledWith("v1", "c1");
    });

    it("should return null layout if not found", async () => {
      (dashboardLayoutService.getLayout as jest.Mock).mockResolvedValue(null);

      const res = await request(app).get("/api/viewer/dashboard-layout/c1");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ layout: null });
    });
  });

  describe("POST /dashboard-layout", () => {
    it("should save layout", async () => {
      (dashboardLayoutService.saveLayout as jest.Mock).mockResolvedValue({});

      const res = await request(app)
        .post("/api/viewer/dashboard-layout")
        .send({ channelId: "c1", layout: mockLayout });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(dashboardLayoutService.saveLayout).toHaveBeenCalledWith(
        "v1",
        "c1",
        mockLayout
      );
    });

    it("should fail validation if missing fields", async () => {
      const res = await request(app)
        .post("/api/viewer/dashboard-layout")
        .send({ channelId: "c1" }); // missing layout

      expect(res.status).toBe(400);
    });
  });

  describe("DELETE /dashboard-layout/:channelId", () => {
    it("should reset layout", async () => {
      (dashboardLayoutService.resetLayout as jest.Mock).mockResolvedValue({});

      const res = await request(app).delete("/api/viewer/dashboard-layout/c1");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(dashboardLayoutService.resetLayout).toHaveBeenCalledWith(
        "v1",
        "c1"
      );
    });
  });
});
