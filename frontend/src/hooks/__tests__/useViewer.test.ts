import React, { type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";

import {
  viewerApi,
  type FollowedChannel,
  type GameStats,
  type ViewerChannelStats,
  type ViewerMessageStatsResponse,
  type ViewerTrendPoint,
} from "@/lib/api/viewer";
import {
  mergeFollowedChannels,
  useChannelDetail,
  useChannels,
  useChannelStats,
} from "../useViewer";

jest.mock("@/lib/api/viewer", () => ({
  viewerApi: {
    getFollowedChannels: jest.fn(),
    getChannelDetailAll: jest.fn(),
    getChannelStats: jest.fn(),
  },
}));

const mockedViewerApi = viewerApi as jest.Mocked<typeof viewerApi>;

function createQueryClient(retry: boolean | number = false): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry,
        retryDelay: 1,
      },
    },
  });
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

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
  it("returns fresh channels when previous cache is missing", () => {
    const fresh = [createChannel()];

    expect(mergeFollowedChannels(fresh)).toEqual(fresh);
    expect(mergeFollowedChannels(fresh, [])).toEqual(fresh);
  });

  it("keeps fresh channel untouched when it has no matching previous channel", () => {
    const fresh = [createChannel({ id: "channel-a", viewerCount: 88 })];
    const previous = [createChannel({ id: "channel-b", viewerCount: 140 })];

    const merged = mergeFollowedChannels(fresh, previous);

    expect(merged[0]).toEqual(fresh[0]);
  });

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

  it("uses max viewer count when both fresh and previous are live", () => {
    const previous = [createChannel({ viewerCount: 220, currentViewerCount: 200, isLive: true })];
    const fresh = [createChannel({ viewerCount: 180, currentViewerCount: 170, isLive: true })];

    const merged = mergeFollowedChannels(fresh, previous);

    expect(merged[0].viewerCount).toBe(220);
    expect(merged[0].currentViewerCount).toBe(220);
  });

  it("uses fresh viewer count when either side is offline", () => {
    const previous = [createChannel({ viewerCount: 220, isLive: true })];
    const fresh = [createChannel({ viewerCount: 80, isLive: false })];

    const merged = mergeFollowedChannels(fresh, previous);

    expect(merged[0].viewerCount).toBe(80);
    expect(merged[0].currentViewerCount).toBe(80);
  });

  it("falls back to previous title/game/start data when fresh fields are missing", () => {
    const previous = [
      createChannel({
        currentTitle: "Previous title",
        currentGameName: "Previous game",
        currentStreamStartedAt: "2026-02-24T09:00:00.000Z",
      }),
    ];
    const fresh = [
      createChannel({
        currentTitle: undefined,
        currentGameName: undefined,
        currentStreamStartedAt: undefined,
      }),
    ];

    const merged = mergeFollowedChannels(fresh, previous);

    expect(merged[0].currentTitle).toBe("Previous title");
    expect(merged[0].currentGameName).toBe("Previous game");
    expect(merged[0].currentStreamStartedAt).toBe("2026-02-24T09:00:00.000Z");
  });

  it("keeps zero-or-null viewer fields when merged viewer is zero", () => {
    const previous = [createChannel({ viewerCount: 0, currentViewerCount: 0, isLive: true })];
    const fresh = [
      createChannel({
        viewerCount: null,
        currentViewerCount: undefined,
        isLive: true,
      }),
    ];

    const merged = mergeFollowedChannels(fresh, previous);

    expect(merged[0].viewerCount).toBeNull();
    expect(merged[0].currentViewerCount).toBeUndefined();
  });

  it("uses fallback fields when numeric values are missing", () => {
    const previous = [
      createChannel({
        viewerCount: undefined,
        currentViewerCount: 92,
        totalWatchMinutes: undefined,
        messageCount: undefined,
        isLive: true,
      }),
    ];
    const fresh = [
      createChannel({
        viewerCount: undefined,
        currentViewerCount: 88,
        totalWatchMinutes: undefined,
        messageCount: undefined,
        isLive: true,
      }),
    ];

    const merged = mergeFollowedChannels(fresh, previous);

    expect(merged[0].viewerCount).toBe(92);
    expect(merged[0].currentViewerCount).toBe(92);
    expect(merged[0].totalWatchMinutes).toBe(0);
    expect(merged[0].messageCount).toBe(0);
  });

  it("defaults previous viewer count to zero when all previous viewer fields are missing", () => {
    const previous = [
      createChannel({
        viewerCount: undefined,
        currentViewerCount: undefined,
        isLive: true,
      }),
    ];
    const fresh = [
      createChannel({
        viewerCount: undefined,
        currentViewerCount: 11,
        isLive: true,
      }),
    ];

    const merged = mergeFollowedChannels(fresh, previous);

    expect(merged[0].viewerCount).toBe(11);
    expect(merged[0].currentViewerCount).toBe(11);
  });
});

describe("viewer hooks", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("useChannels merges current response with existing cache", async () => {
    const queryClient = createQueryClient();
    queryClient.setQueryData(
      ["viewer", "channels"],
      [createChannel({ viewerCount: 200 })],
      { updatedAt: Date.now() - 60_000 }
    );

    mockedViewerApi.getFollowedChannels.mockResolvedValue([createChannel({ viewerCount: 160 })]);

    const { result } = renderHook(() => useChannels(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data?.[0].viewerCount).toBe(200);
    expect(mockedViewerApi.getFollowedChannels).toHaveBeenCalledTimes(1);
  });

  it("useChannels exposes query error state", async () => {
    const queryClient = createQueryClient(false);
    mockedViewerApi.getFollowedChannels.mockRejectedValue(new Error("channels failed"));

    const { result } = renderHook(() => useChannels(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error?.message).toBe("channels failed");
  });

  it("useChannels retries and eventually succeeds", async () => {
    const queryClient = createQueryClient(1);
    mockedViewerApi.getFollowedChannels
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValueOnce([createChannel({ id: "channel-retry" })]);

    const { result } = renderHook(() => useChannels(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockedViewerApi.getFollowedChannels).toHaveBeenCalledTimes(2);
    expect(result.current.data?.[0].id).toBe("channel-retry");
  });

  it("useChannelDetail does not run query when channelId is empty", () => {
    const queryClient = createQueryClient();

    const { result } = renderHook(() => useChannelDetail(""), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current.fetchStatus).toBe("idle");
    expect(mockedViewerApi.getChannelDetailAll).not.toHaveBeenCalled();
  });

  it("useChannelDetail fetches detail data with provided days", async () => {
    const queryClient = createQueryClient();
    const payload: {
      channelStats: ViewerChannelStats | null;
      messageStats: ViewerMessageStatsResponse | null;
      gameStats: GameStats[] | null;
      viewerTrends: ViewerTrendPoint[] | null;
    } = {
      channelStats: null,
      messageStats: null,
      gameStats: null,
      viewerTrends: null,
    };

    mockedViewerApi.getChannelDetailAll.mockResolvedValue(payload);

    const { result } = renderHook(() => useChannelDetail("channel-1", 7), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockedViewerApi.getChannelDetailAll).toHaveBeenCalledWith("channel-1", 7);
    expect(result.current.data).toEqual(payload);
  });

  it("useChannelDetail exposes query error state", async () => {
    const queryClient = createQueryClient(false);
    mockedViewerApi.getChannelDetailAll.mockRejectedValue(new Error("detail failed"));

    const { result } = renderHook(() => useChannelDetail("channel-1"), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error?.message).toBe("detail failed");
  });

  it("useChannelStats does not run query when channelId is empty", () => {
    const queryClient = createQueryClient();

    const { result } = renderHook(() => useChannelStats(""), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current.fetchStatus).toBe("idle");
    expect(mockedViewerApi.getChannelStats).not.toHaveBeenCalled();
  });

  it("useChannelStats fetches stats with provided days", async () => {
    const queryClient = createQueryClient();
    const payload = {
      channel: {
        id: "channel-1",
        name: "demo_channel",
        displayName: "Demo Channel",
        avatarUrl: "",
        isLive: true,
        totalWatchHours: 10,
        totalMessages: 30,
        lastWatched: "2026-02-24T10:00:00.000Z",
      },
      dailyStats: [],
      summary: {
        totalWatchHours: 10,
        totalMessages: 30,
        totalEmotes: 0,
        sessionCount: 3,
        averageWatchMinutesPerDay: 60,
        firstWatchDate: "2026-02-22",
        lastWatchDate: "2026-02-24",
      },
    } satisfies ViewerChannelStats;

    mockedViewerApi.getChannelStats.mockResolvedValue(payload);

    const { result } = renderHook(() => useChannelStats("channel-1", 14), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockedViewerApi.getChannelStats).toHaveBeenCalledWith("channel-1", 14);
    expect(result.current.data).toEqual(payload);
  });

  it("useChannelStats exposes query error state", async () => {
    const queryClient = createQueryClient(false);
    mockedViewerApi.getChannelStats.mockRejectedValue(new Error("stats failed"));

    const { result } = renderHook(() => useChannelStats("channel-1"), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error?.message).toBe("stats failed");
  });
});
