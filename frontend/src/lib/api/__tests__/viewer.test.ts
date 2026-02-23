import {
  normalizeFollowedChannel,
  normalizeFollowedChannelsResponse,
} from "@/lib/api/viewer";

describe("viewer api normalization", () => {
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

  it("returns empty array when response is not array", () => {
    expect(normalizeFollowedChannelsResponse(null)).toEqual([]);
    expect(normalizeFollowedChannelsResponse({})).toEqual([]);
  });
});
