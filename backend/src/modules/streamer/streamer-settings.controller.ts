import type { Response } from "express";
import { streamerSettingsService } from "./streamer-settings.service";
import type { AuthRequest } from "../auth/auth.middleware";
import { logger } from "../../utils/logger";

export class StreamerSettingsController {
  // 獲取設定
  async getSettings(req: AuthRequest, res: Response) {
    try {
      const streamerId = req.user?.streamerId;
      if (!streamerId) {
        return res.status(403).json({ error: "Not a streamer or not authenticated" });
      }
      const settings = await streamerSettingsService.getChannelInfo(streamerId);
      if (!settings) {
        return res.status(404).json({ error: "Settings not found" });
      }
      return res.json(settings);
    } catch (error) {
      logger.error("StreamerSettings", "Get settings error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  // 更新設定
  async updateSettings(req: AuthRequest, res: Response) {
    try {
      const streamerId = req.user?.streamerId;
      if (!streamerId) {
        return res.status(403).json({ error: "Not a streamer or not authenticated" });
      }
      const success = await streamerSettingsService.updateChannelInfo(streamerId, req.body);
      if (success) {
        return res.json({ success: true });
      }
      return res.status(400).json({ error: "Failed to update settings" });
    } catch (error) {
      logger.error("StreamerSettings", "Update settings error:", error);
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
      logger.error("StreamerSettings", "Search games error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  // 列出模板
  async listTemplates(req: AuthRequest, res: Response) {
    try {
      const streamerId = req.user?.streamerId;
      if (!streamerId) {
        return res.status(403).json({ error: "Not a streamer or not authenticated" });
      }
      const templates = await streamerSettingsService.getTemplates(streamerId);
      return res.json(templates);
    } catch (error) {
      logger.error("StreamerSettings", "List templates error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  // 建立模板
  async createTemplate(req: AuthRequest, res: Response) {
    try {
      const streamerId = req.user?.streamerId;
      if (!streamerId) {
        return res.status(403).json({ error: "Not a streamer or not authenticated" });
      }
      const template = await streamerSettingsService.createTemplate(streamerId, req.body);
      return res.status(201).json(template);
    } catch (error) {
      logger.error("StreamerSettings", "Create template error:", error);
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
      const streamerId = req.user?.streamerId;
      if (!streamerId) {
        return res.status(403).json({ error: "Not a streamer or not authenticated" });
      }
      const templateId = req.params.id;
      await streamerSettingsService.deleteTemplate(streamerId, templateId);
      return res.json({ success: true });
    } catch (error) {
      logger.error("StreamerSettings", "Delete template error:", error);
      return res.status(500).json({ error: "Failed to delete template" });
    }
  }
}

export const streamerSettingsController = new StreamerSettingsController();
