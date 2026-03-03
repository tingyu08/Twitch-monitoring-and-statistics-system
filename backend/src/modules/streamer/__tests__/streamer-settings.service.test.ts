jest.mock("../../../db/prisma", () => ({
  prisma: {
    streamer: {
      findUnique: jest.fn(),
    },
    twitchToken: {
      update: jest.fn(),
      findFirst: jest.fn(),
    },
  },
}));

jest.mock("../../auth/twitch-oauth.client", () => ({
  TwitchOAuthClient: jest.fn().mockImplementation(() => ({
    refreshAccessToken: jest.fn(),
  })),
}));

jest.mock("../../../config/env", () => ({
  env: {
    twitchClientId: "test-client-id",
  },
}));

jest.mock("../../../utils/crypto.utils", () => ({
  decryptToken: jest.fn(),
  encryptToken: jest.fn((value: string) => `enc:${value}`),
}));

jest.mock("../../../utils/logger", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock("../template.service", () => ({
  templateService: {
    create: jest.fn(),
    findAll: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
}));

import { prisma } from "../../../db/prisma";
import { decryptToken, encryptToken } from "../../../utils/crypto.utils";
import { logger } from "../../../utils/logger";
import { StreamerSettingsService } from "../streamer-settings.service";
import { templateService } from "../template.service";

describe("StreamerSettingsService", () => {
  let service: StreamerSettingsService;
  let fetchMock: jest.Mock;
  let mockRefreshAccessToken: jest.Mock;
  let mockTemplateCreate: jest.Mock;
  let mockTemplateFindAll: jest.Mock;
  let mockTemplateUpdate: jest.Mock;
  let mockTemplateDelete: jest.Mock;

  const streamerWithToken = {
    id: "streamer-1",
    twitchUserId: "broadcaster-1",
    twitchTokens: [
      {
        id: "token-1",
        accessToken: "enc-access",
        refreshToken: "enc-refresh",
      },
    ],
  };

  const mockResponse = (
    payload: {
      ok: boolean;
      status: number;
      json?: unknown;
      text?: string;
    } = { ok: true, status: 200 }
  ) =>
    ({
      ok: payload.ok,
      status: payload.status,
      json: jest.fn().mockResolvedValue(payload.json ?? {}),
      text: jest.fn().mockResolvedValue(payload.text ?? ""),
    }) as unknown as Response;

  beforeEach(() => {
    jest.clearAllMocks();

    service = new StreamerSettingsService();
    mockRefreshAccessToken = (service as any).twitchClient.refreshAccessToken as jest.Mock;

    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    (prisma.streamer.findUnique as jest.Mock).mockResolvedValue(streamerWithToken);
    (prisma.twitchToken.findFirst as jest.Mock).mockResolvedValue({
      id: "token-2",
      accessToken: "enc-search-access",
    });

    (decryptToken as jest.Mock).mockImplementation((token: string) => `dec:${token}`);
    mockRefreshAccessToken.mockResolvedValue({
      access_token: "new-access-token",
      refresh_token: "new-refresh-token",
      expires_in: 3600,
    });

    mockTemplateCreate = templateService.create as jest.Mock;
    mockTemplateFindAll = templateService.findAll as jest.Mock;
    mockTemplateUpdate = templateService.update as jest.Mock;
    mockTemplateDelete = templateService.delete as jest.Mock;
  });

  describe("getChannelInfo", () => {
    it("returns null and warns when streamer token lookup misses", async () => {
      (prisma.streamer.findUnique as jest.Mock).mockResolvedValue({
        id: "streamer-1",
        twitchUserId: "broadcaster-1",
        twitchTokens: [],
      });

      const result = await service.getChannelInfo("streamer-1");

      expect(result).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        "StreamerSettings",
        "No active token found for streamer streamer-1"
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("throws when Twitch API returns non-ok response", async () => {
      fetchMock.mockResolvedValue(mockResponse({ ok: false, status: 500 }));

      await expect(service.getChannelInfo("streamer-1")).rejects.toThrow("Twitch API error: 500");
    });

    it("returns null when channel payload has no data item", async () => {
      fetchMock.mockResolvedValue(mockResponse({ ok: true, status: 200, json: { data: [] } }));

      const result = await service.getChannelInfo("streamer-1");

      expect(result).toBeNull();
    });

    it("maps channel info and defaults language to zh", async () => {
      fetchMock.mockResolvedValue(
        mockResponse({
          ok: true,
          status: 200,
          json: {
            data: [
              {
                title: "Live Title",
                game_id: "123",
                game_name: "Some Game",
                tags: ["tag1", "tag2"],
              },
            ],
          },
        })
      );

      const result = await service.getChannelInfo("streamer-1");

      expect(result).toEqual({
        title: "Live Title",
        gameId: "123",
        gameName: "Some Game",
        tags: ["tag1", "tag2"],
        language: "zh",
      });
    });

    it("maps channel info with empty Twitch fields to local defaults", async () => {
      fetchMock.mockResolvedValue(
        mockResponse({
          ok: true,
          status: 200,
          json: {
            data: [
              {
                broadcaster_language: "ja",
              },
            ],
          },
        })
      );

      const result = await service.getChannelInfo("streamer-1");

      expect(result).toEqual({
        title: "",
        gameId: "",
        gameName: "",
        tags: [],
        language: "ja",
      });
    });

    it("refreshes token on 401 and retries successfully", async () => {
      fetchMock
        .mockResolvedValueOnce(mockResponse({ ok: false, status: 401 }))
        .mockResolvedValueOnce(
          mockResponse({
            ok: true,
            status: 200,
            json: {
              data: [
                {
                  title: "Recovered",
                  game_id: "g-1",
                  game_name: "Recovered Game",
                  tags: [],
                  broadcaster_language: "en",
                },
              ],
            },
          })
        );

      const result = await service.getChannelInfo("streamer-1");

      expect(result?.title).toBe("Recovered");
      expect(mockRefreshAccessToken).toHaveBeenCalledWith("dec:enc-refresh");
      expect(prisma.twitchToken.update).toHaveBeenCalledWith({
        where: { id: "token-1" },
        data: {
          accessToken: "enc:new-access-token",
          refreshToken: "enc:new-refresh-token",
          status: "active",
          failureCount: 0,
          updatedAt: expect.any(Date),
        },
      });
      expect(encryptToken).toHaveBeenCalledWith("new-access-token");
      expect(encryptToken).toHaveBeenCalledWith("new-refresh-token");
      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        "https://api.twitch.tv/helix/channels?broadcaster_id=broadcaster-1",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({ Authorization: "Bearer dec:enc-access" }),
        })
      );
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        "https://api.twitch.tv/helix/channels?broadcaster_id=broadcaster-1",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({ Authorization: "Bearer new-access-token" }),
        })
      );
    });

    it("marks token expired and throws when refresh fails", async () => {
      fetchMock.mockResolvedValue(mockResponse({ ok: false, status: 401 }));
      mockRefreshAccessToken.mockRejectedValue(new Error("refresh failed"));

      await expect(service.getChannelInfo("streamer-1")).rejects.toThrow(
        "Token expired and refresh failed. Please re-authenticate."
      );

      expect(prisma.twitchToken.update).toHaveBeenCalledWith({
        where: { id: "token-1" },
        data: { status: "expired", failureCount: { increment: 1 } },
      });
      expect(logger.error).toHaveBeenCalledWith(
        "StreamerSettings",
        "Token refresh failed:",
        expect.any(Error)
      );
    });
  });

  describe("updateChannelInfo", () => {
    it("throws when streamer or token cannot be found", async () => {
      (prisma.streamer.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.updateChannelInfo("missing-streamer", { title: "x" })).rejects.toThrow(
        "Streamer not found or no valid token"
      );
    });

    it("patches channel info and returns true", async () => {
      fetchMock.mockResolvedValue(mockResponse({ ok: true, status: 204 }));

      const result = await service.updateChannelInfo("streamer-1", {
        title: "New Title",
        gameId: "game-99",
        tags: ["rpg"],
        language: "en",
      });

      expect(result).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.twitch.tv/helix/channels?broadcaster_id=broadcaster-1",
        {
          method: "PATCH",
          headers: {
            "Client-Id": "test-client-id",
            Authorization: "Bearer dec:enc-access",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            title: "New Title",
            game_id: "game-99",
            tags: ["rpg"],
            broadcaster_language: "en",
          }),
        }
      );
    });

    it("builds patch body without title when title is undefined", async () => {
      fetchMock.mockResolvedValue(mockResponse({ ok: true, status: 204 }));

      const result = await service.updateChannelInfo("streamer-1", {
        gameId: "game-only",
      });

      expect(result).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.twitch.tv/helix/channels?broadcaster_id=broadcaster-1",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ game_id: "game-only" }),
        })
      );
    });

    it("logs API text body and throws when update fails", async () => {
      fetchMock.mockResolvedValue(
        mockResponse({ ok: false, status: 400, text: "invalid request payload" })
      );

      await expect(service.updateChannelInfo("streamer-1", { title: "bad" })).rejects.toThrow(
        "Twitch API error: 400"
      );

      expect(logger.error).toHaveBeenCalledWith(
        "StreamerSettings",
        "updateChannelInfo error:",
        "invalid request payload"
      );
    });
  });

  describe("searchGames", () => {
    it("returns empty when query is too short", async () => {
      const result = await service.searchGames("a");

      expect(result).toEqual([]);
      expect(prisma.twitchToken.findFirst).not.toHaveBeenCalled();
    });

    it("returns empty when there is no active token", async () => {
      (prisma.twitchToken.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await service.searchGames("elden ring");

      expect(result).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("returns empty when Twitch search API is non-ok", async () => {
      fetchMock.mockResolvedValue(mockResponse({ ok: false, status: 503 }));

      const result = await service.searchGames("elden ring");

      expect(result).toEqual([]);
    });

    it("returns empty when fetch throws", async () => {
      fetchMock.mockRejectedValue(new Error("network down"));

      const result = await service.searchGames("elden ring");

      expect(result).toEqual([]);
    });

    it("maps Twitch categories and rewrites box art size", async () => {
      fetchMock.mockResolvedValue(
        mockResponse({
          ok: true,
          status: 200,
          json: {
            data: [
              {
                id: "33214",
                name: "Fortnite",
                box_art_url: "https://img/{width}x{height}.jpg",
              },
            ],
          },
        })
      );

      const result = await service.searchGames("final fantasy xiv");

      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.twitch.tv/helix/search/categories?query=final%20fantasy%20xiv&first=10",
        {
          headers: {
            "Client-Id": "test-client-id",
            Authorization: "Bearer dec:enc-search-access",
          },
        }
      );
      expect(result).toEqual([
        {
          id: "33214",
          name: "Fortnite",
          boxArtUrl: "https://img/52x72.jpg",
        },
      ]);
    });

    it("maps games with missing box art url to empty string", async () => {
      fetchMock.mockResolvedValue(
        mockResponse({
          ok: true,
          status: 200,
          json: {
            data: [
              {
                id: "509658",
                name: "Just Chatting",
              },
            ],
          },
        })
      );

      const result = await service.searchGames("just chatting");

      expect(result).toEqual([
        {
          id: "509658",
          name: "Just Chatting",
          boxArtUrl: "",
        },
      ]);
    });

    it("returns empty array when Twitch categories data is missing", async () => {
      fetchMock.mockResolvedValue(
        mockResponse({
          ok: true,
          status: 200,
          json: {},
        })
      );

      const result = await service.searchGames("monster hunter");

      expect(result).toEqual([]);
    });

    it("uses GET as default method in internal channel request", async () => {
      fetchMock.mockResolvedValue(mockResponse({ ok: true, status: 200 }));

      await (service as any).executeChannelApiRequest(
        "streamer-1",
        {
          id: "token-1",
          accessToken: "enc-access",
          refreshToken: null,
        },
        "broadcaster-1",
        {}
      );

      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.twitch.tv/helix/channels?broadcaster_id=broadcaster-1",
        expect.objectContaining({
          method: "GET",
          headers: {
            "Client-Id": "test-client-id",
            Authorization: "Bearer dec:enc-access",
          },
        })
      );
    });
  });

  describe("template delegation", () => {
    it("delegates createTemplate to templateService.create", async () => {
      const created = { id: "tpl-1" };
      mockTemplateCreate.mockResolvedValue(created);

      const result = await service.createTemplate("streamer-1", {
        templateName: "My Template",
        title: "Title",
      });

      expect(mockTemplateCreate).toHaveBeenCalledWith("streamer-1", {
        templateName: "My Template",
        title: "Title",
      });
      expect(result).toBe(created);
    });

    it("delegates getTemplates to templateService.findAll", async () => {
      const templates = [{ id: "tpl-1" }, { id: "tpl-2" }];
      mockTemplateFindAll.mockResolvedValue(templates);

      const result = await service.getTemplates("streamer-1");

      expect(mockTemplateFindAll).toHaveBeenCalledWith("streamer-1");
      expect(result).toEqual(templates);
    });

    it("returns updated template from updateTemplate", async () => {
      const updated = { id: "tpl-1", templateName: "Updated" };
      mockTemplateUpdate.mockResolvedValue(updated);

      const result = await service.updateTemplate("streamer-1", "tpl-1", {
        templateName: "Updated",
      });

      expect(mockTemplateUpdate).toHaveBeenCalledWith("tpl-1", "streamer-1", {
        templateName: "Updated",
      });
      expect(result).toBe(updated);
    });

    it("throws not-found error when updateTemplate returns null", async () => {
      mockTemplateUpdate.mockResolvedValue(null);

      await expect(
        service.updateTemplate("streamer-1", "tpl-missing", { templateName: "Nope" })
      ).rejects.toThrow("Template not found or permission denied");
    });

    it("returns true when deleteTemplate succeeds", async () => {
      mockTemplateDelete.mockResolvedValue(true);

      await expect(service.deleteTemplate("streamer-1", "tpl-1")).resolves.toBe(true);
      expect(mockTemplateDelete).toHaveBeenCalledWith("tpl-1", "streamer-1");
    });

    it("throws not-found error when deleteTemplate returns false", async () => {
      mockTemplateDelete.mockResolvedValue(false);

      await expect(service.deleteTemplate("streamer-1", "tpl-missing")).rejects.toThrow(
        "Template not found or permission denied"
      );
    });
  });
});
