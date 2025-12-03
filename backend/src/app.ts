import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { oauthRoutes, apiRoutes } from './modules/auth/auth.routes';
import { env as config } from './config/env';

class App {
  public express: express.Application;

  constructor() {
    this.express = express();
    this.middleware();
    this.routes();
  }

  private middleware(): void {
    // 1. 設定 CORS
    // 允許前端帶 Cookie (credentials)，origin 必須指定確切的前端網址
    this.express.use(cors({
      origin: process.env.FRONTEND_URL || 'http://localhost:3000',
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization']
    }));

    // 2. 解析 JSON Body
    this.express.use(express.json());

    // 3. 解析 Cookies (處理 httpOnly cookie 必備)
    this.express.use(cookieParser());
  }

  private routes(): void {
    // OAuth 路由（公開）：/auth/twitch/login, /auth/twitch/callback
    this.express.use('/auth/twitch', oauthRoutes);
    
    // API 路由（需要認證）：/api/auth/me, /api/auth/logout
    this.express.use('/api/auth', apiRoutes);

    // 健康檢查
    this.express.get('/', (req, res) => {
      res.send('Streamer Backend is running!');
    });
  }
}

export default new App().express;