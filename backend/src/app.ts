import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
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
import { requireAuth } from "./modules/auth/auth.middleware";

// Rate Limiting 閮剖?
const isDev = process.env.NODE_ENV === "development";
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
});

class App {
  public express: express.Application;

  constructor() {
    this.express = express();

    // ??Render/Heroku 蝑蝡臬像?唬?嚗??函?撘??隞??敺??
    // ?閬縑隞颱誨?誑甇?Ⅱ?脣?摰Ｘ蝡?IP嚗??Rate Limiting嚗?
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
        origin: process.env.FRONTEND_URL || "http://localhost:3000",
        credentials: true,
        methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization"],
      })
    );

    // 2. Rate Limiting嚗甇?DoS ?餅?嚗?
    this.express.use("/api", apiLimiter);
    this.express.use("/auth", authLimiter);

    // 3. 閫?? JSON Body (? EventSub 頝臬?嚗???Twurple ?閬?raw body)
    this.express.use(
      (req: Request, res: Response, next: NextFunction) => {
        if (req.path.startsWith("/api/eventsub")) {
          next();
        } else {
          express.json()(req, res, next);
        }
      }
    );

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
      (req, res, next) => requireAuth(req, res, next, ["streamer"]),
      performanceRoutes
    );

    // 蝞∠?頝舐嚗oken 蝞∠?嚗???Streamer嚗?
    this.express.use(
      "/api/admin/tokens",
      (req, res, next) => requireAuth(req, res, next, ["streamer"]),
      tokenManagementRoutes
    );

    // ?亙熒瑼Ｘ頝舐嚗??歇隤??冽嚗?
    this.express.use(
      "/api/health",
      (req, res, next) => requireAuth(req, res, next, ["streamer", "viewer"]),
      healthRoutes
    );

    // ?汗?冽????API
    this.express.use("/api/extension", extensionRoutes);

    // EventSub Webhook 頝舐 (Twitch 鈭辣閮)
    this.express.use("/eventsub", eventSubRoutes);

    // ?寡楝敺摨瑟炎??
    this.express.get("/", (req, res) => {
      res.send("Streamer Backend is running!");
    });

    // Sentry ?航炊??銝剝?隞塚?敹??冽??楝?曹?敺?
    if (process.env.SENTRY_DSN) {
      Sentry.setupExpressErrorHandler(this.express);
    }
  }
}

export default new App().express;
