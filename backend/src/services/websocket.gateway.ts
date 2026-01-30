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
        // logger.debug("WebSocket", `Client ${socket.id} joined room: channel:${channelId}`);
      }
    });

    // P1 Memory: Leave channel room when no longer needed
    socket.on("leave-channel", (channelId: string) => {
      if (channelId && typeof channelId === "string") {
        socket.leave(`channel:${channelId}`);
        // logger.debug("WebSocket", `Client ${socket.id} left room: channel:${channelId}`);
      }
    });

    // P1 Memory: Join viewer-specific room for personal updates
    socket.on("join-viewer", (viewerId: string) => {
      if (viewerId && typeof viewerId === "string") {
        socket.join(`viewer:${viewerId}`);
        // logger.debug("WebSocket", `Client ${socket.id} joined room: viewer:${viewerId}`);
      }
    });

    socket.on("disconnect", (reason) => {
      logger.debug("WebSocket", `Client disconnected: ${socket.id}, reason: ${reason}`);
    });

    // Send acknowledgment on connect
    socket.emit("connected", { socketId: socket.id });
  }

  /**
   * @deprecated P1 Optimization: stats-update is no longer used
   * Message counts are now fetched via React Query refetchInterval
   * This method is kept for backwards compatibility but does nothing
   */
  public broadcastChannelStats(_channelId: string, _stats: Partial<ViewerChannelStats>) {
    // No-op: stats-update removed in favor of React Query polling
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
   * P1 Memory: Broadcast stream status updates ONLY to interested clients
   * Replaces global emit for stream.online/offline/update events
   */
  public broadcastStreamStatus(
    event: "stream.online" | "stream.offline" | "channel.update",
    channelData: { channelId?: string; twitchChannelId?: string; [key: string]: unknown }
  ) {
    if (!this.io) return;

    // Client can join room by channelId (DB ID) or twitchChannelId
    // We emit to both rooms to be safe
    if (channelData.channelId) {
      this.io.to(`channel:${channelData.channelId}`).emit(event, channelData);
    }
    if (channelData.twitchChannelId) {
      this.io.to(`channel:${channelData.twitchChannelId}`).emit(event, channelData);
    }
  }

  /**
   * Broadcast Chat Heat alerts to channel subscribers (room-based)
   * P1 Optimization: Only send to clients subscribed to this channel
   */
  public broadcastChatHeat(data: {
    channelId: string;
    channelName: string;
    heatLevel: number;
    message: string;
  }) {
    if (!this.io) return;

    // Room-based broadcast - only clients subscribed to this channel will receive
    this.io.to(`channel:${data.channelId}`).emit("chat.heat", data);
  }

  /**
   * Broadcast Raid events to channel subscribers (room-based)
   * P1 Optimization: Only send to clients subscribed to this channel
   */
  public broadcastRaid(data: {
    channelId: string;
    channelName: string;
    raider: string;
    viewers: number;
  }) {
    if (!this.io) return;

    // Room-based broadcast - only clients subscribed to this channel will receive
    this.io.to(`channel:${data.channelId}`).emit("stream.raid", data);
  }

  /**
   * 通用廣播 (Restored to fix regression, but discouraged)
   * The ChatService depends on this for events like 'chat.heat' where it doesn't have the Channel ID handy.
   */
  public emit(event: string, data: unknown) {
    if (this.io) {
      this.io.emit(event, data);
    }
  }

  public getConnectionCount(): number {
    if (!this.io) return 0;
    return this.io.sockets.sockets.size;
  }
}

export const webSocketGateway = new WebSocketGateway();
