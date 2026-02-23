import { Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import type Redis from "ioredis";
import { logger } from "../utils/logger";
import { getRedisClient } from "../utils/redis-client";

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
  private pubClient: Redis | null = null;
  private subClient: Redis | null = null;
  private pendingChannelUpdates: Map<
    string,
    { channelId?: string; twitchChannelId?: string; [key: string]: unknown }
  > = new Map();
  private channelUpdateFlushTimer: NodeJS.Timeout | null = null;
  private readonly CHANNEL_UPDATE_DEBOUNCE_MS = Number(
    process.env.CHANNEL_UPDATE_DEBOUNCE_MS || 800
  );
  private readonly CORS_ORIGIN = process.env.FRONTEND_URL || "http://localhost:3000";

  public initialize(httpServer: HttpServer) {
    this.io = new Server(httpServer, {
      cors: {
        origin: this.CORS_ORIGIN,
        methods: ["GET", "POST"],
        credentials: true,
      },
      path: "/socket.io", // 默認路徑
      // P1 Memory: Optimize for Zeabur free tier
      pingTimeout: 60000,
      pingInterval: 25000,
    });

    this.io.on("connection", (socket: Socket) => {
      this.handleConnection(socket);
    });

    void this.setupRedisAdapter();

    logger.info("WebSocket", "Socket.IO Gateway initialized with room support");
  }

  private async setupRedisAdapter(): Promise<void> {
    if (!this.io) return;

    const baseClient = getRedisClient();
    if (!baseClient) {
      logger.info("WebSocket", "Redis adapter not enabled (REDIS_URL missing)");
      return;
    }

    try {
      // duplicate() 預設 autoConnect=true，不需要手動 connect()
      // 等待 ready 事件確認連線就緒即可
      const pubClient = baseClient.duplicate();
      const subClient = baseClient.duplicate();
      this.pubClient = pubClient;
      this.subClient = subClient;

      await Promise.all([
        new Promise<void>((resolve, reject) => {
          pubClient.once("ready", resolve);
          pubClient.once("error", reject);
        }),
        new Promise<void>((resolve, reject) => {
          subClient.once("ready", resolve);
          subClient.once("error", reject);
        }),
      ]);

      this.io.adapter(createAdapter(this.pubClient, this.subClient));
      logger.info("WebSocket", "Redis adapter enabled for cross-instance broadcast");
    } catch (error) {
      logger.warn("WebSocket", "Failed to enable Redis adapter", error);
    }
  }

  private handleConnection(socket: Socket) {
    logger.debug("WebSocket", `Client connected: ${socket.id}`);

    // P1 Memory: Join channel-specific rooms for targeted broadcasting
    socket.on("join-channel", (payload: string | { channelId?: string }) => {
      const channelId = typeof payload === "string" ? payload : payload?.channelId;
      if (channelId && typeof channelId === "string") {
        socket.join(`channel:${channelId}`);
        // logger.debug("WebSocket", `Client ${socket.id} joined room: channel:${channelId}`);
      }
    });

    // P1 Memory: Leave channel room when no longer needed
    socket.on("leave-channel", (payload: string | { channelId?: string }) => {
      const channelId = typeof payload === "string" ? payload : payload?.channelId;
      if (channelId && typeof channelId === "string") {
        socket.leave(`channel:${channelId}`);
        // logger.debug("WebSocket", `Client ${socket.id} left room: channel:${channelId}`);
      }
    });

    // P1 Memory: Join viewer-specific room for personal updates
    socket.on("join-viewer", (payload: string | { viewerId?: string }) => {
      const viewerId = typeof payload === "string" ? payload : payload?.viewerId;
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
   * Channel stats update (room-based)
   */
  public broadcastChannelStats(channelId: string, stats: Partial<ViewerChannelStats>) {
    if (!this.io) return;
    this.io.to(`channel:${channelId}`).emit("stats-update", { channelId, ...stats });
  }

  /**
   * Send stats update to a specific viewer
   */
  public emitViewerStats(
    viewerId: string,
    stats: { channelId: string; messageCountDelta: number }
  ) {
    if (!this.io) return;
    this.io.to(`viewer:${viewerId}`).emit("stats-update", stats);
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

    if (event === "channel.update") {
      this.enqueueChannelUpdate(channelData);
      return;
    }

    // Client can join room by channelId (DB ID) or twitchChannelId
    // We emit to both rooms to be safe
    if (channelData.channelId) {
      this.io.to(`channel:${channelData.channelId}`).emit(event, channelData);
    }
    if (channelData.twitchChannelId) {
      this.io.to(`channel:${channelData.twitchChannelId}`).emit(event, channelData);
    }
  }

  private enqueueChannelUpdate(channelData: {
    channelId?: string;
    twitchChannelId?: string;
    [key: string]: unknown;
  }): void {
    const key = channelData.channelId || channelData.twitchChannelId;
    if (!key) {
      this.emit("channel.update", channelData);
      return;
    }

    this.pendingChannelUpdates.set(key, channelData);

    if (this.channelUpdateFlushTimer) {
      return;
    }

    this.channelUpdateFlushTimer = setTimeout(() => {
      this.flushChannelUpdates();
    }, this.CHANNEL_UPDATE_DEBOUNCE_MS);
  }

  private flushChannelUpdates(): void {
    if (!this.io) {
      this.pendingChannelUpdates.clear();
      this.channelUpdateFlushTimer = null;
      return;
    }

    for (const channelData of this.pendingChannelUpdates.values()) {
      if (channelData.channelId) {
        this.io.to(`channel:${channelData.channelId}`).emit("channel.update", channelData);
      }
      if (channelData.twitchChannelId) {
        this.io.to(`channel:${channelData.twitchChannelId}`).emit("channel.update", channelData);
      }
    }

    this.pendingChannelUpdates.clear();
    this.channelUpdateFlushTimer = null;
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

  public async shutdown(): Promise<void> {
    if (this.channelUpdateFlushTimer) {
      clearTimeout(this.channelUpdateFlushTimer);
      this.channelUpdateFlushTimer = null;
    }
    this.pendingChannelUpdates.clear();

    if (this.io) {
      await this.io.close();
      this.io = null;
    }

    try {
      await Promise.all([
        this.pubClient?.quit().catch((): undefined => undefined),
        this.subClient?.quit().catch((): undefined => undefined),
      ]);
    } finally {
      this.pubClient = null;
      this.subClient = null;
    }
  }
}

export const webSocketGateway = new WebSocketGateway();
