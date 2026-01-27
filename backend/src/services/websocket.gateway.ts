import { Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";
import { logger } from "../utils/logger";

interface ViewerChannelStats {
  channelId: string;
  messageCount: number;
}

/**
 * P1 Memory: Optimized WebSocket Gateway with room-based broadcasting
 * - Uses Socket.IO rooms to reduce O(n×m) traffic to O(n)
 * - Only sends updates to clients subscribed to specific channels
 */
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
      // P1 Memory: Optimize for Render Free Tier
      pingTimeout: 60000,
      pingInterval: 25000,
    });

    this.io.on("connection", (socket: Socket) => {
      this.handleConnection(socket);
    });

    logger.info("WebSocket", "Socket.IO Gateway initialized with room support");
  }

  private handleConnection(socket: Socket) {
    logger.debug("WebSocket", `Client connected: ${socket.id}`);

    // P1 Memory: Join channel-specific rooms for targeted broadcasting
    socket.on("join-channel", (channelId: string) => {
      if (channelId && typeof channelId === "string") {
        socket.join(`channel:${channelId}`);
        logger.debug("WebSocket", `Client ${socket.id} joined room: channel:${channelId}`);
      }
    });

    // P1 Memory: Leave channel room when no longer needed
    socket.on("leave-channel", (channelId: string) => {
      if (channelId && typeof channelId === "string") {
        socket.leave(`channel:${channelId}`);
        logger.debug("WebSocket", `Client ${socket.id} left room: channel:${channelId}`);
      }
    });

    // P1 Memory: Join viewer-specific room for personal updates
    socket.on("join-viewer", (viewerId: string) => {
      if (viewerId && typeof viewerId === "string") {
        socket.join(`viewer:${viewerId}`);
        logger.debug("WebSocket", `Client ${socket.id} joined room: viewer:${viewerId}`);
      }
    });

    socket.on("disconnect", (reason) => {
      logger.debug("WebSocket", `Client disconnected: ${socket.id}, reason: ${reason}`);
    });

    // Send acknowledgment on connect
    socket.emit("connected", { socketId: socket.id });
  }

  /**
   * P1 Memory: Push stats only to clients subscribed to this channel
   * Changed from broadcast to room-based emit
   */
  public broadcastChannelStats(channelId: string, stats: Partial<ViewerChannelStats>) {
    if (!this.io) return;

    // Emit to channel-specific room only (O(n) instead of O(n×m))
    this.io.to(`channel:${channelId}`).emit("stats-update", { channelId, ...stats });

    // Also emit to global room for dashboard overview (optional)
    // Clients that want all updates can listen to this
    this.io.emit("stats-update-global", { channelId, ...stats });
  }

  /**
   * P1 Memory: Send update to a specific viewer
   */
  public emitToViewer(viewerId: string, event: string, data: unknown) {
    if (this.io) {
      this.io.to(`viewer:${viewerId}`).emit(event, data);
    }
  }

  /**
   * 通用廣播 (use sparingly - prefer room-based emit)
   */
  public emit(event: string, data: unknown) {
    if (this.io) {
      this.io.emit(event, data);
    }
  }

  /**
   * Get connected client count for monitoring
   */
  public getConnectionCount(): number {
    if (!this.io) return 0;
    return this.io.sockets.sockets.size;
  }
}

export const webSocketGateway = new WebSocketGateway();
