import express from "express";
import axios from "axios";
import { env } from "../../config/env";

const router = express.Router();

/**
 * 驗證 hostname 是否為允許的網域
 * 使用精確匹配避免繞過攻擊 (e.g., evil-static-cdn.jtvnw.net.attacker.com)
 */
function isAllowedDomain(hostname: string, allowedDomains: string[]): boolean {
  return allowedDomains.some((domain) => {
    // 精確匹配或子網域匹配
    return hostname === domain || hostname.endsWith(`.${domain}`);
  });
}

/**
 * Avatar Proxy API
 * 代理 Twitch CDN 圖片以避免前端 CORB 問題
 *
 * GET /api/proxy/avatar?url=<encoded_url>
 */
router.get("/avatar", async (req, res) => {
  const { url } = req.query;

  if (!url || typeof url !== "string") {
    return res
      .status(400)
      .json({ error: "Missing or invalid 'url' parameter" });
  }

  try {
    // 解碼 URL
    const decodedUrl = decodeURIComponent(url);

    // 驗證 URL 是合法的 Twitch CDN 或 ui-avatars
    const allowedDomains = [
      "static-cdn.jtvnw.net",
      "ui-avatars.com",
      "assets.twitch.tv",
    ];

    const urlObj = new URL(decodedUrl);

    // 使用精確匹配驗證網域
    if (!isAllowedDomain(urlObj.hostname, allowedDomains)) {
      return res.status(403).json({ error: "Domain not allowed" });
    }

    // 確保使用 HTTPS
    if (urlObj.protocol !== "https:") {
      return res.status(403).json({ error: "Only HTTPS URLs are allowed" });
    }

    // 發送請求獲取圖片
    const response = await axios.get(decodedUrl, {
      responseType: "arraybuffer",
      timeout: 10000, // 10 秒超時
      headers: {
        "User-Agent": "TwitchAnalytics/1.0",
      },
    });

    // 設定回應 headers
    const contentType = response.headers["content-type"] || "image/png";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400"); // 快取 1 天
    // 使用 frontendUrl 限制 CORS，而非開放給所有來源
    res.setHeader("Access-Control-Allow-Origin", env.frontendUrl);

    return res.send(Buffer.from(response.data));
  } catch (error) {
    console.error("[Avatar Proxy] Error:", error);

    // 返回預設頭像
    return res.redirect(
      `https://ui-avatars.com/api/?name=User&background=random&size=128`
    );
  }
});

export const proxyRoutes = router;
