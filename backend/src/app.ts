import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { oauthRoutes, apiRoutes } from "./modules/auth/auth.routes";
import { streamerRoutes } from "./modules/streamer/streamer.routes";
import { viewerApiRoutes } from "./modules/viewer/viewer.routes";
import { proxyRoutes } from "./modules/proxy/proxy.routes";
import { performanceMonitor } from "./utils/performance-monitor";
import { performanceRoutes } from "./modules/admin/performance.routes";
import { healthRoutes } from "./modules/admin/health.routes";
import twitchRoutes from "./routes/twitch.routes";
import helmet from "helmet";

// ... previous imports ...
import { eventSubRoutes } from "./routes/eventsub.routes";

class App {
  public express: express.Application;

  constructor() {
    this.express = express();
    this.middleware();
    this.routes();
  }

  private middleware(): void {
    // 0. 安全標頭 (Helmet)
    // 必須在最前面，且需要調整 CSP 以允許與 Twitch API 通訊
    this.express.use(
      helmet({
        crossOriginResourcePolicy: { policy: "cross-origin" },
      })
    );

    // 1. 設定 CORS
    // 允許前端帶 Cookie (credentials)，origin 必須指定確切的前端網址
    this.express.use(
      cors({
        origin: process.env.FRONTEND_URL || "http://localhost:3000",
        credentials: true,
        methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization"],
      })
    );

    // 2. 解析 JSON Body
    this.express.use(express.json());

    // 3. 解析 Cookies (處理 httpOnly cookie 必備)
    this.express.use(cookieParser());

    // 4. API 效能監控
    this.express.use(performanceMonitor.middleware());
  }

  private routes(): void {
    // OAuth 路由（公開）：/auth/twitch/login, /auth/twitch/callback
    this.express.use("/auth/twitch", oauthRoutes);

    // API 路由（需要認證）：/api/auth/me, /api/auth/logout
    this.express.use("/api/auth", apiRoutes);
    this.express.use("/api/viewer", viewerApiRoutes);
    this.express.use("/api/streamer", streamerRoutes);
    this.express.use("/api/proxy", proxyRoutes);

    // Twitch API 路由：/api/twitch/*
    this.express.use("/api/twitch", twitchRoutes);

    // 管理路由：效能監控
    this.express.use("/api/admin/performance", performanceRoutes);

    // 健康檢查路由
    this.express.use("/api/health", healthRoutes);

    // EventSub Webhook 路由 (Twitch 事件訂閱)
    this.express.use("/eventsub", eventSubRoutes);

    // 根路徑健康檢查
    this.express.get("/", (req, res) => {
      res.send("Streamer Backend is running!");
    });
  }
}

export default new App().express;
