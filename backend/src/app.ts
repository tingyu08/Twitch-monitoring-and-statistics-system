import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { RedisStore, type RedisReply } from "rate-limit-redis";
import { oauthRoutes, apiRoutes } from "./modules/auth/auth.routes";
import { streamerRoutes } from "./modules/streamer/streamer.routes";
import { viewerApiRoutes } from "./modules/viewer/viewer.routes";
import { proxyRoutes } from "./modules/proxy/proxy.routes";
import { performanceMonitor } from "./utils/performance-monitor";
import { performanceRoutes } from "./modules/admin/performance.routes";
import { healthRoutes } from "./modules/admin/health.routes";
import tokenManagementRoutes from "./modules/admin/token-management.routes";
import monitoringRoutes from "./routes/monitoring.routes";
import twitchRoutes from "./routes/twitch.routes";
import { eventSubRoutes } from "./routes/eventsub.routes";
import extensionRoutes from "./modules/extension/extension.routes";
import { requireAuth } from "./modules/auth/auth.middleware";
import { getRedisClient } from "./utils/redis-client";

// Rate limiting 設定
const isDev = process.env.NODE_ENV === "development";
const redisClient = getRedisClient();

function createRateLimitStore(prefix: string): RedisStore | undefined {
  if (!redisClient) {
    return undefined;
  }

  return new RedisStore({
    prefix,
    sendCommand: (...args: string[]) =>
      redisClient.call(args[0], ...args.slice(1)) as Promise<RedisReply>,
  });
}

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 分鐘
  max: isDev ? 1000 : 100, // 開發環境放寬限制，正式環境較嚴格
  message: { error: "Too many requests, please try again later." },
  standardHeaders: true, // 啟用標準 RateLimit-* headers
  legacyHeaders: false, // 停用舊版 X-RateLimit-* headers
  skip: (req) => {
    // 跳過首頁與健康檢查端點
    return req.path === "/" || req.path.startsWith("/api/health");
  },
  store: createRateLimitStore("rl:api:"),
});

// 認證相關端點使用更嚴格的限制
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 分鐘
  max: isDev ? 100 : 20, // 開發環境放寬限制，正式環境較嚴格
  message: {
    error: "Too many authentication attempts, please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  store: createRateLimitStore("rl:auth:"),
});

const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT || "1mb";

class App {
  public express: express.Application;

  constructor() {
    this.express = express();

    // Zeabur 等反向代理環境需要設定 trust proxy，
    // 否則 rate limiting 會拿不到正確的客戶端 IP。
    if (process.env.NODE_ENV === "production") {
      this.express.set("trust proxy", 1);
    }

    this.middleware();
    this.routes();
  }

  private middleware(): void {
    // 0. 安全性標頭中介層 (Helmet)
    // 先維持寬鬆設定，避免 CSP 影響前端或 Twitch API 整合。
    this.express.use(
      helmet({
        crossOriginResourcePolicy: { policy: "cross-origin" },
      })
    );

    // 1. 先設定 CORS，再進入後續 Rate Limiting 與 API 處理
    // 讓瀏覽器預檢與跨網域請求都能拿到正確的 CORS headers。
    this.express.use(
      cors({
        origin: process.env.FRONTEND_URL
          ? [process.env.FRONTEND_URL, "http://localhost:3000", "http://127.0.0.1:3000"]
          : ["http://localhost:3000", "http://127.0.0.1:3000"],
        credentials: true,
        methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
        allowedHeaders: ["Content-Type", "Authorization"],
      })
    );

    // 2. Rate limiting，降低濫用與 DoS 風險
    this.express.use("/api", apiLimiter);
    this.express.use("/auth", authLimiter);

    // 3. 解析 JSON body，但保留 EventSub webhook 的 raw body 給 Twurple 驗證
    this.express.use((req: Request, res: Response, next: NextFunction) => {
      if (req.path.startsWith("/api/eventsub")) {
        next();
      } else {
        express.json({ limit: JSON_BODY_LIMIT })(req, res, next);
      }
    });

    // 4. 解析 Cookies（支援 httpOnly cookie 驗證）
    this.express.use(cookieParser());

    // 5. API 效能監控
    this.express.use(performanceMonitor.middleware());
  }

  private routes(): void {
    // OAuth 相關路由，例如 /auth/twitch/login、/auth/twitch/callback
    this.express.use("/auth/twitch", oauthRoutes);

    // API 認證路由，例如 /api/auth/me、/api/auth/logout
    this.express.use("/api/auth", apiRoutes);
    this.express.use("/api/viewer", viewerApiRoutes);
    this.express.use("/api/streamer", streamerRoutes);
    this.express.use("/api/proxy", proxyRoutes);

    // Twitch API 代理路由，例如 /api/twitch/*
    this.express.use("/api/twitch", twitchRoutes);

    // 受保護的效能監控路由，僅限 streamer 角色
    this.express.use(
      "/api/admin/performance",
      requireAuth(["streamer"]),
      performanceRoutes
    );

    // 受保護的 token 管理路由，僅限 streamer 角色
    this.express.use(
      "/api/admin/tokens",
      requireAuth(["streamer"]),
      tokenManagementRoutes
    );

    // 健康檢查路由（提供給 UptimeRobot 等監控服務使用）
    this.express.use("/api/health", healthRoutes);

    // 條件啟用的監控 API
    // 只有在設定 ENABLE_MONITORING=true 時才開放。
    if (process.env.ENABLE_MONITORING === "true") {
      this.express.use("/api/monitoring", requireAuth(["streamer"]), monitoringRoutes);
    }

    this.express.use("/api/sync", extensionRoutes);

    // EventSub webhook 路由（Twitch 事件通知回呼）
    this.express.use("/eventsub", eventSubRoutes);

    // 根路由健康回應
    this.express.get("/", (_req, res) => {
      res.send("Streamer Backend is running!");
    });

    // Global error handler (must be registered last)
    this.express.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
      const error = err instanceof Error ? err : new Error("Unknown error");

      // Ensure we don't leak details in production
      if (process.env.NODE_ENV === "development") {
        return res.status(500).json({
          error: "Internal Server Error",
          message: error.message,
          stack: error.stack,
        });
      }

      return res.status(500).json({ error: "Internal Server Error" });
    });
  }
}

export default new App().express;
