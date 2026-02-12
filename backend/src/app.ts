import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { RedisStore, type RedisReply } from "rate-limit-redis";
import * as Sentry from "@sentry/node";
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

// Rate Limiting 閮剖?
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
  windowMs: 15 * 60 * 1000, // 15 ??
  max: isDev ? 1000 : 100, // ??啣??曉祝?
  message: { error: "Too many requests, please try again later." },
  standardHeaders: true, // 餈? RateLimit-* headers
  legacyHeaders: false, // ? X-RateLimit-* headers
  skip: (req) => {
    // 頝喲??亙熒瑼Ｘ蝡舫?
    return req.path === "/" || req.path.startsWith("/api/health");
  },
  store: createRateLimitStore("rl:api:"),
});

// ??隤?蝡舫???湔?
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 ??
  max: isDev ? 100 : 20, // ??啣??曉祝?
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

    // Zeabur 反向代理環境：啟用 trust proxy 以正確取得客戶端 IP
    // 否則 rate limiting 可能把所有請求視為同一來源
    if (process.env.NODE_ENV === "production") {
      this.express.set("trust proxy", 1);
    }

    this.middleware();
    this.routes();
  }

  private middleware(): void {
    // 0. 摰璅 (Helmet)
    // 敹??冽??嚗??閬矽??CSP 隞亙?閮梯? Twitch API ??
    this.express.use(
      helmet({
        crossOriginResourcePolicy: { policy: "cross-origin" },
      })
    );

    // 1. 閮剖? CORS嚗?? Rate Limiting 銋?嚗?
    // 蝣箔??喃蝙鋡恍?瘚??賣迤蝣箄???CORS headers
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

    // 2. Rate Limiting嚗甇?DoS ?餅?嚗?
    this.express.use("/api", apiLimiter);
    this.express.use("/auth", authLimiter);

    // 3. 閫?? JSON Body (? EventSub 頝臬?嚗???Twurple ?閬?raw body)
    this.express.use((req: Request, res: Response, next: NextFunction) => {
      if (req.path.startsWith("/api/eventsub")) {
        next();
      } else {
        express.json({ limit: JSON_BODY_LIMIT })(req, res, next);
      }
    });

    // 4. 閫?? Cookies (?? httpOnly cookie 敹?)
    this.express.use(cookieParser());

    // 5. API ???
    this.express.use(performanceMonitor.middleware());
  }

  private routes(): void {
    // OAuth 頝舐嚗??嚗?auth/twitch/login, /auth/twitch/callback
    this.express.use("/auth/twitch", oauthRoutes);

    // API 頝舐嚗?閬?霅?嚗?api/auth/me, /api/auth/logout
    this.express.use("/api/auth", apiRoutes);
    this.express.use("/api/viewer", viewerApiRoutes);
    this.express.use("/api/streamer", streamerRoutes);
    this.express.use("/api/proxy", proxyRoutes);

    // Twitch API 頝舐嚗?api/twitch/*
    this.express.use("/api/twitch", twitchRoutes);

    // 蝞∠?頝舐嚗??賜?改??? Streamer嚗?
    this.express.use(
      "/api/admin/performance",
      requireAuth(["streamer"]),
      performanceRoutes
    );

    // 蝞∠?頝舐嚗oken 蝞∠?嚗???Streamer嚗?
    this.express.use(
      "/api/admin/tokens",
      requireAuth(["streamer"]),
      tokenManagementRoutes
    );

    // 系統健康檢查路由 (公開，供 UptimeRobot 等監控服務使用)
    this.express.use("/api/health", healthRoutes);

    // ?汗?冽????API
    // 效能監控路由（根據環境變數啟用）
    if (process.env.ENABLE_MONITORING === "true") {
      this.express.use("/api/monitoring", requireAuth(["streamer"]), monitoringRoutes);
    }

    this.express.use("/api/sync", extensionRoutes);

    // EventSub Webhook 頝舐 (Twitch 鈭辣閮)
    this.express.use("/eventsub", eventSubRoutes);

    // ?寡楝敺摨瑟炎??
    this.express.get("/", (_req, res) => {
      res.send("Streamer Backend is running!");
    });

    // Sentry ?航炊??銝剝?隞塚?敹??冽??楝?曹?敺?
    if (process.env.SENTRY_DSN) {
      Sentry.setupExpressErrorHandler(this.express);
    }

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
