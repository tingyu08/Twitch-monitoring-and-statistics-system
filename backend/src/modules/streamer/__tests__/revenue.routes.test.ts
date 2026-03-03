import express from "express";
import request from "supertest";
import type { NextFunction, Request, Response } from "express";

import router from "../revenue.routes";
import { revenueController } from "../revenue.controller";
import { requireAuth } from "../../auth/auth.middleware";
import { requireStreamer } from "../streamer.middleware";

const middlewareOrder: string[] = [];
const rateLimitConfigs: Array<Record<string, unknown>> = [];

jest.mock("express-rate-limit", () =>
  jest.fn((config: Record<string, unknown>) => {
    rateLimitConfigs.push(config);
    return (_req: Request, _res: Response, next: NextFunction) => {
      middlewareOrder.push("rate-limit");
      next();
    };
  })
);

jest.mock("../../auth/auth.middleware", () => ({
  requireAuth: jest.fn(() => (_req: Request, _res: Response, next: NextFunction) => {
    middlewareOrder.push("auth");
    next();
  }),
}));

jest.mock("../streamer.middleware", () => ({
  requireStreamer: jest.fn((_req: Request, _res: Response, next: NextFunction) => {
    middlewareOrder.push("streamer");
    next();
  }),
}));

jest.mock("../revenue.controller", () => ({
  revenueController: {
    getOverview: jest.fn((_req: Request, res: Response) => {
      middlewareOrder.push("handler:overview");
      res.status(200).json({ route: "overview" });
    }),
    getSubscriptionStats: jest.fn((_req: Request, res: Response) => {
      middlewareOrder.push("handler:subscriptions");
      res.status(200).json({ route: "subscriptions" });
    }),
    getBitsStats: jest.fn((_req: Request, res: Response) => {
      middlewareOrder.push("handler:bits");
      res.status(200).json({ route: "bits" });
    }),
    getTopSupporters: jest.fn((_req: Request, res: Response) => {
      middlewareOrder.push("handler:top-supporters");
      res.status(200).json({ route: "top-supporters" });
    }),
    syncSubscriptions: jest.fn((_req: Request, res: Response) => {
      middlewareOrder.push("handler:sync");
      res.status(200).json({ route: "sync" });
    }),
    exportReport: jest.fn((_req: Request, res: Response) => {
      middlewareOrder.push("handler:export");
      res.status(200).json({ route: "export" });
    }),
  },
}));

describe("revenue.routes", () => {
  const app = express();
  app.use(express.json());
  app.use("/api/streamer/revenue", router);

  beforeEach(() => {
    middlewareOrder.length = 0;
    (revenueController.getOverview as jest.Mock).mockClear();
    (revenueController.getSubscriptionStats as jest.Mock).mockClear();
    (revenueController.getBitsStats as jest.Mock).mockClear();
    (revenueController.getTopSupporters as jest.Mock).mockClear();
    (revenueController.syncSubscriptions as jest.Mock).mockClear();
    (revenueController.exportReport as jest.Mock).mockClear();
  });

  it("registers auth middleware and creates two rate limiters", () => {
    expect(requireAuth).toBeDefined();
    expect(requireStreamer).toBeDefined();
    expect(rateLimitConfigs).toHaveLength(2);
  });

  it("wires GET analytics endpoints", async () => {
    const overview = await request(app).get("/api/streamer/revenue/overview");
    expect(overview.status).toBe(200);
    expect(overview.body).toEqual({ route: "overview" });

    const subscriptions = await request(app).get("/api/streamer/revenue/subscriptions");
    expect(subscriptions.status).toBe(200);
    expect(subscriptions.body).toEqual({ route: "subscriptions" });

    const bits = await request(app).get("/api/streamer/revenue/bits");
    expect(bits.status).toBe(200);
    expect(bits.body).toEqual({ route: "bits" });

    const supporters = await request(app).get("/api/streamer/revenue/top-supporters");
    expect(supporters.status).toBe(200);
    expect(supporters.body).toEqual({ route: "top-supporters" });

    expect(revenueController.getOverview).toHaveBeenCalledTimes(1);
    expect(revenueController.getSubscriptionStats).toHaveBeenCalledTimes(1);
    expect(revenueController.getBitsStats).toHaveBeenCalledTimes(1);
    expect(revenueController.getTopSupporters).toHaveBeenCalledTimes(1);
  });

  it("wires sync and export routes through rate limiter", async () => {
    const syncResponse = await request(app).post("/api/streamer/revenue/sync").send({});
    expect(syncResponse.status).toBe(200);
    expect(syncResponse.body).toEqual({ route: "sync" });

    const exportResponse = await request(app).get("/api/streamer/revenue/export");
    expect(exportResponse.status).toBe(200);
    expect(exportResponse.body).toEqual({ route: "export" });

    expect(revenueController.syncSubscriptions).toHaveBeenCalledTimes(1);
    expect(revenueController.exportReport).toHaveBeenCalledTimes(1);
    expect(middlewareOrder).toContain("rate-limit");
  });

  it("uses streamer key generator and falls back to unknown", () => {
    expect(rateLimitConfigs).toHaveLength(2);

    const keyGenerators = rateLimitConfigs
      .map((config) => config.keyGenerator)
      .filter((value): value is (req: Request) => string => typeof value === "function");

    expect(keyGenerators).toHaveLength(2);
    for (const keyGenerator of keyGenerators) {
      expect(keyGenerator({ user: { streamerId: "streamer-123" } } as unknown as Request)).toBe(
        "streamer-123"
      );
      expect(keyGenerator({} as unknown as Request)).toBe("unknown");
    }
  });
});
