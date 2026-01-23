import { prisma } from "../../db/prisma";

export interface CreateTemplateDto {
  templateName: string;
  title?: string;
  gameId?: string;
  gameName?: string;
  tags?: string[];
}

export interface UpdateTemplateDto {
  templateName?: string;
  title?: string;
  gameId?: string;
  gameName?: string;
  tags?: string[];
}

export interface TemplateResponse {
  id: string;
  templateName: string;
  title: string | null;
  gameId: string | null;
  gameName: string | null;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

export class TemplateService {
  /**
   * 建立新模板
   */
  async create(streamerId: string, data: CreateTemplateDto): Promise<TemplateResponse> {
    const template = await prisma.streamerSettingTemplate.create({
      data: {
        streamerId,
        templateName: data.templateName,
        title: data.title,
        gameId: data.gameId,
        gameName: data.gameName,
        tags: data.tags ? JSON.stringify(data.tags) : null,
      },
    });

    return this.toResponse(template);
  }

  /**
   * 列出實況主的所有模板
   */
  async findAll(streamerId: string): Promise<TemplateResponse[]> {
    const templates = await prisma.streamerSettingTemplate.findMany({
      where: { streamerId },
      orderBy: { createdAt: "desc" },
    });

    return templates.map(this.toResponse);
  }

  /**
   * 取得單一模板
   */
  async findById(id: string, streamerId: string): Promise<TemplateResponse | null> {
    const template = await prisma.streamerSettingTemplate.findFirst({
      where: { id, streamerId },
    });

    return template ? this.toResponse(template) : null;
  }

  /**
   * 更新模板
   */
  async update(
    id: string,
    streamerId: string,
    data: UpdateTemplateDto
  ): Promise<TemplateResponse | null> {
    // 先確認模板存在且屬於該實況主
    const existing = await prisma.streamerSettingTemplate.findFirst({
      where: { id, streamerId },
    });

    if (!existing) {
      return null;
    }

    const template = await prisma.streamerSettingTemplate.update({
      where: { id },
      data: {
        templateName: data.templateName,
        title: data.title,
        gameId: data.gameId,
        gameName: data.gameName,
        tags: data.tags ? JSON.stringify(data.tags) : undefined,
      },
    });

    return this.toResponse(template);
  }

  /**
   * 刪除模板
   */
  async delete(id: string, streamerId: string): Promise<boolean> {
    const existing = await prisma.streamerSettingTemplate.findFirst({
      where: { id, streamerId },
    });

    if (!existing) {
      return false;
    }

    await prisma.streamerSettingTemplate.delete({
      where: { id },
    });

    return true;
  }

  private toResponse(template: {
    id: string;
    templateName: string;
    title: string | null;
    gameId: string | null;
    gameName: string | null;
    tags: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): TemplateResponse {
    return {
      id: template.id,
      templateName: template.templateName,
      title: template.title,
      gameId: template.gameId,
      gameName: template.gameName,
      tags: template.tags ? JSON.parse(template.tags) : [],
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
    };
  }
}

export const templateService = new TemplateService();
