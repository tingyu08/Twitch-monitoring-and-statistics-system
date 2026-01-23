import { Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";
import { logger } from "../utils/logger";

interface ViewerChannelStats {
  channelId: string;
  messageCount: number;
}

export class WebSocketGateway {
  private io: Server | null = null;
  private readonly CORS_ORIGIN = process.env.FRONTEND_URL || "http://localhost:3000";

  public initialize(httpServer: HttpServer) {
    this.io = new Server(httpServer, {
      cors: {
        origin: this.CORS_ORIGIN,
        methods: ["GET", "POST"],
        credentials: true,
      },
      path: "/socket.io", // 默認路徑
    });

    this.io.on("connection", (socket: Socket) => {
      this.handleConnection(socket);
    });

    logger.info("WebSocket", "Socket.IO Gateway initialized");
  }

  private handleConnection(socket: Socket) {
    // logger.info("WebSocket", `Client connected: ${socket.id}`);

    // Join room based on user/channel if needed in future
    // socket.on("join-channel", (channelId: string) => {
    //   socket.join(`channel:${channelId}`);
    // });

    socket.on("disconnect", () => {
      // logger.info("WebSocket", `Client disconnected: ${socket.id}`);
    });
  }

  /**
   * 推送單一頻道的即時統計更新
   */
  public broadcastChannelStats(channelId: string, stats: Partial<ViewerChannelStats>) {
    if (!this.io) return;
    // 簡單起見，目前廣播給所有人，或者只廣播給關注該頻道的房間
    // this.io.to(`channel:${channelId}`).emit("stats-update", { channelId, ...stats });

    // 為了首頁即時更新，我們廣播給所有人
    this.io.emit("stats-update", { channelId, ...stats });
  }

  /**
   * 通用廣播
   */
  public emit(event: string, data: unknown) {
    if (this.io) {
      this.io.emit(event, data);
    }
  }
}

export const webSocketGateway = new WebSocketGateway();
