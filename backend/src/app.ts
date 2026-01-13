import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import * as Sentry from "@sentry/node";
import { oauthRoutes, apiRoutes } from "./modules/auth/auth.routes";
import { streamerRoutes } from "./modules/streamer/streamer.routes";
import { viewerApiRoutes } from "./modules/viewer/viewer.routes";
import { proxyRoutes } from "./modules/proxy/proxy.routes";
import { performanceMonitor } from "./utils/performance-monitor";
import { performanceRoutes } from "./modules/admin/performance.routes";
import { healthRoutes } from "./modules/admin/health.routes";
import tokenManagementRoutes from "./modules/admin/token-management.routes";
import twitchRoutes from "./routes/twitch.routes";
import { eventSubRoutes } from "./routes/eventsub.routes";
import extensionRoutes from "./modules/extension/extension.routes";

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

    // 2. 解析 JSON Body (排除 EventSub 路徑，因為 Twurple 需要 raw body)
    this.express.use(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (req: any, res: any, next: any) => {
        if (req.path.startsWith("/api/eventsub")) {
          next();
        } else {
          express.json()(req, res, next);
        }
      }
    );

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

    // 管理路由：Token 管理
    this.express.use("/api/admin/tokens", tokenManagementRoutes);

    // 健康檢查路由
    this.express.use("/api/health", healthRoutes);

    // 瀏覽器擴充功能 API
    this.express.use("/api/extension", extensionRoutes);

    // EventSub Webhook 路由 (Twitch 事件訂閱)
    this.express.use("/eventsub", eventSubRoutes);

    // 根路徑健康檢查
    this.express.get("/", (req, res) => {
      res.send("Streamer Backend is running!");
    });

    // Sentry 錯誤處理中間件（必須在所有路由之後）
    if (process.env.SENTRY_DSN) {
      Sentry.setupExpressErrorHandler(this.express);
    }
  }
}

export default new App().express;
