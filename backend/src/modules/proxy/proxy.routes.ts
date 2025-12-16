import express from "express";
import axios from "axios";

const router = express.Router();

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
    if (!allowedDomains.some((domain) => urlObj.hostname.includes(domain))) {
      return res.status(403).json({ error: "Domain not allowed" });
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
    res.setHeader("Access-Control-Allow-Origin", "*");

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
