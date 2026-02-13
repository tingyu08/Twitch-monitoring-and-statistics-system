import { Router } from "express";
import { streamerSettingsController } from "./streamer-settings.controller";
import { requireAuth } from "../auth/auth.middleware";
import { validateRequest } from "../../middlewares/validate.middleware";
import {
  createTemplateSchema,
  updateSettingsSchema,
  updateTemplateSchema,
} from "./streamer-settings.schema";

const router = Router();

// 所有路由都需要認證
router.use(requireAuth());

// ========== 頻道設定 ==========

// GET /api/streamer/settings - 獲取當前頻道設定
router.get("/settings", (req, res) => streamerSettingsController.getSettings(req, res));

// POST /api/streamer/settings - 更新頻道設定
router.post(
  "/settings",
  validateRequest(updateSettingsSchema),
  (req, res) => streamerSettingsController.updateSettings(req, res)
);

// GET /api/streamer/games/search?q=xxx - 搜尋遊戲分類
router.get("/games/search", (req, res) => streamerSettingsController.searchGames(req, res));

// ========== 設定模板 ==========

// GET /api/streamer/templates - 列出所有模板
router.get("/templates", (req, res) => streamerSettingsController.listTemplates(req, res));

// POST /api/streamer/templates - 建立模板
router.post(
  "/templates",
  validateRequest(createTemplateSchema),
  (req, res) => streamerSettingsController.createTemplate(req, res)
);

// PUT /api/streamer/templates/:id - 更新模板
router.put(
  "/templates/:id",
  validateRequest(updateTemplateSchema),
  (req, res) => streamerSettingsController.updateTemplate(req, res)
);

// DELETE /api/streamer/templates/:id - 刪除模板
router.delete("/templates/:id", (req, res) => streamerSettingsController.deleteTemplate(req, res));

export default router;
