jest.mock("../../db/prisma", () => ({
  prisma: {
    $queryRaw: jest.fn(),
    listenerInstance: {
      upsert: jest.fn(),
      delete: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    channelListenerLock: {
      create: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
      findMany: jest.fn(),
    },
  },
}));

jest.mock("../../utils/logger", () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import { prisma } from "../../db/prisma";
import { logger } from "../../utils/logger";
import { DistributedListenerCoordinator } from "../distributed-coordinator";

const mockedPrisma = prisma as unknown as {
  $queryRaw: jest.Mock;
  listenerInstance: {
    upsert: jest.Mock;
    delete: jest.Mock;
    update: jest.Mock;
    findMany: jest.Mock;
    deleteMany: jest.Mock;
  };
  channelListenerLock: {
    create: jest.Mock;
    updateMany: jest.Mock;
    deleteMany: jest.Mock;
    findMany: jest.Mock;
  };
};

describe("DistributedListenerCoordinator", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.$queryRaw.mockResolvedValue([{ ping: 1 }]);
    mockedPrisma.listenerInstance.upsert.mockResolvedValue({});
    mockedPrisma.listenerInstance.delete.mockResolvedValue({});
    mockedPrisma.listenerInstance.update.mockResolvedValue({});
    mockedPrisma.listenerInstance.findMany.mockResolvedValue([]);
    mockedPrisma.listenerInstance.deleteMany.mockResolvedValue({ count: 0 });
    mockedPrisma.channelListenerLock.create.mockResolvedValue({});
    mockedPrisma.channelListenerLock.updateMany.mockResolvedValue({ count: 0 });
    mockedPrisma.channelListenerLock.deleteMany.mockResolvedValue({ count: 0 });
    mockedPrisma.channelListenerLock.findMany.mockResolvedValue([]);
  });

  describe("lifecycle", () => {
    it("start is idempotent and skips duplicate setup", async () => {
      const coordinator = new DistributedListenerCoordinator();

      await coordinator.start();
      await coordinator.start();

      expect(mockedPrisma.$queryRaw).toHaveBeenCalledTimes(1);
      expect(mockedPrisma.listenerInstance.upsert).toHaveBeenCalledTimes(1);

      await coordinator.stop();
    });

    it("start throws when database check fails", async () => {
      const coordinator = new DistributedListenerCoordinator();
      const err = new Error("db down");
      mockedPrisma.$queryRaw.mockRejectedValueOnce(err);

      await expect(coordinator.start()).rejects.toThrow("db down");
      expect(mockedPrisma.listenerInstance.upsert).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith("DistributedCoordinator", "Database connection failed", err);
    });

    it("stop is a no-op when coordinator was never started", async () => {
      const coordinator = new DistributedListenerCoordinator();

      await coordinator.stop();

      expect(mockedPrisma.channelListenerLock.deleteMany).not.toHaveBeenCalled();
      expect(mockedPrisma.listenerInstance.delete).not.toHaveBeenCalled();
    });

    it("stop releases all channels and unregisters the instance", async () => {
      const coordinator = new DistributedListenerCoordinator() as any;

      coordinator.isStarted = true;
      coordinator.acquiredChannels.add("alpha");
      coordinator.acquiredChannels.add("beta");
      coordinator.heartbeatInterval = setInterval(() => {}, 1000);

      await coordinator.stop();

      expect(coordinator.getAcquiredChannels()).toEqual([]);
      expect(mockedPrisma.channelListenerLock.deleteMany).toHaveBeenCalledWith({
        where: { instanceId: coordinator.getInstanceId() },
      });
      expect(mockedPrisma.listenerInstance.delete).toHaveBeenCalledWith({
        where: { instanceId: coordinator.getInstanceId() },
      });
      expect(coordinator.heartbeatInterval).toBeNull();
    });
  });

  describe("tryAcquireChannel", () => {
    it("returns true immediately when channel is already acquired", async () => {
      const coordinator = new DistributedListenerCoordinator() as any;
      coordinator.acquiredChannels.add("alpha");

      const acquired = await coordinator.tryAcquireChannel("alpha");

      expect(acquired).toBe(true);
      expect(mockedPrisma.channelListenerLock.create).not.toHaveBeenCalled();
    });

    it("returns false when instance channel count reaches the max limit", async () => {
      const coordinator = new DistributedListenerCoordinator() as any;

      for (let i = 0; i < 80; i += 1) {
        coordinator.acquiredChannels.add(`ch-${i}`);
      }

      const acquired = await coordinator.tryAcquireChannel("overflow");

      expect(acquired).toBe(false);
      expect(mockedPrisma.channelListenerLock.create).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalled();
    });

    it("acquires lock via create and tracks channel", async () => {
      const coordinator = new DistributedListenerCoordinator();

      const acquired = await coordinator.tryAcquireChannel("alpha");

      expect(acquired).toBe(true);
      expect(mockedPrisma.channelListenerLock.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            channelId: "alpha",
            instanceId: coordinator.getInstanceId(),
          }),
        })
      );
      expect(coordinator.getAcquiredChannels()).toContain("alpha");
    });

    it("takes over stale lock when create fails and conditional update succeeds", async () => {
      const coordinator = new DistributedListenerCoordinator();
      mockedPrisma.channelListenerLock.create.mockRejectedValueOnce(new Error("unique"));
      mockedPrisma.channelListenerLock.updateMany.mockResolvedValueOnce({ count: 1 });

      const acquired = await coordinator.tryAcquireChannel("alpha");

      expect(acquired).toBe(true);
      expect(mockedPrisma.channelListenerLock.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            channelId: "alpha",
            OR: expect.any(Array),
          }),
          data: expect.objectContaining({
            instanceId: coordinator.getInstanceId(),
          }),
        })
      );
      expect(coordinator.getAcquiredChannels()).toContain("alpha");
    });

    it("returns false when create fails and takeover update affects zero rows", async () => {
      const coordinator = new DistributedListenerCoordinator();
      mockedPrisma.channelListenerLock.create.mockRejectedValueOnce(new Error("unique"));
      mockedPrisma.channelListenerLock.updateMany.mockResolvedValueOnce({ count: 0 });

      const acquired = await coordinator.tryAcquireChannel("alpha");

      expect(acquired).toBe(false);
      expect(coordinator.getAcquiredChannels()).toEqual([]);
    });

    it("returns false when lock operations fail unexpectedly", async () => {
      const coordinator = new DistributedListenerCoordinator();
      mockedPrisma.channelListenerLock.create.mockRejectedValueOnce(new Error("unique"));
      mockedPrisma.channelListenerLock.updateMany.mockRejectedValueOnce(new Error("db timeout"));

      const acquired = await coordinator.tryAcquireChannel("alpha");

      expect(acquired).toBe(false);
      expect(coordinator.getAcquiredChannels()).toEqual([]);
    });

    it("handles tryAcquireChannel errors when acquireLock throws", async () => {
      const coordinator = new DistributedListenerCoordinator() as any;

      coordinator.acquireLock = jest.fn().mockRejectedValue(new Error("boom"));

      const acquired = await coordinator.tryAcquireChannel("alpha");

      expect(acquired).toBe(false);
      expect(logger.error).toHaveBeenCalledWith(
        "DistributedCoordinator",
        "Failed to acquire channel: alpha",
        expect.any(Error)
      );
    });
  });

  describe("releaseChannel", () => {
    it("releases owned channel lock and removes local tracking", async () => {
      const coordinator = new DistributedListenerCoordinator() as any;
      coordinator.acquiredChannels.add("alpha");

      await coordinator.releaseChannel("alpha");

      expect(mockedPrisma.channelListenerLock.deleteMany).toHaveBeenCalledWith({
        where: {
          channelId: "alpha",
          instanceId: coordinator.getInstanceId(),
        },
      });
      expect(coordinator.getAcquiredChannels()).toEqual([]);
    });

    it("logs and keeps local channel when releaseLock throws", async () => {
      const coordinator = new DistributedListenerCoordinator() as any;
      coordinator.acquiredChannels.add("alpha");
      coordinator.releaseLock = jest.fn().mockRejectedValue(new Error("release failed"));

      await coordinator.releaseChannel("alpha");

      expect(coordinator.getAcquiredChannels()).toContain("alpha");
      expect(logger.error).toHaveBeenCalledWith(
        "DistributedCoordinator",
        "Failed to release channel: alpha",
        expect.any(Error)
      );
    });
  });

  describe("status queries", () => {
    it("maps instance health based on heartbeat timeout", async () => {
      const coordinator = new DistributedListenerCoordinator();
      const now = Date.now();
      mockedPrisma.listenerInstance.findMany.mockResolvedValueOnce([
        {
          instanceId: "healthy-1",
          channelCount: 2,
          lastHeartbeat: new Date(now - 10_000),
        },
        {
          instanceId: "stale-1",
          channelCount: 1,
          lastHeartbeat: new Date(now - 90_000),
        },
      ]);

      const result = await coordinator.getAllInstances();

      expect(result).toEqual([
        expect.objectContaining({ instanceId: "healthy-1", isHealthy: true }),
        expect.objectContaining({ instanceId: "stale-1", isHealthy: false }),
      ]);
    });

    it("returns empty array when getAllInstances fails", async () => {
      const coordinator = new DistributedListenerCoordinator();
      mockedPrisma.listenerInstance.findMany.mockRejectedValueOnce(new Error("db failed"));

      const result = await coordinator.getAllInstances();

      expect(result).toEqual([]);
    });

    it("returns channel lock details", async () => {
      const coordinator = new DistributedListenerCoordinator();
      const now = new Date();
      mockedPrisma.channelListenerLock.findMany.mockResolvedValueOnce([
        {
          channelId: "alpha",
          instanceId: "inst-1",
          lastHeartbeat: now,
          acquiredAt: now,
        },
      ]);

      const result = await coordinator.getChannelLocks();

      expect(result).toEqual([
        {
          channelId: "alpha",
          instanceId: "inst-1",
          lastHeartbeat: now,
          acquiredAt: now,
        },
      ]);
    });

    it("returns empty array when getChannelLocks fails", async () => {
      const coordinator = new DistributedListenerCoordinator();
      mockedPrisma.channelListenerLock.findMany.mockRejectedValueOnce(new Error("db failed"));

      const result = await coordinator.getChannelLocks();

      expect(result).toEqual([]);
    });
  });

  describe("heartbeat and cleanup", () => {
    it("heartbeat updates instance and lock heartbeats and triggers cleanup when due", async () => {
      const coordinator = new DistributedListenerCoordinator() as any;

      coordinator.acquiredChannels.add("alpha");
      coordinator.lastCleanupAt = 0;

      const cleanupSpy = jest
        .spyOn(coordinator as unknown as { cleanupExpiredLocks: () => Promise<void> }, "cleanupExpiredLocks")
        .mockResolvedValue(undefined);

      await (coordinator as unknown as { performHeartbeat: () => Promise<void> }).performHeartbeat();

      expect(mockedPrisma.listenerInstance.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { instanceId: coordinator.getInstanceId() },
          data: expect.objectContaining({ channelCount: 1 }),
        })
      );
      expect(mockedPrisma.channelListenerLock.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            instanceId: coordinator.getInstanceId(),
            channelId: { in: ["alpha"] },
          }),
        })
      );
      expect(cleanupSpy).toHaveBeenCalledTimes(1);
      expect(coordinator.lastCleanupAt).toBeGreaterThan(0);
    });

    it("heartbeat skips lock update and cleanup when no channels and not due", async () => {
      const coordinator = new DistributedListenerCoordinator() as any;

      coordinator.lastCleanupAt = Date.now();

      const cleanupSpy = jest
        .spyOn(coordinator as unknown as { cleanupExpiredLocks: () => Promise<void> }, "cleanupExpiredLocks")
        .mockResolvedValue(undefined);

      await (coordinator as unknown as { performHeartbeat: () => Promise<void> }).performHeartbeat();

      expect(mockedPrisma.channelListenerLock.updateMany).not.toHaveBeenCalled();
      expect(cleanupSpy).not.toHaveBeenCalled();
    });

    it("heartbeat logs error when update fails", async () => {
      const coordinator = new DistributedListenerCoordinator();
      const err = new Error("heartbeat failed");
      mockedPrisma.listenerInstance.update.mockRejectedValueOnce(err);

      await (coordinator as unknown as { performHeartbeat: () => Promise<void> }).performHeartbeat();

      expect(logger.error).toHaveBeenCalledWith("DistributedCoordinator", "Heartbeat failed", err);
    });

    it("cleanupExpiredLocks removes stale locks/instances and logs cleanup count", async () => {
      const coordinator = new DistributedListenerCoordinator();
      mockedPrisma.channelListenerLock.deleteMany.mockResolvedValueOnce({ count: 3 });

      await (coordinator as unknown as { cleanupExpiredLocks: () => Promise<void> }).cleanupExpiredLocks();

      expect(mockedPrisma.channelListenerLock.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            lastHeartbeat: {
              lt: expect.any(Date),
            },
          },
        })
      );
      expect(mockedPrisma.listenerInstance.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            lastHeartbeat: {
              lt: expect.any(Date),
            },
          },
        })
      );
      expect(logger.info).toHaveBeenCalledWith(
        "DistributedCoordinator",
        "Cleaned up 3 expired channel locks"
      );
    });

    it("cleanupExpiredLocks swallows errors", async () => {
      const coordinator = new DistributedListenerCoordinator();
      mockedPrisma.channelListenerLock.deleteMany.mockRejectedValueOnce(new Error("cleanup failed"));

      await expect(
        (coordinator as unknown as { cleanupExpiredLocks: () => Promise<void> }).cleanupExpiredLocks()
      ).resolves.toBeUndefined();
    });
  });
});
