import type { Response } from "express";
import type { AuthRequest } from "../auth/auth.middleware";
import { getStreamerSummary } from "./streamer.service";

export async function getSummaryHandler(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const streamerId = req.user?.streamerId;
    if (!streamerId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const range = (req.query.range as string) || "30d";
    
    // 驗證 range 參數
    if (!["7d", "30d", "90d"].includes(range)) {
      res.status(400).json({ error: "Invalid range parameter. Use 7d, 30d, or 90d." });
      return;
    }

    const summary = await getStreamerSummary(streamerId, range);
    res.json(summary);
  } catch (error) {
    console.error("Get Summary Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
}