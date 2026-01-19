import type { Response } from "express";
import { streamerSettingsService } from "./streamer-settings.service";
import type { AuthRequest } from "../auth/auth.middleware";

export class StreamerSettingsController {
  // 獲取設定
  async getSettings(req: AuthRequest, res: Response) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const streamerId = req.user!.streamerId!;
      const settings = await streamerSettingsService.getChannelInfo(streamerId);
      if (!settings) {
        return res.status(404).json({ error: "Settings not found" });
      }
      return res.json(settings);
    } catch (error) {
      console.error("Get settings error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  // 更新設定
  async updateSettings(req: AuthRequest, res: Response) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const streamerId = req.user!.streamerId!;
      const success = await streamerSettingsService.updateChannelInfo(
        streamerId,
        req.body,
      );
      if (success) {
        return res.json({ success: true });
      }
      return res.status(400).json({ error: "Failed to update settings" });
    } catch (error) {
      console.error("Update settings error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  // 搜尋遊戲
  async searchGames(req: AuthRequest, res: Response) {
    try {
      const query = req.query.q as string;
      const games = await streamerSettingsService.searchGames(query);
      return res.json(games);
    } catch (error) {
      console.error("Search games error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  // 列出模板
  async listTemplates(req: AuthRequest, res: Response) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const streamerId = req.user!.streamerId!;
      const templates = await streamerSettingsService.getTemplates(streamerId);
      return res.json(templates);
    } catch (error) {
      console.error("List templates error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  // 建立模板
  async createTemplate(req: AuthRequest, res: Response) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const streamerId = req.user!.streamerId!;
      const template = await streamerSettingsService.createTemplate(
        streamerId,
        req.body,
      );
      return res.status(201).json(template);
    } catch (error) {
      console.error("Create template error:", error);
      return res.status(500).json({ error: "Failed to create template" });
    }
  }

  // 更新模板
  async updateTemplate(req: AuthRequest, res: Response) {
    return res.status(501).json({ error: "Not implemented" });
  }

  // 刪除模板
  async deleteTemplate(req: AuthRequest, res: Response) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const streamerId = req.user!.streamerId!;
      const templateId = req.params.id;
      await streamerSettingsService.deleteTemplate(streamerId, templateId);
      return res.json({ success: true });
    } catch (error) {
      console.error("Delete template error:", error);
      return res.status(500).json({ error: "Failed to delete template" });
    }
  }
}

export const streamerSettingsController = new StreamerSettingsController();
