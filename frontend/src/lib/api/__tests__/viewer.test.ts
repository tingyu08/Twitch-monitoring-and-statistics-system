import {
  getFollowedChannels,
  normalizeFollowedChannel,
  normalizeFollowedChannelsResponse,
  viewerApi,
} from "../viewer";
import { httpClient } from "../httpClient";

jest.mock("../httpClient");
const mockHttpClient = httpClient as jest.MockedFunction<typeof httpClient>;

describe("viewer api", () => {
  const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    warnSpy.mockRestore();
  });

  describe("normalization", () => {
    it("maps legacy watch/message fields to current shape", () => {
      const normalized = normalizeFollowedChannel({
        id: "c1",
        channelName: "demo",
        displayName: "Demo",
        isLive: true,
        totalWatchMin: 135,
        totalMessages: 42,
        viewerCount: "123",
      });

      expect(normalized.totalWatchMinutes).toBe(135);
      expect(normalized.messageCount).toBe(42);
      expect(normalized.viewerCount).toBe(123);
    });

    it("applies fallbacks for malformed values", () => {
      const normalized = normalizeFollowedChannel({
        id: 10,
        channelName: "demo",
        displayName: 42,
        category: null,
        totalWatchTimeMinutes: "45",
        messageCount: "7",
        viewerCount: "invalid",
        streamStartedAt: "",
        followedAt: "",
        tags: "gaming",
        lastWatched: 1,
        currentTitle: "",
        currentGameName: "Game Name",
        currentViewerCount: "88",
        currentStreamStartedAt: "",
      });

      expect(normalized.id).toBe("");
      expect(normalized.displayName).toBe("demo");
      expect(normalized.category).toBe("Just Chatting");
      expect(normalized.totalWatchMinutes).toBe(45);
      expect(normalized.messageCount).toBe(7);
      expect(normalized.viewerCount).toBe(0);
      expect(normalized.streamStartedAt).toBeNull();
      expect(normalized.followedAt).toBeNull();
      expect(normalized.tags).toEqual([]);
      expect(normalized.lastWatched).toBeNull();
      expect(normalized.currentTitle).toBeUndefined();
      expect(normalized.currentGameName).toBe("Game Name");
      expect(normalized.currentViewerCount).toBe(88);
      expect(normalized.currentStreamStartedAt).toBeUndefined();
    });

    it("keeps viewerCount as null when backend returns null", () => {
      const normalized = normalizeFollowedChannel({
        channelName: "demo",
        displayName: "Demo",
        viewerCount: null,
      });

      expect(normalized.viewerCount).toBeNull();
    });

    it("uses currentViewerCount when viewerCount is missing", () => {
      const normalized = normalizeFollowedChannel({
        channelName: "demo",
        displayName: "Demo",
        currentViewerCount: 321,
        tags: ["one", "two"],
      });

      expect(normalized.viewerCount).toBe(321);
      expect(normalized.currentViewerCount).toBe(321);
      expect(normalized.tags).toEqual(["one", "two"]);
    });

    it("uses default displayName when channelName is missing", () => {
      const normalized = normalizeFollowedChannel({
        displayName: 123,
      });

      expect(normalized.channelName).toBe("");
      expect(normalized.displayName).toBe("Unknown");
      expect(normalized.viewerCount).toBeNull();
      expect(normalized.currentViewerCount).toBeUndefined();
    });

    it("handles undefined raw payload", () => {
      const normalized = normalizeFollowedChannel(undefined);

      expect(normalized.id).toBe("");
      expect(normalized.channelName).toBe("");
      expect(normalized.displayName).toBe("Unknown");
      expect(normalized.category).toBe("Just Chatting");
      expect(normalized.totalWatchMinutes).toBe(0);
      expect(normalized.messageCount).toBe(0);
    });

    it("returns empty array when response is not array", () => {
      expect(normalizeFollowedChannelsResponse(null)).toEqual([]);
      expect(normalizeFollowedChannelsResponse({})).toEqual([]);
    });

    it("normalizes each item in array responses", () => {
      const result = normalizeFollowedChannelsResponse([
        { channelName: "foo", displayName: "Foo", totalWatchMin: 30 },
        { channelName: "bar", displayName: "Bar", totalMessages: 12 },
      ]);

      expect(result).toHaveLength(2);
      expect(result[0].totalWatchMinutes).toBe(30);
      expect(result[1].messageCount).toBe(12);
    });
  });

  describe("getFollowedChannels", () => {
    it("returns normalized channels on success", async () => {
      mockHttpClient.mockResolvedValueOnce([
        {
          id: "a1",
          channelName: "alpha",
          displayName: "Alpha",
          totalWatchMin: "60",
          totalMessages: "9",
        },
      ]);

      const result = await getFollowedChannels();

      expect(mockHttpClient).toHaveBeenCalledWith("/api/viewer/channels");
      expect(result).toEqual([
        expect.objectContaining({
          id: "a1",
          channelName: "alpha",
          totalWatchMinutes: 60,
          messageCount: 9,
        }),
      ]);
    });

    it("returns empty array when request fails", async () => {
      mockHttpClient.mockRejectedValueOnce(new Error("boom"));

      const result = await getFollowedChannels();

      expect(result).toEqual([]);
      expect(warnSpy).toHaveBeenCalledWith(
        "Failed to fetch followed channels, returning empty list",
        expect.any(Error)
      );
    });
  });

  describe("viewerApi helpers", () => {
    it("submits consent payload", async () => {
      const response = {
        viewerId: "viewer-1",
        consentedAt: "2025-01-01T00:00:00.000Z",
        consentVersion: 3,
      };
      mockHttpClient.mockResolvedValueOnce(response);

      const result = await viewerApi.submitConsent(true, 3);

      expect(result).toEqual(response);
      expect(mockHttpClient).toHaveBeenCalledWith("/api/viewer/consent", {
        method: "POST",
        body: JSON.stringify({ consented: true, consentVersion: 3 }),
      });
    });

    it("uses default consent version", async () => {
      mockHttpClient.mockResolvedValueOnce({
        viewerId: "viewer-1",
        consentedAt: "2025-01-01T00:00:00.000Z",
        consentVersion: 1,
      });

      await viewerApi.submitConsent(false);

      expect(mockHttpClient).toHaveBeenCalledWith("/api/viewer/consent", {
        method: "POST",
        body: JSON.stringify({ consented: false, consentVersion: 1 }),
      });
    });

    it("delegates viewerApi.getFollowedChannels to shared function", async () => {
      mockHttpClient.mockResolvedValueOnce([
        { channelName: "alpha", displayName: "Alpha" },
        { channelName: "beta", displayName: "Beta" },
      ]);

      const result = await viewerApi.getFollowedChannels();

      expect(result).toHaveLength(2);
      expect(mockHttpClient).toHaveBeenCalledWith("/api/viewer/channels");
    });

    it("searches channels by channelName and displayName (case-insensitive)", async () => {
      mockHttpClient.mockResolvedValue([
        { channelName: "alpha_one", displayName: "Alpha One" },
        { channelName: "beta", displayName: "BETA Prime" },
      ]);

      const byChannelName = await viewerApi.searchChannels("ALPHA");
      const byDisplayName = await viewerApi.searchChannels("prime");

      expect(byChannelName).toHaveLength(1);
      expect(byChannelName[0].channelName).toBe("alpha_one");
      expect(byDisplayName).toHaveLength(1);
      expect(byDisplayName[0].displayName).toBe("BETA Prime");
    });

    it("builds message stats URL without optional dates", async () => {
      mockHttpClient.mockResolvedValueOnce({
        channelId: "c1",
        timeRange: { startDate: "", endDate: "" },
        summary: {
          totalMessages: 0,
          avgMessagesPerStream: 0,
          mostActiveDate: null,
          mostActiveDateCount: 0,
          lastMessageAt: null,
        },
        interactionBreakdown: {
          chatMessages: 0,
          subscriptions: 0,
          cheers: 0,
          giftSubs: 0,
          raids: 0,
          totalBits: 0,
        },
        dailyBreakdown: [],
      });

      await viewerApi.getMessageStats("v1", "c1");

      expect(mockHttpClient).toHaveBeenCalledWith("/api/viewer/v1/channels/c1/message-stats");
    });

    it("builds message stats URL with optional dates", async () => {
      mockHttpClient.mockResolvedValueOnce(null);

      await viewerApi.getMessageStats("v1", "c1", "2025-01-01", "2025-01-31");

      expect(mockHttpClient).toHaveBeenCalledWith(
        "/api/viewer/v1/channels/c1/message-stats?startDate=2025-01-01&endDate=2025-01-31"
      );
    });

    it("builds message stats URL with only startDate", async () => {
      mockHttpClient.mockResolvedValueOnce(null);

      await viewerApi.getMessageStats("v1", "c1", "2025-01-01");

      expect(mockHttpClient).toHaveBeenCalledWith(
        "/api/viewer/v1/channels/c1/message-stats?startDate=2025-01-01"
      );
    });

    it("builds message stats URL with only endDate", async () => {
      mockHttpClient.mockResolvedValueOnce(null);

      await viewerApi.getMessageStats("v1", "c1", undefined, "2025-01-31");

      expect(mockHttpClient).toHaveBeenCalledWith(
        "/api/viewer/v1/channels/c1/message-stats?endDate=2025-01-31"
      );
    });

    it("returns null for message stats when request fails", async () => {
      mockHttpClient.mockRejectedValueOnce(new Error("message stats failed"));

      const result = await viewerApi.getMessageStats("v1", "c1");

      expect(result).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith("Failed to fetch message stats", expect.any(Error));
    });

    it("computes channel stats summary and uses fallback channel info", async () => {
      mockHttpClient.mockResolvedValueOnce({
        dailyStats: [
          { date: "2025-01-01", watchHours: 1.2, messageCount: 4, emoteCount: 2 },
          { date: "2025-01-02", watchHours: 0, messageCount: 6, emoteCount: 1 },
        ],
      });

      const result = await viewerApi.getChannelStats("ch-1", 14);

      expect(mockHttpClient).toHaveBeenCalledWith("/api/viewer/stats/ch-1?days=14");
      expect(result).toEqual({
        channel: {
          id: "ch-1",
          name: "unknown",
          displayName: "Loading...",
          avatarUrl: "",
          isLive: false,
          totalWatchHours: 0,
          totalMessages: 0,
          lastWatched: "",
        },
        dailyStats: [
          { date: "2025-01-01", watchHours: 1.2, messageCount: 4, emoteCount: 2 },
          { date: "2025-01-02", watchHours: 0, messageCount: 6, emoteCount: 1 },
        ],
        summary: {
          totalWatchHours: 1.2,
          totalMessages: 10,
          totalEmotes: 3,
          sessionCount: 1,
          averageWatchMinutesPerDay: 36,
          firstWatchDate: "2025-01-01",
          lastWatchDate: "2025-01-02",
        },
      });
    });

    it("uses backend channel and ignores non-array dailyStats", async () => {
      const channel = {
        id: "ch-real",
        name: "real-channel",
        displayName: "Real Channel",
        avatarUrl: "https://example.com/avatar.png",
        isLive: true,
        totalWatchHours: 30,
        totalMessages: 400,
        lastWatched: "2025-01-02",
      };

      mockHttpClient.mockResolvedValueOnce({
        dailyStats: "invalid",
        channel,
      });

      const result = await viewerApi.getChannelStats("ch-real");

      expect(result).toEqual({
        channel,
        dailyStats: [],
        summary: {
          totalWatchHours: 0,
          totalMessages: 0,
          totalEmotes: 0,
          sessionCount: 0,
          averageWatchMinutesPerDay: 0,
          firstWatchDate: "",
          lastWatchDate: "",
        },
      });
    });

    it("handles null channel stats response by returning default shape", async () => {
      mockHttpClient.mockResolvedValueOnce(null);

      const result = await viewerApi.getChannelStats("ch-null");

      expect(result).toEqual({
        channel: {
          id: "ch-null",
          name: "unknown",
          displayName: "Loading...",
          avatarUrl: "",
          isLive: false,
          totalWatchHours: 0,
          totalMessages: 0,
          lastWatched: "",
        },
        dailyStats: [],
        summary: {
          totalWatchHours: 0,
          totalMessages: 0,
          totalEmotes: 0,
          sessionCount: 0,
          averageWatchMinutesPerDay: 0,
          firstWatchDate: "",
          lastWatchDate: "",
        },
      });
    });

    it("returns default channel stats shape when request fails", async () => {
      mockHttpClient.mockRejectedValueOnce(new Error("stats failed"));

      const result = await viewerApi.getChannelStats("ch-2");

      expect(result).toEqual({
        channel: {
          id: "ch-2",
          name: "unknown",
          displayName: "Loading...",
          avatarUrl: "",
          isLive: false,
          totalWatchHours: 0,
          totalMessages: 0,
          lastWatched: "",
        },
        dailyStats: [],
        summary: {
          totalWatchHours: 0,
          totalMessages: 0,
          totalEmotes: 0,
          sessionCount: 0,
          averageWatchMinutesPerDay: 0,
          firstWatchDate: "",
          lastWatchDate: "",
        },
      });
      expect(warnSpy).toHaveBeenCalledWith("Failed to fetch real stats", expect.any(Error));
    });

    it("normalizes channelDetailAll summary from partial backend response", async () => {
      mockHttpClient.mockResolvedValueOnce({
        channelStats: {
          dailyStats: [{ date: "2025-01-03", watchHours: 2, messageCount: 5, emoteCount: 1 }],
          summary: { totalMessages: 99 },
        },
        messageStats: null,
        gameStats: null,
        viewerTrends: null,
      });

      const result = await viewerApi.getChannelDetailAll("ch-3", 7);

      expect(mockHttpClient).toHaveBeenCalledWith("/api/viewer/channel-detail/ch-3?days=7");
      expect(result?.channelStats).toEqual({
        channel: {
          id: "ch-3",
          name: "unknown",
          displayName: "Loading...",
          avatarUrl: "",
          isLive: false,
          totalWatchHours: 0,
          totalMessages: 0,
          lastWatched: "",
        },
        dailyStats: [{ date: "2025-01-03", watchHours: 2, messageCount: 5, emoteCount: 1 }],
        summary: {
          totalWatchHours: 2,
          totalMessages: 99,
          totalEmotes: 1,
          sessionCount: 1,
          averageWatchMinutesPerDay: 120,
          firstWatchDate: "2025-01-03",
          lastWatchDate: "2025-01-03",
        },
      });
    });

    it("normalizes channelDetailAll when summary is missing and dailyStats is invalid", async () => {
      mockHttpClient.mockResolvedValueOnce({
        channelStats: {
          dailyStats: "not-an-array",
          summary: {
            totalMessages: "bad-value",
          },
        },
        messageStats: null,
        gameStats: null,
        viewerTrends: null,
      });

      const result = await viewerApi.getChannelDetailAll("ch-5", 30);

      expect(result?.channelStats).toEqual({
        channel: {
          id: "ch-5",
          name: "unknown",
          displayName: "Loading...",
          avatarUrl: "",
          isLive: false,
          totalWatchHours: 0,
          totalMessages: 0,
          lastWatched: "",
        },
        dailyStats: [],
        summary: {
          totalWatchHours: 0,
          totalMessages: 0,
          totalEmotes: 0,
          sessionCount: 0,
          averageWatchMinutesPerDay: 0,
          firstWatchDate: "",
          lastWatchDate: "",
        },
      });
    });

    it("normalizes channelDetailAll with empty dailyStats and no summary", async () => {
      mockHttpClient.mockResolvedValueOnce({
        channelStats: {
          dailyStats: [],
        },
        messageStats: null,
        gameStats: null,
        viewerTrends: null,
      });

      const result = await viewerApi.getChannelDetailAll("ch-6");

      expect(result?.channelStats?.summary).toEqual({
        totalWatchHours: 0,
        totalMessages: 0,
        totalEmotes: 0,
        sessionCount: 0,
        averageWatchMinutesPerDay: 0,
        firstWatchDate: "",
        lastWatchDate: "",
      });
    });

    it("returns null for channelDetailAll when request fails", async () => {
      mockHttpClient.mockRejectedValueOnce(new Error("channel detail failed"));

      const result = await viewerApi.getChannelDetailAll("ch-4");

      expect(result).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith("Failed to fetch channel detail", expect.any(Error));
    });

    it("keeps channelStats null when backend returns null", async () => {
      mockHttpClient.mockResolvedValueOnce({
        channelStats: null,
        messageStats: null,
        gameStats: null,
        viewerTrends: null,
      });

      const result = await viewerApi.getChannelDetailAll("ch-null-stats");

      expect(result).toEqual({
        channelStats: null,
        messageStats: null,
        gameStats: null,
        viewerTrends: null,
      });
    });

    it("normalizes channelDetailAll using full backend summary and channel", async () => {
      mockHttpClient.mockResolvedValueOnce({
        channelStats: {
          channel: {
            id: "ch-full",
            name: "full",
            displayName: "Full",
            avatarUrl: "avatar",
            isLive: false,
            totalWatchHours: 10,
            totalMessages: 20,
            lastWatched: "2025-01-05",
          },
          dailyStats: [{ date: "2025-01-05", watchHours: 3, messageCount: 2, emoteCount: 1 }],
          summary: {
            totalWatchHours: 999,
            totalMessages: 888,
            totalEmotes: 777,
            sessionCount: 666,
            averageWatchMinutesPerDay: 555,
            firstWatchDate: "A",
            lastWatchDate: "B",
          },
        },
        messageStats: null,
        gameStats: null,
        viewerTrends: null,
      });

      const result = await viewerApi.getChannelDetailAll("ch-full");

      expect(result?.channelStats?.channel.id).toBe("ch-full");
      expect(result?.channelStats?.summary).toEqual({
        totalWatchHours: 999,
        totalMessages: 888,
        totalEmotes: 777,
        sessionCount: 666,
        averageWatchMinutesPerDay: 555,
        firstWatchDate: "A",
        lastWatchDate: "B",
      });
    });

    it("gets privacy settings", async () => {
      const payload = { pauseCollection: true, consentGivenAt: "2025-01-01" };
      mockHttpClient.mockResolvedValueOnce(payload);

      const result = await viewerApi.getPrivacySettings();

      expect(result).toEqual(payload);
      expect(mockHttpClient).toHaveBeenCalledWith("/api/viewer/privacy/settings");
    });

    it("returns null when privacy settings request fails", async () => {
      mockHttpClient.mockRejectedValueOnce(new Error("privacy failed"));

      const result = await viewerApi.getPrivacySettings();

      expect(result).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith("Failed to fetch privacy settings", expect.any(Error));
    });

    it("updates privacy settings", async () => {
      const payload = { success: true, message: "ok" };
      mockHttpClient.mockResolvedValueOnce(payload);

      const result = await viewerApi.updatePrivacySettings(false);

      expect(result).toEqual(payload);
      expect(mockHttpClient).toHaveBeenCalledWith("/api/viewer/privacy/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pauseCollection: false }),
      });
    });

    it("returns null when updating privacy settings fails", async () => {
      mockHttpClient.mockRejectedValueOnce(new Error("privacy update failed"));

      const result = await viewerApi.updatePrivacySettings(true);

      expect(result).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        "Failed to update privacy settings",
        expect.any(Error)
      );
    });

    it("gets data summary", async () => {
      const payload = {
        totalMessages: 1,
        totalAggregations: 2,
        channelCount: 3,
        dateRange: { oldest: "2024-01-01", newest: "2025-01-01" },
      };
      mockHttpClient.mockResolvedValueOnce(payload);

      const result = await viewerApi.getDataSummary();

      expect(result).toEqual(payload);
      expect(mockHttpClient).toHaveBeenCalledWith("/api/viewer/privacy/data-summary");
    });

    it("returns null when data summary request fails", async () => {
      mockHttpClient.mockRejectedValueOnce(new Error("summary failed"));

      const result = await viewerApi.getDataSummary();

      expect(result).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith("Failed to fetch data summary", expect.any(Error));
    });

    it("clears all messages", async () => {
      const payload = {
        success: true,
        message: "cleared",
        deletedCount: { messages: 10, aggregations: 20 },
      };
      mockHttpClient.mockResolvedValueOnce(payload);

      const result = await viewerApi.clearAllMessages();

      expect(result).toEqual(payload);
      expect(mockHttpClient).toHaveBeenCalledWith("/api/viewer/privacy/messages", {
        method: "DELETE",
      });
    });

    it("returns null when clear all messages fails", async () => {
      mockHttpClient.mockRejectedValueOnce(new Error("clear all failed"));

      const result = await viewerApi.clearAllMessages();

      expect(result).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith("Failed to clear messages", expect.any(Error));
    });

    it("clears channel messages", async () => {
      const payload = {
        success: true,
        message: "cleared",
        deletedCount: { messages: 5, aggregations: 6 },
      };
      mockHttpClient.mockResolvedValueOnce(payload);

      const result = await viewerApi.clearChannelMessages("ch-11");

      expect(result).toEqual(payload);
      expect(mockHttpClient).toHaveBeenCalledWith("/api/viewer/privacy/messages/ch-11", {
        method: "DELETE",
      });
    });

    it("returns null when clear channel messages fails", async () => {
      mockHttpClient.mockRejectedValueOnce(new Error("clear channel failed"));

      const result = await viewerApi.clearChannelMessages("ch-11");

      expect(result).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith("Failed to clear channel messages", expect.any(Error));
    });

    it("sets listen channels", async () => {
      const channels = [{ channelName: "alpha", isLive: true }];
      const payload = { success: true, message: "ok", listening: ["alpha"] };
      mockHttpClient.mockResolvedValueOnce(payload);

      const result = await viewerApi.setListenChannels(channels);

      expect(result).toEqual(payload);
      expect(mockHttpClient).toHaveBeenCalledWith("/api/viewer/listen-channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channels }),
      });
    });

    it("returns null when setting listen channels fails", async () => {
      mockHttpClient.mockRejectedValueOnce(new Error("listen failed"));

      const result = await viewerApi.setListenChannels([{ channelName: "alpha", isLive: false }]);

      expect(result).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith("Failed to set listen channels", expect.any(Error));
    });

    it("gets channel videos", async () => {
      const payload = { videos: [], pagination: { page: 1, limit: 2, total: 0, totalPages: 0 } };
      mockHttpClient.mockResolvedValueOnce(payload);

      const result = await viewerApi.getChannelVideos("ch-v", 2, 9);

      expect(result).toEqual(payload);
      expect(mockHttpClient).toHaveBeenCalledWith("/api/streamer/ch-v/videos?page=2&limit=9");
    });

    it("returns null when fetching channel videos fails", async () => {
      mockHttpClient.mockRejectedValueOnce(new Error("videos failed"));

      const result = await viewerApi.getChannelVideos("ch-v");

      expect(result).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith("Failed to fetch videos", expect.any(Error));
    });

    it("gets channel clips", async () => {
      const payload = { clips: [], pagination: { page: 1, limit: 2, total: 0, totalPages: 0 } };
      mockHttpClient.mockResolvedValueOnce(payload);

      const result = await viewerApi.getChannelClips("ch-c", 3, 4);

      expect(result).toEqual(payload);
      expect(mockHttpClient).toHaveBeenCalledWith("/api/streamer/ch-c/clips?page=3&limit=4");
    });

    it("returns null when fetching channel clips fails", async () => {
      mockHttpClient.mockRejectedValueOnce(new Error("clips failed"));

      const result = await viewerApi.getChannelClips("ch-c");

      expect(result).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith("Failed to fetch clips", expect.any(Error));
    });

    it("gets channel game stats", async () => {
      const payload = [{ gameName: "Game", watchHours: 1, percentage: 100 }];
      mockHttpClient.mockResolvedValueOnce(payload);

      const result = await viewerApi.getChannelGameStats("ch-g", "7d");

      expect(result).toEqual(payload);
      expect(mockHttpClient).toHaveBeenCalledWith("/api/streamer/ch-g/game-stats?range=7d");
    });

    it("returns null when fetching channel game stats fails", async () => {
      mockHttpClient.mockRejectedValueOnce(new Error("games failed"));

      const result = await viewerApi.getChannelGameStats("ch-g");

      expect(result).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith("Failed to fetch game stats", expect.any(Error));
    });

    it("gets channel viewer trends", async () => {
      const payload = [
        {
          date: "2025-01-01",
          title: "Stream",
          avgViewers: 10,
          peakViewers: 20,
          durationHours: 2,
          category: "Games",
        },
      ];
      mockHttpClient.mockResolvedValueOnce(payload);

      const result = await viewerApi.getChannelViewerTrends("ch-t", "14d");

      expect(result).toEqual(payload);
      expect(mockHttpClient).toHaveBeenCalledWith("/api/streamer/ch-t/viewer-trends?range=14d");
    });

    it("returns null when fetching viewer trends fails", async () => {
      mockHttpClient.mockRejectedValueOnce(new Error("trends failed"));

      const result = await viewerApi.getChannelViewerTrends("ch-t");

      expect(result).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith("Failed to fetch viewer trends", expect.any(Error));
    });

    it("gets stream hourly stats", async () => {
      const payload = [{ timestamp: "2025-01-01T00:00:00Z", viewers: 12 }];
      mockHttpClient.mockResolvedValueOnce(payload);

      const result = await viewerApi.getChannelStreamHourlyStats("ch-h", "2025-01-01");

      expect(result).toEqual(payload);
      expect(mockHttpClient).toHaveBeenCalledWith("/api/streamer/ch-h/stream-hourly?date=2025-01-01");
    });

    it("returns null when fetching stream hourly stats fails", async () => {
      mockHttpClient.mockRejectedValueOnce(new Error("hourly failed"));

      const result = await viewerApi.getChannelStreamHourlyStats("ch-h", "2025-01-01");

      expect(result).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        "Failed to fetch stream hourly stats",
        expect.any(Error)
      );
    });
  });
});
