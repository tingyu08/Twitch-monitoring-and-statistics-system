/**
 * health.routes.ts 補充測試（覆蓋未涵蓋路由）
 */

jest.mock("../../../services/chat-listener-manager", () => ({
  chatListenerManager: {
    getHealthStatus: jest.fn().mockReturnValue({ status: "healthy" }),
    getStats: jest.fn().mockReturnValue({ activeListeners: 2, totalMessages: 100 }),
    getChannels: jest.fn().mockReturnValue([
      { channelName: "testchan", isLive: true, priority: 1, lastActivity: new Date().toISOString() },
    ]),
  },
}));

jest.mock("../../../services/twitch-chat.service", () => ({
  twurpleChatService: {
    getStatus: jest.fn().mockReturnValue({ connected: true, channelCount: 3 }),
  },
}));

jest.mock("../../../db/prisma", () => ({
  prisma: {
    $queryRaw: jest.fn().mockResolvedValue([{ "1": 1 }]),
  },
}));

jest.mock("../../../utils/cache-manager", () => ({
  cacheManager: {
    getStats: jest.fn().mockReturnValue({ hits: 10, misses: 2, size: 12 }),
  },
}));

jest.mock("../../../services/distributed-coordinator", () => ({
  distributedCoordinator: {
    getAllInstances: jest.fn().mockResolvedValue([]),
    getChannelLocks: jest.fn().mockResolvedValue([]),
    getInstanceId: jest.fn().mockReturnValue("inst-1"),
    getAcquiredChannels: jest.fn().mockReturnValue(["chan1"]),
  },
}));

import request from "supertest";
import express from "express";
import type { Request, Response } from "express";
import { healthRoutes } from "../health.routes";
import { prisma } from "../../../db/prisma";
import { chatListenerManager } from "../../../services/chat-listener-manager";

const app = express();
app.use(express.json());
app.use("/api/health", healthRoutes);

describe("health.routes", () => {
  const originalDistributedMode = process.env.ENABLE_DISTRIBUTED_MODE;

  beforeEach(() => {
    jest.clearAllMocks();
    // Restore all mock implementations (clearAllMocks does not reset mockImplementation)
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ "1": 1 }]);
    (chatListenerManager.getHealthStatus as jest.Mock).mockReturnValue({ status: "healthy" });
    (chatListenerManager.getStats as jest.Mock).mockReturnValue({ activeListeners: 2, totalMessages: 100 });
    (chatListenerManager.getChannels as jest.Mock).mockReturnValue([
      { channelName: "testchan", isLive: true, priority: 1, lastActivity: new Date().toISOString() },
    ]);
    process.env.ENABLE_DISTRIBUTED_MODE = originalDistributedMode;
  });

  afterAll(() => {
    process.env.ENABLE_DISTRIBUTED_MODE = originalDistributedMode;
  });

  // ====================================================
  // GET /ping
  // ====================================================
  describe("GET /ping", () => {
    it("returns status ok", async () => {
      const res = await request(app).get("/api/health/ping");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");
      expect(res.body).toHaveProperty("uptime");
    });
  });

  // ====================================================
  // GET /
  // ====================================================
  describe("GET /", () => {
    it("returns healthy when db check passes", async () => {
      const res = await request(app).get("/api/health/");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("healthy");
      expect(res.body.cached).toBe(false);
    });

    it("returns 503 unhealthy when db check fails (cache expired)", async () => {
      // Advance Date.now() by 60s to bypass the 30s module-level cache
      const origNow = Date.now;
      jest.spyOn(Date, "now").mockReturnValue(origNow() + 60 * 1000);
      (prisma.$queryRaw as jest.Mock).mockRejectedValue(new Error("DB down"));
      const res = await request(app).get("/api/health/");
      jest.spyOn(Date, "now").mockRestore();
      expect(res.status).toBe(503);
      expect(res.body.status).toBe("unhealthy");
    });

    it("returns fallback message when db check rejects with non-Error", async () => {
      const origNow = Date.now;
      jest.spyOn(Date, "now").mockReturnValue(origNow() + 60 * 1000);
      (prisma.$queryRaw as jest.Mock).mockRejectedValue("db fail");
      const res = await request(app).get("/api/health/");
      jest.spyOn(Date, "now").mockRestore();
      expect(res.status).toBe(503);
      expect(res.body.error).toBe("Database connection failed");
    });

    it("returns timeout error when db check hangs", async () => {
      jest.useFakeTimers();
      const origNow = Date.now;
      jest.spyOn(Date, "now").mockReturnValue(origNow() + 60 * 1000);
      (prisma.$queryRaw as jest.Mock).mockImplementation(() => new Promise(() => undefined));

      const rootLayer = (healthRoutes as unknown as { stack: Array<{ route?: { path?: string; stack?: Array<{ handle: (...args: any[]) => any }> } }> }).stack.find(
        (layer) => layer.route?.path === "/"
      );
      const handler = rootLayer?.route?.stack?.[0]?.handle as
        | ((req: Request, res: Response) => Promise<void>)
        | undefined;

      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
      } as unknown as Response;

      const pending = handler?.({} as Request, res);
      await jest.advanceTimersByTimeAsync(5000);
      await pending;

      jest.spyOn(Date, "now").mockRestore();
      jest.useRealTimers();

      expect((res.status as jest.Mock)).toHaveBeenCalledWith(503);
      expect((res.json as jest.Mock)).toHaveBeenCalledWith(
        expect.objectContaining({ status: "unhealthy", error: "DB check timeout" })
      );
    });

  });

  // ====================================================
  // GET /detailed
  // ====================================================
  describe("GET /detailed", () => {
    it("returns overall healthy status", async () => {
      const res = await request(app).get("/api/health/detailed");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("healthy");
      expect(res.body.components).toHaveProperty("database");
      expect(res.body.components).toHaveProperty("twitchChat");
    });

    it("returns overall unhealthy when db fails", async () => {
      (prisma.$queryRaw as jest.Mock).mockRejectedValue(new Error("DB fail"));
      const res = await request(app).get("/api/health/detailed");
      expect(res.status).toBe(200);
      expect(res.body.components.database.status).toBe("unhealthy");
      expect(res.body.status).toBe("unhealthy");
    });

    it("returns degraded when listener is degraded", async () => {
      (chatListenerManager.getHealthStatus as jest.Mock).mockReturnValue({ status: "degraded" });
      const res = await request(app).get("/api/health/detailed");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("degraded");
    });

    it("returns unhealthy when listener is unhealthy", async () => {
      (chatListenerManager.getHealthStatus as jest.Mock).mockReturnValue({ status: "unhealthy" });
      const res = await request(app).get("/api/health/detailed");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("unhealthy");
    });

    it("returns memory warning high and disconnected chat branch", async () => {
      const memorySpy = jest.spyOn(process, "memoryUsage").mockReturnValue({
        rss: 700 * 1024 * 1024,
        heapTotal: 500 * 1024 * 1024,
        heapUsed: 450 * 1024 * 1024,
        external: 10 * 1024 * 1024,
        arrayBuffers: 0,
      });
      const { twurpleChatService } = jest.requireMock("../../../services/twitch-chat.service") as {
        twurpleChatService: { getStatus: jest.Mock };
      };
      twurpleChatService.getStatus.mockReturnValueOnce({ connected: false, channelCount: 0 });

      const res = await request(app).get("/api/health/detailed");
      memorySpy.mockRestore();
      expect(res.status).toBe(200);
      expect(res.body.components.twitchChat.status).toBe("unhealthy");
      expect(res.body.system.memory.warning).toBe("high");
    });

    it("returns memory warning medium and default env branch", async () => {
      const memorySpy = jest.spyOn(process, "memoryUsage").mockReturnValue({
        rss: 500 * 1024 * 1024,
        heapTotal: 400 * 1024 * 1024,
        heapUsed: 350 * 1024 * 1024,
        external: 10 * 1024 * 1024,
        arrayBuffers: 0,
      });
      const originalNodeEnv = process.env.NODE_ENV;
      delete process.env.NODE_ENV;

      const res = await request(app).get("/api/health/detailed");

      process.env.NODE_ENV = originalNodeEnv;
      memorySpy.mockRestore();
      expect(res.status).toBe(200);
      expect(res.body.system.memory.warning).toBe("medium");
      expect(res.body.system.env).toBe("development");
    });

    it("returns 500 on unexpected error", async () => {
      (chatListenerManager.getStats as jest.Mock).mockImplementation(() => {
        throw new Error("crash");
      });
      const res = await request(app).get("/api/health/detailed");
      expect(res.status).toBe(500);
      expect(res.body.status).toBe("error");
    });

    it("returns Unknown error when detailed route throws non-Error", async () => {
      (chatListenerManager.getStats as jest.Mock).mockImplementation(() => {
        throw "boom";
      });
      const res = await request(app).get("/api/health/detailed");
      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Unknown error");
    });
  });

  // ====================================================
  // GET /listeners
  // ====================================================
  describe("GET /listeners", () => {
    it("returns listener health and channel list", async () => {
      const res = await request(app).get("/api/health/listeners");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("channels");
      expect(res.body.channels[0].name).toBe("testchan");
    });
  });

  // ====================================================
  // GET /distributed
  // ====================================================
  describe("GET /distributed", () => {
    it("returns distributed coordinator status", async () => {
      const { distributedCoordinator } = jest.requireMock(
        "../../../services/distributed-coordinator"
      ) as {
        distributedCoordinator: {
          getChannelLocks: jest.Mock;
        };
      };
      process.env.ENABLE_DISTRIBUTED_MODE = "true";
      distributedCoordinator.getChannelLocks.mockResolvedValueOnce([
        {
          channelId: "chan1",
          instanceId: "inst-1",
          acquiredAt: new Date("2026-01-01T00:00:00Z"),
          lastHeartbeat: new Date("2026-01-01T00:00:30Z"),
        },
      ]);

      const res = await request(app).get("/api/health/distributed");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("currentInstance");
      expect(res.body.currentInstance.id).toBe("inst-1");
      expect(res.body.enabled).toBe(true);
      expect(res.body.channelLocks[0].channelId).toBe("chan1");
    });
  });
});
