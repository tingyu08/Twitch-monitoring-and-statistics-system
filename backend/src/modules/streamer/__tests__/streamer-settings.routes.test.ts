import express from "express";
import request from "supertest";
import type { NextFunction, Request, Response } from "express";

import router from "../streamer-settings.routes";
import {
  createTemplateSchema,
  updateSettingsSchema,
  updateTemplateSchema,
} from "../streamer-settings.schema";
import { streamerSettingsController } from "../streamer-settings.controller";
import { validateRequest } from "../../../middlewares/validate.middleware";

const middlewareOrder: string[] = [];

jest.mock("../../auth/auth.middleware", () => ({
  requireAuth: jest.fn(() => (_req: Request, _res: Response, next: NextFunction) => {
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

jest.mock("../streamer-settings.controller", () => ({
  streamerSettingsController: {
    getSettings: jest.fn((_req: Request, res: Response) => {
      middlewareOrder.push("handler:getSettings");
      res.status(200).json({ route: "getSettings" });
    }),
    updateSettings: jest.fn((_req: Request, res: Response) => {
      middlewareOrder.push("handler:updateSettings");
      res.status(200).json({ route: "updateSettings" });
    }),
    searchGames: jest.fn((_req: Request, res: Response) => {
      middlewareOrder.push("handler:searchGames");
      res.status(200).json({ route: "searchGames" });
    }),
    listTemplates: jest.fn((_req: Request, res: Response) => {
      middlewareOrder.push("handler:listTemplates");
      res.status(200).json({ route: "listTemplates" });
    }),
    createTemplate: jest.fn((_req: Request, res: Response) => {
      middlewareOrder.push("handler:createTemplate");
      res.status(201).json({ route: "createTemplate" });
    }),
    updateTemplate: jest.fn((_req: Request, res: Response) => {
      middlewareOrder.push("handler:updateTemplate");
      res.status(200).json({ route: "updateTemplate" });
    }),
    deleteTemplate: jest.fn((_req: Request, res: Response) => {
      middlewareOrder.push("handler:deleteTemplate");
      res.status(200).json({ route: "deleteTemplate" });
    }),
  },
}));

describe("streamer-settings.routes", () => {
  const app = express();
  app.use(express.json());
  app.use("/api/streamer", router);

  beforeEach(() => {
    middlewareOrder.length = 0;
    (streamerSettingsController.getSettings as jest.Mock).mockClear();
    (streamerSettingsController.updateSettings as jest.Mock).mockClear();
    (streamerSettingsController.searchGames as jest.Mock).mockClear();
    (streamerSettingsController.listTemplates as jest.Mock).mockClear();
    (streamerSettingsController.createTemplate as jest.Mock).mockClear();
    (streamerSettingsController.updateTemplate as jest.Mock).mockClear();
    (streamerSettingsController.deleteTemplate as jest.Mock).mockClear();
  });

  it("registers validators with expected schemas", () => {
    expect(validateRequest).toHaveBeenCalledWith(updateSettingsSchema);
    expect(validateRequest).toHaveBeenCalledWith(createTemplateSchema);
    expect(validateRequest).toHaveBeenCalledWith(updateTemplateSchema);
  });

  it("wires GET /settings", async () => {
    const response = await request(app).get("/api/streamer/settings");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ route: "getSettings" });
    expect(streamerSettingsController.getSettings).toHaveBeenCalledTimes(1);
    expect(middlewareOrder).toEqual(["auth", "handler:getSettings"]);
  });

  it("wires POST /settings through validation", async () => {
    const response = await request(app).post("/api/streamer/settings").send({ title: "New title" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ route: "updateSettings" });
    expect(streamerSettingsController.updateSettings).toHaveBeenCalledTimes(1);
    expect(middlewareOrder).toEqual(["auth", "validate", "handler:updateSettings"]);
  });

  it("wires games and templates routes", async () => {
    const search = await request(app).get("/api/streamer/games/search").query({ q: "valorant" });
    expect(search.status).toBe(200);
    expect(search.body).toEqual({ route: "searchGames" });

    const list = await request(app).get("/api/streamer/templates");
    expect(list.status).toBe(200);
    expect(list.body).toEqual({ route: "listTemplates" });

    const create = await request(app)
      .post("/api/streamer/templates")
      .send({ templateName: "Template", title: "Title" });
    expect(create.status).toBe(201);
    expect(create.body).toEqual({ route: "createTemplate" });

    const update = await request(app)
      .put("/api/streamer/templates/template-1")
      .send({ templateName: "Updated" });
    expect(update.status).toBe(200);
    expect(update.body).toEqual({ route: "updateTemplate" });

    const del = await request(app).delete("/api/streamer/templates/template-1");
    expect(del.status).toBe(200);
    expect(del.body).toEqual({ route: "deleteTemplate" });

    expect(streamerSettingsController.searchGames).toHaveBeenCalledTimes(1);
    expect(streamerSettingsController.listTemplates).toHaveBeenCalledTimes(1);
    expect(streamerSettingsController.createTemplate).toHaveBeenCalledTimes(1);
    expect(streamerSettingsController.updateTemplate).toHaveBeenCalledTimes(1);
    expect(streamerSettingsController.deleteTemplate).toHaveBeenCalledTimes(1);
  });
});
