import { Router } from "express";
import { requireAuth } from "../auth/auth.middleware";
import { getSummaryHandler } from "./streamer.controller";

const router = Router();

// GET /api/streamer/me/summary?range=30d
router.get("/me/summary", requireAuth, getSummaryHandler);

export const streamerRoutes = router;