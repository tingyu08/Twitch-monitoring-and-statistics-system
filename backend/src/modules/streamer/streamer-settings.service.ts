import { prisma } from "../../db/prisma";
import { TwitchOAuthClient } from "../auth/twitch-oauth.client";
import { env } from "../../config/env";
import { decryptToken } from "../../utils/crypto.utils";

export interface ChannelInfo {
  title: string;
  gameId: string;
  gameName: string;
  tags: string[];
  language: string;
}

export interface UpdateChannelInfoDto {
  title?: string;
  gameId?: string;
  tags?: string[];
  language?: string;
}

export class StreamerSettingsService {
  private twitchClient: TwitchOAuthClient;

  constructor() {
    this.twitchClient = new TwitchOAuthClient();
  }

  /**
   * 從 Twitch API 獲取實況主當前頻道設定
   */
  async getChannelInfo(streamerId: string): Promise<ChannelInfo | null> {
    const streamer = await prisma.streamer.findUnique({
      where: { id: streamerId },
      include: {
        twitchTokens: {
          where: { ownerType: "streamer", status: "active" },
          orderBy: { updatedAt: "desc" },
          take: 1,
        },
      },
    });

    if (!streamer || streamer.twitchTokens.length === 0) {
      return null;
    }

    const encryptedToken = streamer.twitchTokens[0].accessToken;
    const accessToken = decryptToken(encryptedToken);
    const broadcasterId = streamer.twitchUserId;

    try {
      const response = await fetch(
        `https://api.twitch.tv/helix/channels?broadcaster_id=${broadcasterId}`,
        {
          headers: {
            "Client-Id": env.twitchClientId,
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );

      if (!response.ok) {
        throw new Error(`Twitch API error: ${response.status}`);
      }

      const data = await response.json();
      const channel = data.data?.[0];

      if (!channel) {
        return null;
      }

      return {
        title: channel.title || "",
        gameId: channel.game_id || "",
        gameName: channel.game_name || "",
        tags: channel.tags || [],
        language: channel.broadcaster_language || "zh",
      };
    } catch (error) {
      console.error("[StreamerSettingsService] getChannelInfo error:", error);
      throw error;
    }
  }

  /**
   * 更新實況主頻道設定到 Twitch
   */
  async updateChannelInfo(
    streamerId: string,
    data: UpdateChannelInfoDto,
  ): Promise<boolean> {
    const streamer = await prisma.streamer.findUnique({
      where: { id: streamerId },
      include: {
        twitchTokens: {
          where: { ownerType: "streamer", status: "active" },
          orderBy: { updatedAt: "desc" },
          take: 1,
        },
      },
    });

    if (!streamer || streamer.twitchTokens.length === 0) {
      throw new Error("Streamer not found or no valid token");
    }

    const encryptedToken = streamer.twitchTokens[0].accessToken;
    const accessToken = decryptToken(encryptedToken);
    const broadcasterId = streamer.twitchUserId;

    // Twitch API 要求的 body 格式
    const body: Record<string, unknown> = {};
    if (data.title !== undefined) body.title = data.title;
    if (data.gameId !== undefined) body.game_id = data.gameId;
    if (data.tags !== undefined) body.tags = data.tags;
    if (data.language !== undefined) body.broadcaster_language = data.language;

    try {
      const response = await fetch(
        `https://api.twitch.tv/helix/channels?broadcaster_id=${broadcasterId}`,
        {
          method: "PATCH",
          headers: {
            "Client-Id": env.twitchClientId,
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error(
          "[StreamerSettingsService] updateChannelInfo error:",
          errorText,
        );
        throw new Error(`Twitch API error: ${response.status}`);
      }

      return true;
    } catch (error) {
      console.error(
        "[StreamerSettingsService] updateChannelInfo error:",
        error,
      );
      throw error;
    }
  }

  /**
   * 搜尋遊戲分類
   */
  async searchGames(
    query: string,
  ): Promise<Array<{ id: string; name: string; boxArtUrl: string }>> {
    if (!query || query.length < 2) {
      return [];
    }

    // 需要使用 app access token 或 user access token
    // 這裡簡化處理，使用第一個可用的 streamer token
    const token = await prisma.twitchToken.findFirst({
      where: { status: "active" },
      orderBy: { updatedAt: "desc" },
    });

    if (!token) {
      return [];
    }

    try {
      const accessToken = decryptToken(token.accessToken);
      const response = await fetch(
        `https://api.twitch.tv/helix/search/categories?query=${encodeURIComponent(
          query,
        )}&first=10`,
        {
          headers: {
            "Client-Id": env.twitchClientId,
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );

      if (!response.ok) {
        return [];
      }

      const data = await response.json();
      return (data.data || []).map(
        (game: { id: string; name: string; box_art_url: string }) => ({
          id: game.id,
          name: game.name,
          boxArtUrl:
            game.box_art_url
              ?.replace("{width}", "52")
              .replace("{height}", "72") || "",
        }),
      );
    } catch {
      return [];
    }
  }

  /**
   * 建立設定模板
   */
  async createTemplate(
    streamerId: string,
    data: {
      templateName: string;
      title: string;
      gameId?: string;
      gameName?: string;
      tags?: string[];
      language?: string;
    },
  ) {
    return prisma.streamerSettingTemplate.create({
      data: {
        streamerId,
        templateName: data.templateName,
        title: data.title,
        gameId: data.gameId,
        gameName: data.gameName,
        tags: data.tags ? JSON.stringify(data.tags) : undefined,
      },
    });
  }

  /**
   * 取得實況主的所有模板
   */
  async getTemplates(streamerId: string) {
    const templates = await prisma.streamerSettingTemplate.findMany({
      where: { streamerId },
      orderBy: { createdAt: "desc" },
    });

    return templates.map((tpl) => ({
      ...tpl,
      tags: tpl.tags ? JSON.parse(tpl.tags) : [],
    }));
  }

  /**
   * 刪除模板
   */
  async deleteTemplate(streamerId: string, templateId: string) {
    // 確認模板屬於該實況主
    const template = await prisma.streamerSettingTemplate.findFirst({
      where: { id: templateId, streamerId },
    });

    if (!template) {
      throw new Error("Template not found or permission denied");
    }

    await prisma.streamerSettingTemplate.delete({
      where: { id: templateId },
    });

    return true;
  }
}

export const streamerSettingsService = new StreamerSettingsService();
