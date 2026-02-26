const mockCallApi = jest.fn();
const mockGetVideosByUser = jest.fn();
const mockGetClipsForBroadcaster = jest.fn();

const mockApiClient = {
  callApi: mockCallApi,
  videos: { getVideosByUser: mockGetVideosByUser },
  clips: { getClipsForBroadcaster: mockGetClipsForBroadcaster },
};

jest.mock("../../db/prisma", () => ({
  prisma: {
    video: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    viewerChannelVideo: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
    viewerChannelClip: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
    $executeRaw: jest.fn().mockResolvedValue(1),
    $transaction: jest.fn(),
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

jest.mock("../../services/twurple-auth.service", () => ({
  twurpleAuthService: {
    getAppAuthProvider: jest.fn().mockResolvedValue({ provider: "mock" }),
  },
}));

jest.mock("../../utils/dynamic-import", () => ({
  importTwurpleApi: jest.fn().mockResolvedValue({
    ApiClient: jest.fn().mockImplementation(() => mockApiClient),
  }),
}));

jest.mock("../../utils/db-retry", () => ({
  retryDatabaseOperation: jest.fn((fn) => fn()),
}));

jest.mock("../../jobs/job-write-guard", () => ({
  runWithWriteGuard: jest.fn((_key: string, fn: () => unknown) => fn()),
}));

jest.mock("../../constants", () => ({
  WriteGuardKeys: {
    SYNC_VIDEOS_UPSERT: "sync-videos-upsert",
    SYNC_VIDEOS_CLEANUP: "sync-videos-cleanup",
    SYNC_CLIPS_UPSERT: "sync-clips-upsert",
    SYNC_VIEWER_VIDEOS: "sync-viewer-videos",
    SYNC_VIEWER_CLIPS: "sync-viewer-clips",
  },
}));

import { prisma } from "../../db/prisma";
import { logger } from "../../utils/logger";
import { TwurpleVideoService, twurpleVideoService } from "../twitch-video.service";

// Helper to build a fake raw video response entry
function makeRawVideo(overrides: Partial<{
  id: string;
  title: string;
  description: string | null;
  url: string;
  thumbnail_url: string | null;
  view_count: number;
  duration: string;
  language: string | null;
  type: string;
  created_at: string;
  published_at: string;
}> = {}) {
  return {
    id: "vid-1",
    title: "Test Video",
    description: "desc",
    url: "https://twitch.tv/videos/vid-1",
    thumbnail_url: "https://thumb/%{width}x%{height}.jpg",
    view_count: 100,
    duration: "1h2m3s",
    language: "zh-tw",
    type: "archive",
    created_at: "2024-01-01T00:00:00Z",
    published_at: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

// Helper to build a fake Twurple SDK video (for syncViewerVideos)
function makeSdkVideo(overrides: Partial<{
  id: string;
  title: string;
  url: string;
  thumbnailUrl: string;
  views: number;
  duration: string;
  publishDate: Date;
}> = {}) {
  return {
    id: "vid-1",
    title: "Test Video",
    url: "https://twitch.tv/videos/vid-1",
    thumbnailUrl: "https://thumb/%{width}x%{height}.jpg",
    views: 100,
    duration: "1h2m3s",
    publishDate: new Date("2024-01-01T00:00:00Z"),
    ...overrides,
  };
}

// Helper to build a fake raw clip response entry
function makeRawClip(overrides: Partial<{
  id: string;
  url: string;
  embed_url: string | null;
  creator_id: string | null;
  creator_name: string | null;
  video_id: string | null;
  game_id: string | null;
  title: string;
  view_count: number;
  created_at: string;
  thumbnail_url: string | null;
  duration: number;
}> = {}) {
  return {
    id: "clip-1",
    url: "https://clips.twitch.tv/clip-1",
    embed_url: "https://clips.twitch.tv/embed/clip-1",
    creator_id: "creator-1",
    creator_name: "Creator",
    video_id: "vid-1",
    game_id: "game-1",
    title: "Test Clip",
    view_count: 500,
    created_at: "2024-01-01T00:00:00Z",
    thumbnail_url: "https://thumb/{width}x{height}.jpg",
    duration: 30,
    ...overrides,
  };
}

// Helper to build a fake Twurple SDK clip (for syncViewerClips)
function makeSdkClip(overrides: Partial<{
  id: string;
  creatorDisplayName: string | null;
  title: string;
  url: string;
  thumbnailUrl: string;
  views: number;
  duration: number;
  creationDate: Date;
}> = {}) {
  return {
    id: "clip-1",
    creatorDisplayName: "Creator",
    title: "Test Clip",
    url: "https://clips.twitch.tv/clip-1",
    thumbnailUrl: "https://thumb/%{width}x%{height}.jpg",
    views: 500,
    duration: 30,
    creationDate: new Date("2024-01-01T00:00:00Z"),
    ...overrides,
  };
}

// Build a fully-functional tx mock that operates on its own internal state
function makeTxMock(initialVideos: unknown[] = [], initialClips: unknown[] = []) {
  const tx = {
    viewerChannelVideo: {
      findMany: jest.fn().mockResolvedValue(initialVideos),
      deleteMany: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
    viewerChannelClip: {
      findMany: jest.fn().mockResolvedValue(initialClips),
      deleteMany: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  return tx;
}

describe("TwurpleVideoService", () => {
  let service: TwurpleVideoService;

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset the singleton's cached apiClient between tests
    service = new TwurpleVideoService();
    // Default $transaction behaviour: execute the callback with a fresh tx
    (prisma.$transaction as jest.Mock).mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
      const tx = makeTxMock();
      return cb(tx);
    });
  });

  // ──────────────────────────────────────────────────────────────
  // syncVideos
  // ──────────────────────────────────────────────────────────────
  describe("syncVideos", () => {
    it("syncs one page of videos and calls $executeRaw", async () => {
      mockCallApi.mockResolvedValueOnce({
        data: [makeRawVideo()],
        pagination: {},
      });

      await service.syncVideos("user-1", "streamer-1");

      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
      expect(logger.error).not.toHaveBeenCalled();
    });

    it("does not call $executeRaw when API returns empty data", async () => {
      mockCallApi.mockResolvedValueOnce({ data: [], pagination: {} });

      await service.syncVideos("user-1", "streamer-1");

      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });

    it("normalizes thumbnail URL placeholders", async () => {
      mockCallApi.mockResolvedValueOnce({
        data: [makeRawVideo({ thumbnail_url: "https://thumb/%{width}x%{height}.jpg" })],
        pagination: {},
      });

      await service.syncVideos("user-1", "streamer-1");

      // $executeRaw receives a Prisma.Sql object; confirm it was called
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
      // The normalized URL should NOT contain the placeholder tokens
      const sqlArg = (prisma.$executeRaw as jest.Mock).mock.calls[0][0];
      const joined = sqlArg.values.join(" ");
      expect(joined).not.toContain("%{width}");
      expect(joined).not.toContain("%{height}");
      expect(joined).toContain("320");
      expect(joined).toContain("180");
    });

    it("handles {width}/{height} placeholder variants", async () => {
      mockCallApi.mockResolvedValueOnce({
        data: [makeRawVideo({ thumbnail_url: "https://thumb/{width}x{height}.jpg" })],
        pagination: {},
      });

      await service.syncVideos("user-1", "streamer-1");

      const sqlArg = (prisma.$executeRaw as jest.Mock).mock.calls[0][0];
      const joined = sqlArg.values.join(" ");
      expect(joined).not.toContain("{width}");
      expect(joined).not.toContain("{height}");
    });

    it("handles null thumbnail URL without throwing", async () => {
      mockCallApi.mockResolvedValueOnce({
        data: [makeRawVideo({ thumbnail_url: null })],
        pagination: {},
      });

      await service.syncVideos("user-1", "streamer-1");

      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it("paginates across multiple pages until no cursor is returned", async () => {
      mockCallApi
        .mockResolvedValueOnce({
          data: [makeRawVideo({ id: "vid-1" })],
          pagination: { cursor: "page2-cursor" },
        })
        .mockResolvedValueOnce({
          data: [makeRawVideo({ id: "vid-2" })],
          pagination: {},
        });

      await service.syncVideos("user-1", "streamer-1");

      expect(mockCallApi).toHaveBeenCalledTimes(2);
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
    });

    it("calls video.deleteMany to clean up videos older than 90 days", async () => {
      mockCallApi.mockResolvedValueOnce({ data: [], pagination: {} });
      (prisma.video.deleteMany as jest.Mock).mockResolvedValueOnce({ count: 3 });

      await service.syncVideos("user-1", "streamer-1");

      expect(prisma.video.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ streamerId: "streamer-1" }),
        })
      );
    });

    it("logs debug when old videos were deleted", async () => {
      mockCallApi.mockResolvedValueOnce({ data: [], pagination: {} });
      (prisma.video.deleteMany as jest.Mock).mockResolvedValueOnce({ count: 5 });

      await service.syncVideos("user-1", "streamer-1");

      expect(logger.debug).toHaveBeenCalledWith(
        "TwitchVideo",
        expect.stringContaining("Cleaned up 5 videos")
      );
    });

    it("catches errors and calls logger.error", async () => {
      mockCallApi.mockRejectedValueOnce(new Error("API failure"));

      await service.syncVideos("user-1", "streamer-1");

      expect(logger.error).toHaveBeenCalledWith(
        "TwitchVideo",
        expect.stringContaining("Failed to sync videos"),
        expect.any(Error)
      );
    });
  });

  // ──────────────────────────────────────────────────────────────
  // syncViewerVideos
  // ──────────────────────────────────────────────────────────────
  describe("syncViewerVideos", () => {
    it("creates new viewer videos when none exist", async () => {
      const sdkVideo = makeSdkVideo();
      mockGetVideosByUser.mockResolvedValueOnce({ data: [sdkVideo] });

      const tx = makeTxMock(/* no existing videos */);
      (prisma.$transaction as jest.Mock).mockImplementationOnce(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

      await service.syncViewerVideos("channel-1", "twitch-user-1");

      expect(tx.viewerChannelVideo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ twitchVideoId: "vid-1", channelId: "channel-1" }),
        })
      );
      expect(logger.error).not.toHaveBeenCalled();
    });

    it("deletes all viewer videos when incoming list is empty", async () => {
      mockGetVideosByUser.mockResolvedValueOnce({ data: [] });

      const tx = makeTxMock();
      (prisma.$transaction as jest.Mock).mockImplementationOnce(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

      await service.syncViewerVideos("channel-1", "twitch-user-1");

      expect(tx.viewerChannelVideo.deleteMany).toHaveBeenCalledWith({ where: { channelId: "channel-1" } });
    });

    it("does not call update when existing video has no changes", async () => {
      const publishDate = new Date("2024-01-01T00:00:00Z");
      const existing = [{
        id: "db-id-1",
        twitchVideoId: "vid-1",
        title: "Test Video",
        url: "https://twitch.tv/videos/vid-1",
        thumbnailUrl: "https://thumb/320x180.jpg",
        viewCount: 100,
        duration: "1h2m3s",
        publishedAt: publishDate,
      }];

      mockGetVideosByUser.mockResolvedValueOnce({
        data: [makeSdkVideo({
          thumbnailUrl: "https://thumb/320x180.jpg",
          publishDate,
        })],
      });

      const tx = makeTxMock(existing);
      (prisma.$transaction as jest.Mock).mockImplementationOnce(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

      await service.syncViewerVideos("channel-1", "twitch-user-1");

      expect(tx.viewerChannelVideo.update).not.toHaveBeenCalled();
      expect(tx.viewerChannelVideo.create).not.toHaveBeenCalled();
    });

    it("calls update when existing video has changed viewCount", async () => {
      const publishDate = new Date("2024-01-01T00:00:00Z");
      const existing = [{
        id: "db-id-1",
        twitchVideoId: "vid-1",
        title: "Test Video",
        url: "https://twitch.tv/videos/vid-1",
        thumbnailUrl: "https://thumb/320x180.jpg",
        viewCount: 50, // different from incoming (100)
        duration: "1h2m3s",
        publishedAt: publishDate,
      }];

      mockGetVideosByUser.mockResolvedValueOnce({
        data: [makeSdkVideo({
          thumbnailUrl: "https://thumb/320x180.jpg",
          publishDate,
          views: 100,
        })],
      });

      const tx = makeTxMock(existing);
      (prisma.$transaction as jest.Mock).mockImplementationOnce(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

      await service.syncViewerVideos("channel-1", "twitch-user-1");

      expect(tx.viewerChannelVideo.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "db-id-1" } })
      );
    });

    it("normalizes thumbnail URL placeholders in viewer videos", async () => {
      mockGetVideosByUser.mockResolvedValueOnce({
        data: [makeSdkVideo({ thumbnailUrl: "https://thumb/%{width}x%{height}.jpg" })],
      });

      const tx = makeTxMock();
      (prisma.$transaction as jest.Mock).mockImplementationOnce(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

      await service.syncViewerVideos("channel-1", "twitch-user-1");

      const createCall = tx.viewerChannelVideo.create.mock.calls[0][0];
      expect(createCall.data.thumbnailUrl).toBe("https://thumb/320x180.jpg");
    });

    it("catches errors and calls logger.error", async () => {
      mockGetVideosByUser.mockRejectedValueOnce(new Error("SDK failure"));

      await service.syncViewerVideos("channel-1", "twitch-user-1");

      expect(logger.error).toHaveBeenCalledWith(
        "TwitchVideo",
        expect.stringContaining("Failed to sync viewer videos"),
        expect.any(Error)
      );
    });

    it("deletes viewer videos not in the incoming list", async () => {
      const existing = [{
        id: "db-id-old",
        twitchVideoId: "vid-old",
        title: "Old Video",
        url: "https://twitch.tv/videos/vid-old",
        thumbnailUrl: null,
        viewCount: 10,
        duration: "30m",
        publishedAt: new Date("2023-01-01T00:00:00Z"),
      }];

      mockGetVideosByUser.mockResolvedValueOnce({ data: [makeSdkVideo({ id: "vid-new" })] });

      const tx = makeTxMock(existing);
      (prisma.$transaction as jest.Mock).mockImplementationOnce(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

      await service.syncViewerVideos("channel-1", "twitch-user-1");

      expect(tx.viewerChannelVideo.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            channelId: "channel-1",
            twitchVideoId: { notIn: ["vid-new"] },
          }),
        })
      );
    });
  });

  // ──────────────────────────────────────────────────────────────
  // syncClips
  // ──────────────────────────────────────────────────────────────
  describe("syncClips", () => {
    it("syncs one page of clips and calls $executeRaw", async () => {
      mockCallApi.mockResolvedValueOnce({
        data: [makeRawClip()],
        pagination: {},
      });

      await service.syncClips("user-1", "streamer-1");

      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
      expect(logger.error).not.toHaveBeenCalled();
    });

    it("does not call $executeRaw when API returns empty data", async () => {
      mockCallApi.mockResolvedValueOnce({ data: [], pagination: {} });

      await service.syncClips("user-1", "streamer-1");

      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });

    it("normalizes clip thumbnail URL placeholders", async () => {
      mockCallApi.mockResolvedValueOnce({
        data: [makeRawClip({ thumbnail_url: "https://thumb/{width}x{height}.jpg" })],
        pagination: {},
      });

      await service.syncClips("user-1", "streamer-1");

      const sqlArg = (prisma.$executeRaw as jest.Mock).mock.calls[0][0];
      const joined = sqlArg.values.join(" ");
      expect(joined).not.toContain("{width}");
      expect(joined).not.toContain("{height}");
      expect(joined).toContain("320");
    });

    it("handles null clip thumbnail without throwing", async () => {
      mockCallApi.mockResolvedValueOnce({
        data: [makeRawClip({ thumbnail_url: null })],
        pagination: {},
      });

      await service.syncClips("user-1", "streamer-1");

      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it("paginates across multiple pages", async () => {
      mockCallApi
        .mockResolvedValueOnce({
          data: [makeRawClip({ id: "clip-1" })],
          pagination: { cursor: "page2-cursor" },
        })
        .mockResolvedValueOnce({
          data: [makeRawClip({ id: "clip-2" })],
          pagination: {},
        });

      await service.syncClips("user-1", "streamer-1");

      expect(mockCallApi).toHaveBeenCalledTimes(2);
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
    });

    it("catches errors and calls logger.error", async () => {
      mockCallApi.mockRejectedValueOnce(new Error("clips API failure"));

      await service.syncClips("user-1", "streamer-1");

      expect(logger.error).toHaveBeenCalledWith(
        "TwitchVideo",
        expect.stringContaining("Failed to sync clips"),
        expect.any(Error)
      );
    });

    it("passes broadcaster_id query param correctly", async () => {
      mockCallApi.mockResolvedValueOnce({ data: [], pagination: {} });

      await service.syncClips("user-42", "streamer-1");

      expect(mockCallApi).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.objectContaining({ broadcaster_id: "user-42" }),
        })
      );
    });
  });

  // ──────────────────────────────────────────────────────────────
  // syncViewerClips
  // ──────────────────────────────────────────────────────────────
  describe("syncViewerClips", () => {
    it("creates new viewer clips when none exist", async () => {
      const sdkClip = makeSdkClip();
      mockGetClipsForBroadcaster.mockResolvedValueOnce({ data: [sdkClip] });

      const tx = makeTxMock([], /* no existing clips */);
      (prisma.$transaction as jest.Mock).mockImplementationOnce(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

      await service.syncViewerClips("channel-1", "twitch-user-1");

      expect(tx.viewerChannelClip.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ twitchClipId: "clip-1", channelId: "channel-1" }),
        })
      );
      expect(logger.error).not.toHaveBeenCalled();
    });

    it("deletes all viewer clips when incoming list is empty", async () => {
      mockGetClipsForBroadcaster.mockResolvedValueOnce({ data: [] });

      const tx = makeTxMock([], []);
      (prisma.$transaction as jest.Mock).mockImplementationOnce(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

      await service.syncViewerClips("channel-1", "twitch-user-1");

      expect(tx.viewerChannelClip.deleteMany).toHaveBeenCalledWith({ where: { channelId: "channel-1" } });
    });

    it("does not call update when existing clip has no changes", async () => {
      const creationDate = new Date("2024-01-01T00:00:00Z");
      const existing = [{
        id: "db-clip-1",
        twitchClipId: "clip-1",
        creatorName: "Creator",
        title: "Test Clip",
        url: "https://clips.twitch.tv/clip-1",
        thumbnailUrl: "https://thumb/320x180.jpg",
        viewCount: 500,
        duration: 30,
        createdAt: creationDate,
      }];

      mockGetClipsForBroadcaster.mockResolvedValueOnce({
        data: [makeSdkClip({
          thumbnailUrl: "https://thumb/320x180.jpg",
          creationDate,
        })],
      });

      const tx = makeTxMock([], existing);
      (prisma.$transaction as jest.Mock).mockImplementationOnce(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

      await service.syncViewerClips("channel-1", "twitch-user-1");

      expect(tx.viewerChannelClip.update).not.toHaveBeenCalled();
      expect(tx.viewerChannelClip.create).not.toHaveBeenCalled();
    });

    it("calls update when existing clip has changed viewCount", async () => {
      const creationDate = new Date("2024-01-01T00:00:00Z");
      const existing = [{
        id: "db-clip-1",
        twitchClipId: "clip-1",
        creatorName: "Creator",
        title: "Test Clip",
        url: "https://clips.twitch.tv/clip-1",
        thumbnailUrl: "https://thumb/320x180.jpg",
        viewCount: 200, // different from incoming (500)
        duration: 30,
        createdAt: creationDate,
      }];

      mockGetClipsForBroadcaster.mockResolvedValueOnce({
        data: [makeSdkClip({
          thumbnailUrl: "https://thumb/320x180.jpg",
          creationDate,
          views: 500,
        })],
      });

      const tx = makeTxMock([], existing);
      (prisma.$transaction as jest.Mock).mockImplementationOnce(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

      await service.syncViewerClips("channel-1", "twitch-user-1");

      expect(tx.viewerChannelClip.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "db-clip-1" } })
      );
    });

    it("normalizes thumbnail URL placeholders in viewer clips", async () => {
      mockGetClipsForBroadcaster.mockResolvedValueOnce({
        data: [makeSdkClip({ thumbnailUrl: "https://thumb/%{width}x%{height}.jpg" })],
      });

      const tx = makeTxMock([], []);
      (prisma.$transaction as jest.Mock).mockImplementationOnce(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

      await service.syncViewerClips("channel-1", "twitch-user-1");

      const createCall = tx.viewerChannelClip.create.mock.calls[0][0];
      expect(createCall.data.thumbnailUrl).toBe("https://thumb/320x180.jpg");
    });

    it("deletes viewer clips not in the incoming list", async () => {
      const existing = [{
        id: "db-clip-old",
        twitchClipId: "clip-old",
        creatorName: "OldCreator",
        title: "Old Clip",
        url: "https://clips.twitch.tv/old",
        thumbnailUrl: null,
        viewCount: 10,
        duration: 15,
        createdAt: new Date("2023-01-01T00:00:00Z"),
      }];

      mockGetClipsForBroadcaster.mockResolvedValueOnce({ data: [makeSdkClip({ id: "clip-new" })] });

      const tx = makeTxMock([], existing);
      (prisma.$transaction as jest.Mock).mockImplementationOnce(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

      await service.syncViewerClips("channel-1", "twitch-user-1");

      expect(tx.viewerChannelClip.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            channelId: "channel-1",
            twitchClipId: { notIn: ["clip-new"] },
          }),
        })
      );
    });

    it("catches errors and calls logger.error", async () => {
      mockGetClipsForBroadcaster.mockRejectedValueOnce(new Error("SDK clips failure"));

      await service.syncViewerClips("channel-1", "twitch-user-1");

      expect(logger.error).toHaveBeenCalledWith(
        "TwitchVideo",
        expect.stringContaining("Failed to sync viewer clips"),
        expect.any(Error)
      );
    });
  });

  // ──────────────────────────────────────────────────────────────
  // Exported singleton
  // ──────────────────────────────────────────────────────────────
  describe("twurpleVideoService singleton", () => {
    it("is an instance of TwurpleVideoService", () => {
      expect(twurpleVideoService).toBeInstanceOf(TwurpleVideoService);
    });
  });

  // ──────────────────────────────────────────────────────────────
  // getClient caching
  // ──────────────────────────────────────────────────────────────
  describe("getClient caching", () => {
    it("re-uses the same ApiClient across multiple calls", async () => {
      mockCallApi
        .mockResolvedValueOnce({ data: [], pagination: {} })
        .mockResolvedValueOnce({ data: [], pagination: {} });

      await service.syncVideos("user-1", "streamer-1");
      await service.syncVideos("user-1", "streamer-1");

      const { importTwurpleApi } = jest.requireMock("../../utils/dynamic-import") as {
        importTwurpleApi: jest.Mock;
      };
      // importTwurpleApi should only be called once even across two invocations
      expect(importTwurpleApi).toHaveBeenCalledTimes(1);
    });
  });
});
