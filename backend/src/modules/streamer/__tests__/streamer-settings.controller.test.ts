import type { Response } from "express";
import type { AuthRequest } from "../../auth/auth.middleware";

jest.mock("../streamer-settings.service", () => ({
  streamerSettingsService: {
    getChannelInfo: jest.fn(),
    updateChannelInfo: jest.fn(),
    searchGames: jest.fn(),
    getTemplates: jest.fn(),
    createTemplate: jest.fn(),
    updateTemplate: jest.fn(),
    deleteTemplate: jest.fn(),
  },
}));

jest.mock("../../../utils/logger", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import { logger } from "../../../utils/logger";
import { streamerSettingsController } from "../streamer-settings.controller";
import { streamerSettingsService } from "../streamer-settings.service";

function makeReq(overrides: Partial<AuthRequest> = {}): AuthRequest {
  return {
    user: { streamerId: "streamer-1", viewerId: "viewer-1", role: "streamer" },
    body: {},
    params: {},
    query: {},
    cookies: {},
    ...overrides,
  } as unknown as AuthRequest;
}

function makeRes(): Response {
  const res = {
    status: jest.fn(),
    json: jest.fn(),
  } as unknown as Response;

  (res.status as jest.Mock).mockReturnValue(res);
  return res;
}

describe("StreamerSettingsController", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("getSettings", () => {
    it("returns 403 when streamer id is missing", async () => {
      const req = makeReq({ user: undefined });
      const res = makeRes();

      await streamerSettingsController.getSettings(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: "Not a streamer or not authenticated" });
      expect(streamerSettingsService.getChannelInfo).not.toHaveBeenCalled();
    });

    it("returns 404 when settings are not found", async () => {
      (streamerSettingsService.getChannelInfo as jest.Mock).mockResolvedValue(null);
      const req = makeReq();
      const res = makeRes();

      await streamerSettingsController.getSettings(req, res);

      expect(streamerSettingsService.getChannelInfo).toHaveBeenCalledWith("streamer-1");
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: "Settings not found" });
    });

    it("returns settings on success", async () => {
      const settings = { title: "Live", gameId: "123", gameName: "Game", tags: ["rpg"] };
      (streamerSettingsService.getChannelInfo as jest.Mock).mockResolvedValue(settings);
      const req = makeReq();
      const res = makeRes();

      await streamerSettingsController.getSettings(req, res);

      expect(res.json).toHaveBeenCalledWith(settings);
    });

    it("returns 500 and logs when getSettings throws", async () => {
      const error = new Error("db down");
      (streamerSettingsService.getChannelInfo as jest.Mock).mockRejectedValue(error);
      const req = makeReq();
      const res = makeRes();

      await streamerSettingsController.getSettings(req, res);

      expect(logger.error).toHaveBeenCalledWith("StreamerSettings", "Get settings error:", error);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: "Internal server error" });
    });
  });

  describe("updateSettings", () => {
    it("returns 403 when streamer id is missing", async () => {
      const req = makeReq({ user: undefined });
      const res = makeRes();

      await streamerSettingsController.updateSettings(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: "Not a streamer or not authenticated" });
    });

    it("returns success payload when update succeeds", async () => {
      (streamerSettingsService.updateChannelInfo as jest.Mock).mockResolvedValue(true);
      const req = makeReq({ body: { title: "Updated title" } });
      const res = makeRes();

      await streamerSettingsController.updateSettings(req, res);

      expect(streamerSettingsService.updateChannelInfo).toHaveBeenCalledWith("streamer-1", {
        title: "Updated title",
      });
      expect(res.json).toHaveBeenCalledWith({ success: true });
    });

    it("returns 400 when update result is false", async () => {
      (streamerSettingsService.updateChannelInfo as jest.Mock).mockResolvedValue(false);
      const req = makeReq({ body: { title: "Updated title" } });
      const res = makeRes();

      await streamerSettingsController.updateSettings(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: "Failed to update settings" });
    });

    it("returns 500 and logs when update throws", async () => {
      const error = new Error("failed update");
      (streamerSettingsService.updateChannelInfo as jest.Mock).mockRejectedValue(error);
      const req = makeReq({ body: { title: "Updated title" } });
      const res = makeRes();

      await streamerSettingsController.updateSettings(req, res);

      expect(logger.error).toHaveBeenCalledWith("StreamerSettings", "Update settings error:", error);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: "Internal server error" });
    });
  });

  describe("searchGames", () => {
    it("returns games from service", async () => {
      const games = [{ id: "1", name: "Elden Ring", boxArtUrl: "img" }];
      (streamerSettingsService.searchGames as jest.Mock).mockResolvedValue(games);
      const req = makeReq({ query: { q: "elden" } });
      const res = makeRes();

      await streamerSettingsController.searchGames(req, res);

      expect(streamerSettingsService.searchGames).toHaveBeenCalledWith("elden");
      expect(res.json).toHaveBeenCalledWith(games);
    });

    it("returns 500 and logs when search throws", async () => {
      const error = new Error("search error");
      (streamerSettingsService.searchGames as jest.Mock).mockRejectedValue(error);
      const req = makeReq({ query: { q: "elden" } });
      const res = makeRes();

      await streamerSettingsController.searchGames(req, res);

      expect(logger.error).toHaveBeenCalledWith("StreamerSettings", "Search games error:", error);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: "Internal server error" });
    });
  });

  describe("listTemplates", () => {
    it("returns 403 when streamer id is missing", async () => {
      const req = makeReq({ user: undefined });
      const res = makeRes();

      await streamerSettingsController.listTemplates(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: "Not a streamer or not authenticated" });
    });

    it("returns templates on success", async () => {
      const templates = [{ id: "tpl-1" }, { id: "tpl-2" }];
      (streamerSettingsService.getTemplates as jest.Mock).mockResolvedValue(templates);
      const req = makeReq();
      const res = makeRes();

      await streamerSettingsController.listTemplates(req, res);

      expect(streamerSettingsService.getTemplates).toHaveBeenCalledWith("streamer-1");
      expect(res.json).toHaveBeenCalledWith(templates);
    });

    it("returns 500 and logs when list throws", async () => {
      const error = new Error("list error");
      (streamerSettingsService.getTemplates as jest.Mock).mockRejectedValue(error);
      const req = makeReq();
      const res = makeRes();

      await streamerSettingsController.listTemplates(req, res);

      expect(logger.error).toHaveBeenCalledWith("StreamerSettings", "List templates error:", error);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: "Internal server error" });
    });
  });

  describe("createTemplate", () => {
    it("returns 403 when streamer id is missing", async () => {
      const req = makeReq({ user: undefined });
      const res = makeRes();

      await streamerSettingsController.createTemplate(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: "Not a streamer or not authenticated" });
    });

    it("returns 201 with created template", async () => {
      const template = { id: "tpl-1", templateName: "Template A" };
      (streamerSettingsService.createTemplate as jest.Mock).mockResolvedValue(template);
      const req = makeReq({ body: { templateName: "Template A" } });
      const res = makeRes();

      await streamerSettingsController.createTemplate(req, res);

      expect(streamerSettingsService.createTemplate).toHaveBeenCalledWith("streamer-1", {
        templateName: "Template A",
      });
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(template);
    });

    it("returns 500 and logs when create throws", async () => {
      const error = new Error("create error");
      (streamerSettingsService.createTemplate as jest.Mock).mockRejectedValue(error);
      const req = makeReq({ body: { templateName: "Template A" } });
      const res = makeRes();

      await streamerSettingsController.createTemplate(req, res);

      expect(logger.error).toHaveBeenCalledWith("StreamerSettings", "Create template error:", error);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: "Failed to create template" });
    });
  });

  describe("updateTemplate", () => {
    it("returns 403 when streamer id is missing", async () => {
      const req = makeReq({ user: undefined, params: { id: "tpl-1" } });
      const res = makeRes();

      await streamerSettingsController.updateTemplate(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: "Not a streamer or not authenticated" });
    });

    it("returns updated template on success", async () => {
      const updatedTemplate = { id: "tpl-1", templateName: "Updated" };
      (streamerSettingsService.updateTemplate as jest.Mock).mockResolvedValue(updatedTemplate);
      const req = makeReq({ params: { id: "tpl-1" }, body: { templateName: "Updated" } });
      const res = makeRes();

      await streamerSettingsController.updateTemplate(req, res);

      expect(streamerSettingsService.updateTemplate).toHaveBeenCalledWith(
        "streamer-1",
        "tpl-1",
        {
          templateName: "Updated",
        }
      );
      expect(res.json).toHaveBeenCalledWith(updatedTemplate);
    });

    it("returns 404 when template is not found", async () => {
      (streamerSettingsService.updateTemplate as jest.Mock).mockRejectedValue(
        new Error("Template not found or permission denied")
      );
      const req = makeReq({ params: { id: "tpl-404" }, body: { templateName: "Missing" } });
      const res = makeRes();

      await streamerSettingsController.updateTemplate(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: "Template not found or permission denied" });
      expect(logger.error).not.toHaveBeenCalled();
    });

    it("returns 500 and logs when unexpected error is thrown", async () => {
      const error = new Error("unexpected");
      (streamerSettingsService.updateTemplate as jest.Mock).mockRejectedValue(error);
      const req = makeReq({ params: { id: "tpl-1" }, body: { templateName: "Updated" } });
      const res = makeRes();

      await streamerSettingsController.updateTemplate(req, res);

      expect(logger.error).toHaveBeenCalledWith("StreamerSettings", "Update template error:", error);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: "Failed to update template" });
    });
  });

  describe("deleteTemplate", () => {
    it("returns 403 when streamer id is missing", async () => {
      const req = makeReq({ user: undefined, params: { id: "tpl-1" } });
      const res = makeRes();

      await streamerSettingsController.deleteTemplate(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: "Not a streamer or not authenticated" });
    });

    it("returns success payload on delete success", async () => {
      (streamerSettingsService.deleteTemplate as jest.Mock).mockResolvedValue(true);
      const req = makeReq({ params: { id: "tpl-1" } });
      const res = makeRes();

      await streamerSettingsController.deleteTemplate(req, res);

      expect(streamerSettingsService.deleteTemplate).toHaveBeenCalledWith("streamer-1", "tpl-1");
      expect(res.json).toHaveBeenCalledWith({ success: true });
    });

    it("returns 404 when template is not found", async () => {
      (streamerSettingsService.deleteTemplate as jest.Mock).mockRejectedValue(
        new Error("Template not found or permission denied")
      );
      const req = makeReq({ params: { id: "tpl-404" } });
      const res = makeRes();

      await streamerSettingsController.deleteTemplate(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: "Template not found or permission denied" });
      expect(logger.error).not.toHaveBeenCalled();
    });

    it("returns 500 and logs when unexpected error is thrown", async () => {
      const error = new Error("unexpected");
      (streamerSettingsService.deleteTemplate as jest.Mock).mockRejectedValue(error);
      const req = makeReq({ params: { id: "tpl-1" } });
      const res = makeRes();

      await streamerSettingsController.deleteTemplate(req, res);

      expect(logger.error).toHaveBeenCalledWith("StreamerSettings", "Delete template error:", error);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: "Failed to delete template" });
    });
  });
});
