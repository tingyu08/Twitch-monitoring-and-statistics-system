import { Request as ExpressRequest, Response } from "express";
import { streamerSettingsService } from "./streamer-settings.service";
import { templateService } from "./template.service";

interface AuthenticatedRequest extends ExpressRequest {
  user?: {
    streamerId?: string;
    viewerId?: string;
    displayName?: string;
  };
}

export class StreamerSettingsController {
  /**
   * GET /api/streamer/settings
   * 獲取當前頻道設定
   */
  async getSettings(req: AuthenticatedRequest, res: Response) {
    try {
      const streamerId = req.user?.streamerId;
      if (!streamerId) {
        return res.status(403).json({ error: "Streamer access required" });
      }

      const settings = await streamerSettingsService.getChannelInfo(streamerId);
      if (!settings) {
        return res.status(404).json({ error: "Channel info not found" });
      }

      return res.json(settings);
    } catch (error) {
      console.error("[StreamerSettingsController] getSettings error:", error);
      return res.status(500).json({ error: "Failed to get channel settings" });
    }
  }

  /**
   * POST /api/streamer/settings
   * 更新頻道設定
   */
  async updateSettings(req: AuthenticatedRequest, res: Response) {
    try {
      const streamerId = req.user?.streamerId;
      if (!streamerId) {
        return res.status(403).json({ error: "Streamer access required" });
      }

      const { title, gameId, tags, language } = req.body;

      // 驗證
      if (title && title.length > 140) {
        return res
          .status(400)
          .json({ error: "Title must be 140 characters or less" });
      }
      if (tags && tags.length > 10) {
        return res.status(400).json({ error: "Maximum 10 tags allowed" });
      }

      await streamerSettingsService.updateChannelInfo(streamerId, {
        title,
        gameId,
        tags,
        language,
      });

      return res.json({
        success: true,
        message: "Settings updated successfully",
      });
    } catch (error) {
      console.error(
        "[StreamerSettingsController] updateSettings error:",
        error
      );
      return res
        .status(500)
        .json({ error: "Failed to update channel settings" });
    }
  }

  /**
   * GET /api/streamer/games/search?q=xxx
   * 搜尋遊戲分類
   */
  async searchGames(req: AuthenticatedRequest, res: Response) {
    try {
      const query = req.query.q as string;
      if (!query || query.length < 2) {
        return res.json([]);
      }

      const games = await streamerSettingsService.searchGames(query);
      return res.json(games);
    } catch (error) {
      console.error("[StreamerSettingsController] searchGames error:", error);
      return res.status(500).json({ error: "Failed to search games" });
    }
  }

  // ========== 模板 CRUD ==========

  /**
   * GET /api/streamer/templates
   * 列出所有模板
   */
  async listTemplates(req: AuthenticatedRequest, res: Response) {
    try {
      const streamerId = req.user?.streamerId;
      if (!streamerId) {
        return res.status(403).json({ error: "Streamer access required" });
      }

      const templates = await templateService.findAll(streamerId);
      return res.json(templates);
    } catch (error) {
      console.error("[StreamerSettingsController] listTemplates error:", error);
      return res.status(500).json({ error: "Failed to list templates" });
    }
  }

  /**
   * POST /api/streamer/templates
   * 建立模板
   */
  async createTemplate(req: AuthenticatedRequest, res: Response) {
    try {
      const streamerId = req.user?.streamerId;
      if (!streamerId) {
        return res.status(403).json({ error: "Streamer access required" });
      }

      const { templateName, title, gameId, gameName, tags } = req.body;

      if (!templateName) {
        return res.status(400).json({ error: "Template name is required" });
      }

      const template = await templateService.create(streamerId, {
        templateName,
        title,
        gameId,
        gameName,
        tags,
      });

      return res.status(201).json(template);
    } catch (error) {
      console.error(
        "[StreamerSettingsController] createTemplate error:",
        error
      );
      return res.status(500).json({ error: "Failed to create template" });
    }
  }

  /**
   * PUT /api/streamer/templates/:id
   * 更新模板
   */
  async updateTemplate(req: AuthenticatedRequest, res: Response) {
    try {
      const streamerId = req.user?.streamerId;
      if (!streamerId) {
        return res.status(403).json({ error: "Streamer access required" });
      }

      const { id } = req.params;
      const { templateName, title, gameId, gameName, tags } = req.body;

      const template = await templateService.update(id, streamerId, {
        templateName,
        title,
        gameId,
        gameName,
        tags,
      });

      if (!template) {
        return res.status(404).json({ error: "Template not found" });
      }

      return res.json(template);
    } catch (error) {
      console.error(
        "[StreamerSettingsController] updateTemplate error:",
        error
      );
      return res.status(500).json({ error: "Failed to update template" });
    }
  }

  /**
   * DELETE /api/streamer/templates/:id
   * 刪除模板
   */
  async deleteTemplate(req: AuthenticatedRequest, res: Response) {
    try {
      const streamerId = req.user?.streamerId;
      if (!streamerId) {
        return res.status(403).json({ error: "Streamer access required" });
      }

      const { id } = req.params;
      const deleted = await templateService.delete(id, streamerId);

      if (!deleted) {
        return res.status(404).json({ error: "Template not found" });
      }

      return res.json({ success: true, message: "Template deleted" });
    } catch (error) {
      console.error(
        "[StreamerSettingsController] deleteTemplate error:",
        error
      );
      return res.status(500).json({ error: "Failed to delete template" });
    }
  }
}

export const streamerSettingsController = new StreamerSettingsController();
