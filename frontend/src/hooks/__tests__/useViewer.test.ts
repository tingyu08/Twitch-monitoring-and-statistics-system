import type { FollowedChannel } from "@/lib/api/viewer";
import { mergeFollowedChannels } from "../useViewer";

function createChannel(overrides: Partial<FollowedChannel> = {}): FollowedChannel {
  return {
    id: "channel-1",
    channelName: "demo_channel",
    displayName: "Demo Channel",
    avatarUrl: "",
    category: "Just Chatting",
    isLive: true,
    viewerCount: 120,
    streamStartedAt: "2026-02-24T10:00:00.000Z",
    followedAt: "2026-01-01T00:00:00.000Z",
    tags: [],
    lastWatched: "2026-02-24T10:10:00.000Z",
    totalWatchMinutes: 90,
    messageCount: 25,
    ...overrides,
  };
}

describe("mergeFollowedChannels", () => {
  it("keeps monotonic totals when fresh payload is older", () => {
    const previous = [
      createChannel({
        totalWatchMinutes: 120,
        messageCount: 40,
      }),
    ];

    const fresh = [
      createChannel({
        totalWatchMinutes: 100,
        messageCount: 35,
      }),
    ];

    const merged = mergeFollowedChannels(fresh, previous);

    expect(merged[0].totalWatchMinutes).toBe(120);
    expect(merged[0].messageCount).toBe(40);
  });

  it("uses fresh totals when fresh payload is newer", () => {
    const previous = [
      createChannel({
        totalWatchMinutes: 100,
        messageCount: 20,
      }),
    ];

    const fresh = [
      createChannel({
        totalWatchMinutes: 130,
        messageCount: 28,
      }),
    ];

    const merged = mergeFollowedChannels(fresh, previous);

    expect(merged[0].totalWatchMinutes).toBe(130);
    expect(merged[0].messageCount).toBe(28);
  });
});
