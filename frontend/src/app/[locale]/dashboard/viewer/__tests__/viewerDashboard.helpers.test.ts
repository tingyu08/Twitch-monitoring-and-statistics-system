import type { FollowedChannel } from "@/lib/api/viewer";

import {
  applyChannelUpdate,
  applyStatsDelta,
  applyStreamOfflineUpdate,
  applyStreamOnlineUpdate,
  buildAvatarUrl,
  buildListenChannelsPayload,
  filterAndSortChannels,
  formatStreamDuration,
  getCurrentPageChannels,
} from "../viewerDashboard.helpers";

function makeChannel(overrides: Partial<FollowedChannel> = {}): FollowedChannel {
  return {
    id: "1",
    channelName: "alpha",
    displayName: "Alpha",
    avatarUrl: "",
    category: "Just Chatting",
    isLive: false,
    viewerCount: 0,
    streamStartedAt: null,
    followedAt: "2024-01-01T00:00:00.000Z",
    tags: [],
    lastWatched: "2024-01-02T00:00:00.000Z",
    totalWatchMinutes: 0,
    messageCount: 0,
    ...overrides,
  };
}

describe("viewerDashboard.helpers", () => {
  describe("buildAvatarUrl", () => {
    it("returns avatarUrl when present", () => {
      expect(buildAvatarUrl(makeChannel({ avatarUrl: "https://avatar.test/a.png" }))).toBe(
        "https://avatar.test/a.png"
      );
    });

    it("builds ui-avatars fallback when avatarUrl is empty", () => {
      expect(buildAvatarUrl(makeChannel({ displayName: "Alpha Beta" }))).toContain(
        "Alpha%20Beta"
      );
    });
  });

  describe("formatStreamDuration", () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date("2026-01-01T12:30:00.000Z"));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("formats durations with hours and minutes", () => {
      expect(formatStreamDuration("2026-01-01T10:00:00.000Z")).toBe("2h 30m");
    });

    it("formats durations with only minutes when under one hour", () => {
      expect(formatStreamDuration("2026-01-01T12:10:00.000Z")).toBe("20m");
    });
  });

  describe("filterAndSortChannels", () => {
    it("returns an empty array when channels are nullish", () => {
      expect(filterAndSortChannels(null, "")).toEqual([]);
      expect(filterAndSortChannels(undefined, "")).toEqual([]);
    });

    it("filters by trimmed search query on channelName and displayName", () => {
      const channels = [
        makeChannel({ id: "1", channelName: "alpha" }),
        makeChannel({ id: "2", displayName: "Beta Hero", channelName: "beta" }),
      ];

      expect(filterAndSortChannels(channels, "  hero ")).toEqual([channels[1]]);
      expect(filterAndSortChannels(channels, "alp")).toEqual([channels[0]]);
    });

    it("sorts live channels before offline and by messageCount", () => {
      const channels = [
        makeChannel({ id: "1", channelName: "offline", isLive: false, messageCount: 99 }),
        makeChannel({ id: "2", channelName: "live-low", isLive: true, messageCount: 1 }),
        makeChannel({ id: "3", channelName: "live-high", isLive: true, messageCount: 5 }),
      ];

      expect(filterAndSortChannels(channels, "").map((c) => c.id)).toEqual(["3", "2", "1"]);
    });

    it("sorts live ties by streamStartedAt, followedAt, displayName, then id", () => {
      const newer = makeChannel({
        id: "2",
        channelName: "live2",
        displayName: "Beta",
        isLive: true,
        messageCount: 0,
        streamStartedAt: "2026-01-01T12:00:00.000Z",
      });
      const older = makeChannel({
        id: "1",
        channelName: "live1",
        displayName: "Alpha",
        isLive: true,
        messageCount: 0,
        streamStartedAt: "2026-01-01T11:00:00.000Z",
      });
      expect(filterAndSortChannels([older, newer], "").map((c) => c.id)).toEqual(["2", "1"]);

      const byFollow = [
        makeChannel({
          id: "3",
          channelName: "f1",
          displayName: "Same",
          isLive: true,
          streamStartedAt: null,
          followedAt: "2026-01-02T00:00:00.000Z",
        }),
        makeChannel({
          id: "4",
          channelName: "f2",
          displayName: "Same",
          isLive: true,
          streamStartedAt: null,
          followedAt: "2026-01-01T00:00:00.000Z",
        }),
      ];
      expect(filterAndSortChannels(byFollow, "").map((c) => c.id)).toEqual(["3", "4"]);

      const byDisplay = [
        makeChannel({ id: "5", channelName: "a", displayName: "Beta", isLive: true, streamStartedAt: null, followedAt: null }),
        makeChannel({ id: "6", channelName: "b", displayName: "Alpha", isLive: true, streamStartedAt: null, followedAt: null }),
      ];
      expect(filterAndSortChannels(byDisplay, "").map((c) => c.id)).toEqual(["6", "5"]);

      const byId = [
        makeChannel({ id: "b", channelName: "a", displayName: "Same", isLive: true, streamStartedAt: null, followedAt: null }),
        makeChannel({ id: "a", channelName: "b", displayName: "Same", isLive: true, streamStartedAt: null, followedAt: null }),
      ];
      expect(filterAndSortChannels(byId, "").map((c) => c.id)).toEqual(["a", "b"]);
    });

    it("sorts offline ties by lastWatched, followedAt, displayName, then id", () => {
      const newerWatch = makeChannel({ id: "2", lastWatched: "2026-01-03T00:00:00.000Z" });
      const olderWatch = makeChannel({ id: "1", lastWatched: "2026-01-02T00:00:00.000Z" });
      expect(filterAndSortChannels([olderWatch, newerWatch], "").map((c) => c.id)).toEqual([
        "2",
        "1",
      ]);

      const byFollow = [
        makeChannel({ id: "3", displayName: "Same", lastWatched: null, followedAt: "2026-01-03T00:00:00.000Z" }),
        makeChannel({ id: "4", displayName: "Same", lastWatched: null, followedAt: "2026-01-02T00:00:00.000Z" }),
      ];
      expect(filterAndSortChannels(byFollow, "").map((c) => c.id)).toEqual(["3", "4"]);

      const byDisplay = [
        makeChannel({ id: "5", displayName: "Beta", lastWatched: null, followedAt: null }),
        makeChannel({ id: "6", displayName: "Alpha", lastWatched: null, followedAt: null }),
      ];
      expect(filterAndSortChannels(byDisplay, "").map((c) => c.id)).toEqual(["6", "5"]);

      const byId = [
        makeChannel({ id: "b", displayName: "Same", lastWatched: null, followedAt: null }),
        makeChannel({ id: "a", displayName: "Same", lastWatched: null, followedAt: null }),
      ];
      expect(filterAndSortChannels(byId, "").map((c) => c.id)).toEqual(["a", "b"]);
    });
  });

  describe("getCurrentPageChannels", () => {
    it("returns the requested page slice", () => {
      const channels = ["1", "2", "3", "4"].map((id) => makeChannel({ id }));
      expect(getCurrentPageChannels(channels, 2, 2).map((c) => c.id)).toEqual(["3", "4"]);
    });
  });

  describe("buildListenChannelsPayload", () => {
    it("returns only live channels with channelName and isLive", () => {
      const result = buildListenChannelsPayload([
        makeChannel({ channelName: "live", isLive: true }),
        makeChannel({ channelName: "offline", isLive: false }),
      ]);
      expect(result).toEqual([{ channelName: "live", isLive: true }]);
    });
  });

  describe("applyStreamOnlineUpdate", () => {
    it("returns original channel when nothing changes", () => {
      const channel = makeChannel({
        isLive: true,
        viewerCount: 10,
        currentViewerCount: 10,
        currentTitle: "Title",
        currentGameName: "Game",
        currentStreamStartedAt: "2026-01-01T00:00:00.000Z",
        streamStartedAt: "2026-01-01T00:00:00.000Z",
      });
      expect(applyStreamOnlineUpdate(channel, { viewerCount: 10, title: "Title", gameName: "Game", startedAt: "2026-01-01T00:00:00.000Z" })).toBe(channel);
    });

    it("applies fallback values and marks channel live", () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date("2026-01-01T12:00:00.000Z"));
      const channel = makeChannel({ viewerCount: 5, currentViewerCount: undefined, currentTitle: "Old", currentGameName: "OldGame" });

      const updated = applyStreamOnlineUpdate(channel, {});

      expect(updated.isLive).toBe(true);
      expect(updated.viewerCount).toBe(5);
      expect(updated.currentViewerCount).toBe(0);
      expect(updated.currentTitle).toBe("Old");
      expect(updated.currentGameName).toBe("OldGame");
      expect(updated.streamStartedAt).toBe("2026-01-01T12:00:00.000Z");
      jest.useRealTimers();
    });
  });

  describe("applyStreamOfflineUpdate", () => {
    it("returns original channel when already offline and cleared", () => {
      const channel = makeChannel({ isLive: false, viewerCount: 0, currentViewerCount: 0, currentStreamStartedAt: undefined });
      expect(applyStreamOfflineUpdate(channel)).toBe(channel);
    });

    it("returns original channel when currentViewerCount is undefined and currentStreamStartedAt is null", () => {
      const channel = makeChannel({
        isLive: false,
        viewerCount: 0,
        currentViewerCount: undefined,
        currentStreamStartedAt: null as unknown as string | undefined,
      });

      expect(applyStreamOfflineUpdate(channel)).toBe(channel);
    });

    it("clears live fields when going offline", () => {
      const channel = makeChannel({ isLive: true, viewerCount: 5, streamStartedAt: "2026-01-01T00:00:00.000Z", currentViewerCount: 5, currentStreamStartedAt: "2026-01-01T00:00:00.000Z" });
      expect(applyStreamOfflineUpdate(channel)).toMatchObject({
        isLive: false,
        viewerCount: 0,
        streamStartedAt: null,
        currentViewerCount: 0,
        currentStreamStartedAt: undefined,
      });
    });

    it("returns updated object when offline but currentViewerCount is non-zero", () => {
      const channel = makeChannel({
        isLive: false,
        viewerCount: 0,
        currentViewerCount: 2,
        currentStreamStartedAt: undefined,
      });

      const updated = applyStreamOfflineUpdate(channel);
      expect(updated).not.toBe(channel);
      expect(updated.currentViewerCount).toBe(0);
    });
  });

  describe("applyChannelUpdate", () => {
    it("returns original channel when nothing changes", () => {
      const channel = makeChannel({ viewerCount: 5, currentViewerCount: 5, currentTitle: "Title", currentGameName: "Game", currentStreamStartedAt: "2026-01-01T00:00:00.000Z" });
      expect(applyChannelUpdate(channel, { viewerCount: 5, title: "Title", gameName: "Game", startedAt: "2026-01-01T00:00:00.000Z" })).toBe(channel);
    });

    it("updates fields using fallbacks", () => {
      const channel = makeChannel({ viewerCount: 5, currentViewerCount: 3, currentTitle: "Old", currentGameName: "OldGame", currentStreamStartedAt: "2026-01-01T00:00:00.000Z" });
      expect(applyChannelUpdate(channel, { viewerCount: 7 })).toMatchObject({
        viewerCount: 7,
        currentViewerCount: 7,
        currentTitle: "Old",
        currentGameName: "OldGame",
        currentStreamStartedAt: "2026-01-01T00:00:00.000Z",
      });
    });

    it("keeps existing currentViewerCount when viewerCount is undefined", () => {
      const channel = makeChannel({
        viewerCount: 5,
        currentViewerCount: 3,
        currentTitle: "Old",
        currentGameName: "OldGame",
        currentStreamStartedAt: "2026-01-01T00:00:00.000Z",
      });

      expect(applyChannelUpdate(channel, { title: "New" })).toMatchObject({
        viewerCount: 5,
        currentViewerCount: 3,
        currentTitle: "New",
        currentGameName: "OldGame",
        currentStreamStartedAt: "2026-01-01T00:00:00.000Z",
      });
    });

    it("falls back title, game and startedAt when empty strings are provided", () => {
      const channel = makeChannel({
        viewerCount: 5,
        currentViewerCount: 3,
        currentTitle: "Old",
        currentGameName: "OldGame",
        currentStreamStartedAt: "2026-01-01T00:00:00.000Z",
      });

      expect(
        applyChannelUpdate(channel, { title: "", gameName: "", startedAt: "" })
      ).toMatchObject({
        currentTitle: "Old",
        currentGameName: "OldGame",
        currentStreamStartedAt: "2026-01-01T00:00:00.000Z",
      });
    });
  });

  describe("applyStatsDelta", () => {
    it("adds message delta", () => {
      expect(applyStatsDelta(makeChannel({ messageCount: 2 }), 3).messageCount).toBe(5);
    });
  });
});
