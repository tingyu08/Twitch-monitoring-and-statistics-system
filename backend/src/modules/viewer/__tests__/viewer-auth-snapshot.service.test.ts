const mockGetOrSetWithTags = jest.fn();
const mockSetWithTags = jest.fn();
const mockDelete = jest.fn();

jest.mock("../../../utils/cache-manager", () => ({
  cacheManager: {
    getOrSetWithTags: (...args: unknown[]) => mockGetOrSetWithTags(...args),
    setWithTags: (...args: unknown[]) => mockSetWithTags(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
  },
}));

jest.mock("../../../db/prisma", () => ({
  prisma: {
    viewer: { findUnique: jest.fn() },
  },
}));

import {
  getViewerAuthSnapshotById,
  getViewerAuthSnapshotByTwitchUserId,
  invalidateViewerAuthSnapshot,
  ViewerAuthSnapshot,
} from "../viewer-auth-snapshot.service";
import { prisma } from "../../../db/prisma";

const mockFindUnique = prisma.viewer.findUnique as jest.Mock;

const mockSnapshot: ViewerAuthSnapshot = {
  id: "viewer1",
  twitchUserId: "twitch-123",
  tokenVersion: 1,
  consentedAt: new Date("2025-01-01"),
  consentVersion: 1,
  isAnonymized: false,
};

describe("viewer-auth-snapshot.service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("getViewerAuthSnapshotById", () => {
    it("應從快取/DB 回傳 snapshot", async () => {
      mockGetOrSetWithTags.mockResolvedValue(mockSnapshot);

      const result = await getViewerAuthSnapshotById("viewer1");

      expect(result).toEqual(mockSnapshot);
      expect(mockGetOrSetWithTags).toHaveBeenCalledWith(
        "viewer-auth:id:viewer1",
        expect.any(Function),
        expect.any(Number),
        expect.arrayContaining(["viewer:viewer1", "viewer-auth-snapshot"])
      );
    });

    it("找到 snapshot 時應同時以 by-id 與 by-twitch-id 兩個 key 寫入快取", async () => {
      mockGetOrSetWithTags.mockResolvedValue(mockSnapshot);

      await getViewerAuthSnapshotById("viewer1");

      expect(mockSetWithTags).toHaveBeenCalledTimes(2);
      expect(mockSetWithTags).toHaveBeenCalledWith(
        "viewer-auth:id:viewer1",
        mockSnapshot,
        expect.any(Number),
        expect.arrayContaining(["viewer:viewer1", "viewer-auth-snapshot"])
      );
      expect(mockSetWithTags).toHaveBeenCalledWith(
        "viewer-auth:twitch:twitch-123",
        mockSnapshot,
        expect.any(Number),
        expect.arrayContaining(["viewer:viewer1", "viewer-auth-snapshot"])
      );
    });

    it("找不到時應回傳 null 且不寫入快取", async () => {
      mockGetOrSetWithTags.mockResolvedValue(null);

      const result = await getViewerAuthSnapshotById("nonexistent");

      expect(result).toBeNull();
      expect(mockSetWithTags).not.toHaveBeenCalled();
    });

    it("isAnonymized 為 true 的 snapshot 應正確回傳", async () => {
      const anonymizedSnapshot: ViewerAuthSnapshot = {
        ...mockSnapshot,
        isAnonymized: true,
        consentedAt: null,
      };
      mockGetOrSetWithTags.mockResolvedValue(anonymizedSnapshot);

      const result = await getViewerAuthSnapshotById("viewer1");

      expect(result?.isAnonymized).toBe(true);
      expect(result?.consentedAt).toBeNull();
    });

    it("快取 miss 時應使用 viewerId 向 DB 查詢", async () => {
      mockFindUnique.mockResolvedValue(mockSnapshot);
      mockGetOrSetWithTags.mockImplementationOnce(async (_key, factory: () => Promise<unknown>) =>
        factory()
      );

      const result = await getViewerAuthSnapshotById("viewer1");

      expect(result).toEqual(mockSnapshot);
      expect(mockFindUnique).toHaveBeenCalledWith({
        where: { id: "viewer1" },
        select: {
          id: true,
          twitchUserId: true,
          tokenVersion: true,
          consentedAt: true,
          consentVersion: true,
          isAnonymized: true,
        },
      });
    });
  });

  describe("getViewerAuthSnapshotByTwitchUserId", () => {
    it("應以 twitch key 查詢快取並回傳 snapshot", async () => {
      mockGetOrSetWithTags.mockResolvedValue(mockSnapshot);

      const result = await getViewerAuthSnapshotByTwitchUserId("twitch-123");

      expect(result).toEqual(mockSnapshot);
      expect(mockGetOrSetWithTags).toHaveBeenCalledWith(
        "viewer-auth:twitch:twitch-123",
        expect.any(Function),
        expect.any(Number),
        expect.arrayContaining(["viewer-auth-snapshot"])
      );
    });

    it("找不到時應回傳 null", async () => {
      mockGetOrSetWithTags.mockResolvedValue(null);

      const result = await getViewerAuthSnapshotByTwitchUserId("unknown-twitch");

      expect(result).toBeNull();
      expect(mockSetWithTags).not.toHaveBeenCalled();
    });

    it("找到時應同時寫入兩個快取 key", async () => {
      mockGetOrSetWithTags.mockResolvedValue(mockSnapshot);

      await getViewerAuthSnapshotByTwitchUserId("twitch-123");

      expect(mockSetWithTags).toHaveBeenCalledTimes(2);
    });

    it("快取 miss 時應使用 twitchUserId 向 DB 查詢", async () => {
      mockFindUnique.mockResolvedValue(mockSnapshot);
      mockGetOrSetWithTags.mockImplementationOnce(async (_key, factory: () => Promise<unknown>) =>
        factory()
      );

      const result = await getViewerAuthSnapshotByTwitchUserId("twitch-123");

      expect(result).toEqual(mockSnapshot);
      expect(mockFindUnique).toHaveBeenCalledWith({
        where: { twitchUserId: "twitch-123" },
        select: {
          id: true,
          twitchUserId: true,
          tokenVersion: true,
          consentedAt: true,
          consentVersion: true,
          isAnonymized: true,
        },
      });
    });
  });

  describe("invalidateViewerAuthSnapshot", () => {
    it("只傳 viewerId 時應只刪除 by-id 的快取", () => {
      invalidateViewerAuthSnapshot("viewer1");

      expect(mockDelete).toHaveBeenCalledTimes(1);
      expect(mockDelete).toHaveBeenCalledWith("viewer-auth:id:viewer1");
    });

    it("只傳 twitchUserId 時應只刪除 by-twitch-id 的快取", () => {
      invalidateViewerAuthSnapshot(undefined, "twitch-123");

      expect(mockDelete).toHaveBeenCalledTimes(1);
      expect(mockDelete).toHaveBeenCalledWith("viewer-auth:twitch:twitch-123");
    });

    it("兩個 id 都傳入時應同時刪除兩個快取 key", () => {
      invalidateViewerAuthSnapshot("viewer1", "twitch-123");

      expect(mockDelete).toHaveBeenCalledTimes(2);
      expect(mockDelete).toHaveBeenCalledWith("viewer-auth:id:viewer1");
      expect(mockDelete).toHaveBeenCalledWith("viewer-auth:twitch:twitch-123");
    });

    it("不傳任何參數時不應呼叫 delete", () => {
      invalidateViewerAuthSnapshot();

      expect(mockDelete).not.toHaveBeenCalled();
    });
  });
});
