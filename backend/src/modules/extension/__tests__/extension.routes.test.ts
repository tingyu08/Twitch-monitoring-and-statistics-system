import express from "express";
import request from "supertest";
import type { NextFunction, Request, Response } from "express";

import router from "../extension.routes";
import * as schemas from "../extension.schema";
import {
  getExtensionTokenHandler,
  postHeartbeatHandler,
} from "../extension.controller";
import { extensionAuthMiddleware } from "../extension.middleware";
import { validateRequest } from "../../../middlewares/validate.middleware";

const middlewareOrder: string[] = [];

jest.mock("../extension.controller", () => ({
  getExtensionTokenHandler: jest.fn((_: Request, res: Response) => {
    res.status(200).json({ route: "auth-token" });
  }),
  postHeartbeatHandler: jest.fn((_: Request, res: Response) => {
    middlewareOrder.push("handler");
    res.status(200).json({ route: "heartbeat" });
  }),
}));

jest.mock("../extension.middleware", () => ({
  extensionAuthMiddleware: jest.fn((_: Request, _res: Response, next: NextFunction) => {
    middlewareOrder.push("auth");
    next();
  }),
}));

jest.mock("../../../middlewares/validate.middleware", () => ({
  validateRequest: jest.fn(() => (_req: Request, _res: Response, next: NextFunction) => {
    middlewareOrder.push("validate");
    next();
  }),
}));

describe("extension.routes", () => {
  const app = express();
  app.use(express.json());
  app.use("/api/extension", router);

  beforeEach(() => {
    middlewareOrder.length = 0;
    (getExtensionTokenHandler as jest.Mock).mockClear();
    (postHeartbeatHandler as jest.Mock).mockClear();
    (extensionAuthMiddleware as jest.Mock).mockClear();
  });

  it("registers heartbeat validator with heartbeat schema", () => {
    expect(validateRequest).toHaveBeenCalledWith(schemas.heartbeatSchema);
  });

  it("wires POST /auth-token to getExtensionTokenHandler", async () => {
    const response = await request(app).post("/api/extension/auth-token").send({});

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ route: "auth-token" });
    expect(getExtensionTokenHandler).toHaveBeenCalledTimes(1);
    expect(extensionAuthMiddleware).not.toHaveBeenCalled();
    expect(postHeartbeatHandler).not.toHaveBeenCalled();
  });

  it("wires POST /heartbeat through auth, validation, then handler", async () => {
    const response = await request(app)
      .post("/api/extension/heartbeat")
      .send({ channelName: "chan", timestamp: "2026-03-01T00:00:00.000Z", duration: 30 });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ route: "heartbeat" });
    expect(extensionAuthMiddleware).toHaveBeenCalledTimes(1);
    expect(postHeartbeatHandler).toHaveBeenCalledTimes(1);
    expect(middlewareOrder).toEqual(["auth", "validate", "handler"]);
  });
});
