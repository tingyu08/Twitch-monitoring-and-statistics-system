jest.mock("../../../db/prisma", () => ({
  prisma: {
    streamerSettingTemplate: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  },
}));

import { prisma } from "../../../db/prisma";
import { TemplateService } from "../template.service";

describe("TemplateService", () => {
  const now = new Date("2025-01-01T00:00:00.000Z");
  let service: TemplateService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TemplateService();
  });

  it("create serializes tags and maps response", async () => {
    (prisma.streamerSettingTemplate.create as jest.Mock).mockResolvedValue({
      id: "tpl-1",
      templateName: "Default",
      title: "Title",
      gameId: "g1",
      gameName: "Game",
      tags: JSON.stringify(["fun", "fps"]),
      createdAt: now,
      updatedAt: now,
    });

    const result = await service.create("streamer-1", {
      templateName: "Default",
      title: "Title",
      gameId: "g1",
      gameName: "Game",
      tags: ["fun", "fps"],
    });

    expect(prisma.streamerSettingTemplate.create).toHaveBeenCalledWith({
      data: {
        streamerId: "streamer-1",
        templateName: "Default",
        title: "Title",
        gameId: "g1",
        gameName: "Game",
        tags: JSON.stringify(["fun", "fps"]),
      },
    });
    expect(result.tags).toEqual(["fun", "fps"]);
  });

  it("create stores null tags and falls back to []", async () => {
    (prisma.streamerSettingTemplate.create as jest.Mock).mockResolvedValue({
      id: "tpl-2",
      templateName: "No Tags",
      title: null,
      gameId: null,
      gameName: null,
      tags: null,
      createdAt: now,
      updatedAt: now,
    });

    const result = await service.create("streamer-1", { templateName: "No Tags" });

    expect(prisma.streamerSettingTemplate.create).toHaveBeenCalledWith({
      data: {
        streamerId: "streamer-1",
        templateName: "No Tags",
        title: undefined,
        gameId: undefined,
        gameName: undefined,
        tags: null,
      },
    });
    expect(result.tags).toEqual([]);
  });

  it("findAll returns mapped templates in desc order", async () => {
    (prisma.streamerSettingTemplate.findMany as jest.Mock).mockResolvedValue([
      {
        id: "tpl-1",
        templateName: "A",
        title: null,
        gameId: null,
        gameName: null,
        tags: null,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const result = await service.findAll("streamer-1");

    expect(prisma.streamerSettingTemplate.findMany).toHaveBeenCalledWith({
      where: { streamerId: "streamer-1" },
      orderBy: { createdAt: "desc" },
    });
    expect(result).toEqual([
      {
        id: "tpl-1",
        templateName: "A",
        title: null,
        gameId: null,
        gameName: null,
        tags: [],
        createdAt: now,
        updatedAt: now,
      },
    ]);
  });

  it("findById returns null when template does not exist", async () => {
    (prisma.streamerSettingTemplate.findFirst as jest.Mock).mockResolvedValue(null);

    const result = await service.findById("tpl-missing", "streamer-1");

    expect(prisma.streamerSettingTemplate.findFirst).toHaveBeenCalledWith({
      where: { id: "tpl-missing", streamerId: "streamer-1" },
    });
    expect(result).toBeNull();
  });

  it("findById returns mapped template when found", async () => {
    (prisma.streamerSettingTemplate.findFirst as jest.Mock).mockResolvedValue({
      id: "tpl-1",
      templateName: "Found",
      title: "T",
      gameId: "g1",
      gameName: "Game",
      tags: JSON.stringify(["tag1"]),
      createdAt: now,
      updatedAt: now,
    });

    const result = await service.findById("tpl-1", "streamer-1");

    expect(result).toEqual({
      id: "tpl-1",
      templateName: "Found",
      title: "T",
      gameId: "g1",
      gameName: "Game",
      tags: ["tag1"],
      createdAt: now,
      updatedAt: now,
    });
  });

  it("update returns null when template is missing", async () => {
    (prisma.streamerSettingTemplate.findFirst as jest.Mock).mockResolvedValue(null);

    const result = await service.update("tpl-missing", "streamer-1", { templateName: "Updated" });

    expect(result).toBeNull();
    expect(prisma.streamerSettingTemplate.update).not.toHaveBeenCalled();
  });

  it("update serializes tags when provided", async () => {
    (prisma.streamerSettingTemplate.findFirst as jest.Mock).mockResolvedValue({
      id: "tpl-1",
      streamerId: "streamer-1",
    });
    (prisma.streamerSettingTemplate.update as jest.Mock).mockResolvedValue({
      id: "tpl-1",
      templateName: "Updated",
      title: "New",
      gameId: "g2",
      gameName: "New Game",
      tags: JSON.stringify(["new"]),
      createdAt: now,
      updatedAt: now,
    });

    const result = await service.update("tpl-1", "streamer-1", {
      templateName: "Updated",
      title: "New",
      gameId: "g2",
      gameName: "New Game",
      tags: ["new"],
    });

    expect(prisma.streamerSettingTemplate.update).toHaveBeenCalledWith({
      where: { id: "tpl-1" },
      data: {
        templateName: "Updated",
        title: "New",
        gameId: "g2",
        gameName: "New Game",
        tags: JSON.stringify(["new"]),
      },
    });
    expect(result?.tags).toEqual(["new"]);
  });

  it("update keeps tags unchanged when omitted", async () => {
    (prisma.streamerSettingTemplate.findFirst as jest.Mock).mockResolvedValue({
      id: "tpl-1",
      streamerId: "streamer-1",
    });
    (prisma.streamerSettingTemplate.update as jest.Mock).mockResolvedValue({
      id: "tpl-1",
      templateName: "Updated",
      title: null,
      gameId: null,
      gameName: null,
      tags: null,
      createdAt: now,
      updatedAt: now,
    });

    await service.update("tpl-1", "streamer-1", { templateName: "Updated" });

    expect(prisma.streamerSettingTemplate.update).toHaveBeenCalledWith({
      where: { id: "tpl-1" },
      data: {
        templateName: "Updated",
        title: undefined,
        gameId: undefined,
        gameName: undefined,
        tags: undefined,
      },
    });
  });

  it("delete returns false when template does not exist", async () => {
    (prisma.streamerSettingTemplate.findFirst as jest.Mock).mockResolvedValue(null);

    const result = await service.delete("tpl-missing", "streamer-1");

    expect(result).toBe(false);
    expect(prisma.streamerSettingTemplate.delete).not.toHaveBeenCalled();
  });

  it("delete returns true when template is deleted", async () => {
    (prisma.streamerSettingTemplate.findFirst as jest.Mock).mockResolvedValue({
      id: "tpl-1",
      streamerId: "streamer-1",
    });
    (prisma.streamerSettingTemplate.delete as jest.Mock).mockResolvedValue(undefined);

    const result = await service.delete("tpl-1", "streamer-1");

    expect(prisma.streamerSettingTemplate.delete).toHaveBeenCalledWith({
      where: { id: "tpl-1" },
    });
    expect(result).toBe(true);
  });

  it("rethrows prisma errors from create", async () => {
    (prisma.streamerSettingTemplate.create as jest.Mock).mockRejectedValue(new Error("db failed"));

    await expect(service.create("streamer-1", { templateName: "X" })).rejects.toThrow("db failed");
  });
});
