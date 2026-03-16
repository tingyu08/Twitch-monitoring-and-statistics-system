import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ViewerDashboardPage from "../page";

const mockPush = jest.fn();
const mockPrefetch = jest.fn();
const mockRefetchChannels = jest.fn();
const mockSetQueryData = jest.fn();
const mockSetListenChannels = jest.fn();
const mockJoinChannel = jest.fn();
const mockLeaveChannel = jest.fn();
const mockLogout = jest.fn();

const socketHandlers = new Map<string, (...args: any[]) => void>();

let mockAuthLoading = false;
let mockAuthUser: any = null;
let mockChannels: any[] = [];
let mockChannelsLoading = false;
let mockChannelsError: Error | null = null;
let mockSocketConnected = false;
let mockSocket: { on: jest.Mock; off: jest.Mock } | null = null;

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, prefetch: mockPrefetch }),
}));

jest.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, string | number>) => {
    if (values) {
      return `${key}:${JSON.stringify(values)}`;
    }
    return key;
  },
  useLocale: () => "en",
}));

jest.mock("@/features/auth/AuthContext", () => ({
  useAuthSession: () => ({ user: mockAuthUser, loading: mockAuthLoading, logout: mockLogout }),
}));

jest.mock("@/lib/api/auth", () => ({
  isViewer: (user: { role?: string }) => user?.role === "viewer",
}));

jest.mock("@/lib/api/viewer", () => ({
  viewerApi: {
    setListenChannels: (...args: unknown[]) => mockSetListenChannels(...args),
  },
}));

jest.mock("@/hooks/useViewer", () => ({
  useChannels: () => ({
    data: mockChannels,
    isLoading: mockChannelsLoading,
    error: mockChannelsError,
    refetch: mockRefetchChannels,
  }),
}));

jest.mock("@/lib/socket", () => ({
  useSocket: () => ({
    socket: mockSocket,
    connected: mockSocketConnected,
    joinChannel: mockJoinChannel,
    leaveChannel: mockLeaveChannel,
  }),
}));

jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ setQueryData: mockSetQueryData }),
}));

jest.mock("@/components", () => ({
  DashboardHeader: () => <div data-testid="dashboard-header-stub" />,
}));

jest.mock("next/image", () => ({
  __esModule: true,
  // eslint-disable-next-line @next/next/no-img-element
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => <img {...props} alt={props.alt || ""} />,
}));

describe("ViewerDashboardPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-03-12T12:00:00.000Z"));

    mockAuthLoading = false;
    mockAuthUser = {
      role: "viewer",
      displayName: "Viewer User",
      twitchUserId: "tv-1",
      viewerId: "viewer-1",
      avatarUrl: "https://example.com/viewer.png",
    };
    mockChannelsLoading = false;
    mockChannelsError = null;
    mockChannels = [];
    mockSocketConnected = false;
    socketHandlers.clear();
    mockSocket = {
      on: jest.fn((event, handler) => {
        socketHandlers.set(event, handler);
      }),
      off: jest.fn((event) => {
        socketHandlers.delete(event);
      }),
    };

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    Object.defineProperty(window, "sessionStorage", {
      value: { setItem: jest.fn() },
      configurable: true,
    });
    window.scrollTo = jest.fn();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it("shows a spinner while auth or channels are loading", () => {
    mockAuthLoading = true;
    const { rerender } = render(<ViewerDashboardPage />);

    expect(document.querySelector(".animate-spin")).toBeTruthy();

    mockAuthLoading = false;
    mockChannelsLoading = true;
    rerender(<ViewerDashboardPage />);

    expect(document.querySelector(".animate-spin")).toBeTruthy();
  });

  it("redirects and returns null when unauthenticated", async () => {
    mockAuthUser = null;
    render(<ViewerDashboardPage />);

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/");
    });
  });

  it("renders channels, sorting, search, pagination, and desktop actions", async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    mockChannels = buildChannels();

    render(<ViewerDashboardPage />);

    expect(screen.getByTestId("dashboard-header-stub")).toBeInTheDocument();
    expect(screen.getByText(/viewer.welcome/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "nav.settings" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "common.logout" })).toBeInTheDocument();

    expect(screen.getByRole("button", { name: /Live Alpha/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Live Beta/i })).toBeInTheDocument();
    expect(screen.getAllByText("viewer.watchNow").length).toBeGreaterThan(0);
    expect(screen.getAllByText("viewer.streamDuration").length).toBeGreaterThan(0);
    expect(screen.getAllByText("viewer.lastWatched").length).toBeGreaterThan(0);
    expect(screen.getByText("N/A")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "nav.settings" }));
    expect(mockPush).toHaveBeenCalledWith("/dashboard/viewer/settings");
    await user.click(screen.getByRole("button", { name: "common.logout" }));
    expect(mockLogout).toHaveBeenCalled();

    const liveAlphaCard = screen.getByRole("button", { name: /Live Alpha/i });
    fireEvent.keyDown(liveAlphaCard, { key: "Enter" });
    fireEvent.keyDown(liveAlphaCard, { key: " " });
    expect(mockPush).toHaveBeenCalledWith("/dashboard/viewer/live-a");

    const watchNowLinks = screen.getAllByRole("link", { name: "viewer.watchNow" });
    expect(watchNowLinks[1]).toHaveAttribute("href", "https://twitch.tv/livealpha");

    const search = screen.getByPlaceholderText("viewer.searchPlaceholder");
    await user.type(search, "zzzzz");
    expect(screen.getByText("viewer.noChannels")).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "pager");
    expect(screen.getByText(/viewer.pageInfo/)).toBeInTheDocument();
    expect(screen.getByText("...")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "2" }));
    expect(window.scrollTo).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /viewer.nextPage/ }));
    await user.click(screen.getByRole("button", { name: /viewer.prevPage/ }));
  });

  it("renders empty states for followed list and non-viewer fallback welcome", async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    mockAuthUser = { role: "streamer", displayName: "Streamer Person", twitchUserId: "st-1" };
    render(<ViewerDashboardPage />);

    expect(screen.getByText(/viewer.welcomeGuest/)).toBeInTheDocument();
    expect(screen.getByText("viewer.noFollowedChannels")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "viewer.exploreStreamers" })).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("viewer.searchPlaceholder"), "abc");
    expect(screen.getByText("viewer.noChannels")).toBeInTheDocument();
  });

  it("renders query errors and safely handles undefined channel data", async () => {
    mockChannels = undefined as unknown as any[];
    mockChannelsError = new Error("channels failed");

    render(<ViewerDashboardPage />);

    expect(screen.getByText("channels failed")).toBeInTheDocument();
    expect(screen.getByText("viewer.noFollowedChannels")).toBeInTheDocument();
  });

  it("handles socket updates, visibility refetch, listen notifications, and cleanup", async () => {
    mockChannels = buildChannels().slice(0, 3);
    mockSocketConnected = true;

    mockSetQueryData.mockImplementation((_key, updater) => {
      mockChannels = updater(mockChannels);
      return mockChannels;
    });

    const { rerender, unmount } = render(<ViewerDashboardPage />);

    await waitFor(() => {
      expect(mockRefetchChannels).toHaveBeenCalled();
    expect(mockSetListenChannels).toHaveBeenCalledWith([
      { channelName: "livealpha", isLive: true },
      { channelName: "livebeta", isLive: true },
    ]);
      expect(mockJoinChannel).toHaveBeenCalledWith("live-a");
      expect(mockJoinChannel).toHaveBeenCalledWith("live-b");
      expect(mockJoinChannel).toHaveBeenCalledWith("off-a");
    });

    act(() => {
      socketHandlers.get("stream.online")?.({
        channelId: "off-a",
        channelName: "offa",
        title: "Now Live",
        gameName: "Action",
        viewerCount: 55,
        startedAt: "2026-03-12T10:00:00.000Z",
      });
      jest.runOnlyPendingTimers();
    });
    expect(mockChannels.find((ch) => ch.id === "off-a")?.isLive).toBe(true);

    act(() => {
      socketHandlers.get("stream.offline")?.({ channelId: "live-a", channelName: "livealpha" });
      jest.runOnlyPendingTimers();
    });
    expect(mockChannels.find((ch) => ch.id === "live-a")?.isLive).toBe(false);

    act(() => {
      socketHandlers.get("channel.update")?.({ channelId: "live-b", viewerCount: 99, title: "Updated" });
      socketHandlers.get("stats-update")?.({ channelId: "live-b", messageCountDelta: 5 });
      socketHandlers.get("stats-update-batch")?.({ updates: [{ channelId: "live-b", messageCountDelta: 4 }] });
      socketHandlers.get("stats-update-batch")?.({ updates: [{ channelId: "live-b", messageCountDelta: 0 }] });
      jest.runOnlyPendingTimers();
    });
    expect(mockChannels.find((ch) => ch.id === "live-b")?.messageCount).toBe(29);

    document.dispatchEvent(new Event("visibilitychange"));
    expect(mockRefetchChannels).toHaveBeenCalledTimes(2);

    const nextChannels = mockChannels.filter((ch) => ch.id !== "off-a");
    mockChannels = nextChannels;
    rerender(<ViewerDashboardPage />);
    expect(mockLeaveChannel).toHaveBeenCalledWith("off-a");

    unmount();
    expect(mockLeaveChannel).toHaveBeenCalledWith("live-a");
    expect(mockLeaveChannel).toHaveBeenCalledWith("live-b");
  });

  it("covers no-op realtime and duplicate notification branches", async () => {
    mockChannels = buildChannels().slice(0, 2);
    mockSocketConnected = true;
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });

    mockSetQueryData.mockImplementation((_key, updater) => updater(undefined));

    const { rerender, unmount } = render(<ViewerDashboardPage />);

    act(() => {
      socketHandlers.get("stats-update")?.({ channelId: "live-a", messageCountDelta: 0 });
      socketHandlers.get("stats-update-batch")?.({});
      socketHandlers.get("channel.update")?.({ channelId: "missing", viewerCount: 1 });
      socketHandlers.get("stream.offline")?.({ channelId: "missing", channelName: "none" });
      socketHandlers.get("stream.offline")?.({ channelId: "off-a", channelName: "offa" });
      jest.runOnlyPendingTimers();
    });

    mockRefetchChannels.mockClear();
    document.dispatchEvent(new Event("visibilitychange"));
    expect(mockRefetchChannels).not.toHaveBeenCalled();

    mockChannels = [...mockChannels];
    rerender(<ViewerDashboardPage />);
    expect(mockSetListenChannels).toHaveBeenCalledTimes(1);

    act(() => {
      socketHandlers.get("stream.online")?.({ channelName: "livealpha" });
      unmount();
    });
  });

  it("updates channels by channelName and tolerates null channel collections", async () => {
    mockChannels = buildChannels().slice(0, 2);
    mockSocketConnected = true;
    mockSetQueryData.mockImplementation((_key, updater) => {
      mockChannels = updater(mockChannels);
      return mockChannels;
    });

    const { rerender } = render(<ViewerDashboardPage />);

    act(() => {
      socketHandlers.get("channel.update")?.({
        channelName: "livebeta",
        viewerCount: 77,
        title: "By name update",
      });
      socketHandlers.get("stream.online")?.({
        channelName: "livebeta",
        viewerCount: 88,
        startedAt: "2026-03-12T10:00:00.000Z",
      });
      jest.runOnlyPendingTimers();
    });

    expect(mockChannels.find((channel) => channel.id === "live-b")?.viewerCount).toBe(88);

    mockChannels = null as unknown as any[];
    rerender(<ViewerDashboardPage />);

    expect(screen.getByText("viewer.noFollowedChannels")).toBeInTheDocument();
  });

  it("matches offline updates by channel name and skips listen notifications for offline-only lists", async () => {
    mockChannels = buildChannels().map((channel) => ({ ...channel, isLive: false }));
    mockSocketConnected = true;
    mockSetQueryData.mockImplementation((_key, updater) => {
      mockChannels = updater(mockChannels);
      return mockChannels;
    });

    render(<ViewerDashboardPage />);

    expect(mockSetListenChannels).not.toHaveBeenCalled();

    act(() => {
      socketHandlers.get("stream.offline")?.({ channelName: "livealpha" });
      jest.runOnlyPendingTimers();
    });

    expect(mockChannels.find((channel) => channel.id === "live-a")?.isLive).toBe(false);
  });

  it("flushes matched realtime mutations into session cache and listen notifications", async () => {
    mockChannels = buildChannels().slice(0, 2);
    mockSocketConnected = true;
    mockSetQueryData.mockImplementation((_key, updater) => {
      mockChannels = updater(mockChannels);
      return mockChannels;
    });

    render(<ViewerDashboardPage />);

    await waitFor(() => {
      expect(mockSetListenChannels).toHaveBeenCalledWith([
        { channelName: "livealpha", isLive: true },
        { channelName: "livebeta", isLive: true },
      ]);
    });

    act(() => {
      socketHandlers.get("channel.update")?.({
        channelName: "livealpha",
        viewerCount: 123,
        title: "Changed title",
      });
      jest.runAllTimers();
    });

    expect(mockChannels.find((channel) => channel.id === "live-a")?.viewerCount).toBe(123);
    expect(window.sessionStorage.setItem).toHaveBeenCalled();
  });
});

function buildChannels() {
  const base = [
    makeChannel({
      id: "live-a",
      channelName: "livealpha",
      displayName: "Live Alpha",
      isLive: true,
      category: "RPG",
      viewerCount: 1200,
      streamStartedAt: "2026-03-12T09:30:00.000Z",
      followedAt: "2026-03-01T00:00:00.000Z",
      totalWatchMinutes: 600,
      messageCount: 10,
      lastWatched: null,
    }),
    makeChannel({
      id: "live-b",
      channelName: "livebeta",
      displayName: "Live Beta",
      isLive: true,
      category: "RPG",
      viewerCount: null,
      streamStartedAt: "2026-03-12T08:30:00.000Z",
      followedAt: "2026-03-02T00:00:00.000Z",
      totalWatchMinutes: 300,
      messageCount: 20,
      lastWatched: "2026-03-11T00:00:00.000Z",
    }),
    makeChannel({
      id: "off-a",
      channelName: "offa",
      displayName: "Offline A",
      isLive: false,
      category: "Just Chatting",
      viewerCount: 0,
      streamStartedAt: null,
      followedAt: "2026-03-03T00:00:00.000Z",
      totalWatchMinutes: 60,
      messageCount: 3,
      lastWatched: "2026-03-10T00:00:00.000Z",
    }),
  ];

  const paged = Array.from({ length: 160 }, (_, index) =>
    makeChannel({
      id: `pager-${index}`,
      channelName: `pager${index}`,
      displayName: `Pager ${index}`,
      isLive: false,
      category: "Just Chatting",
      viewerCount: 0,
      streamStartedAt: null,
      followedAt: `2026-02-${String((index % 9) + 1).padStart(2, "0")}T00:00:00.000Z`,
      totalWatchMinutes: index,
      messageCount: index,
      lastWatched: `2026-03-${String((index % 9) + 1).padStart(2, "0")}T00:00:00.000Z`,
    })
  );

  return [...base, ...paged];
}

function makeChannel(overrides: Partial<any>) {
  return {
    id: "channel-1",
    channelName: "channel1",
    displayName: "Channel 1",
    avatarUrl: "",
    category: "Just Chatting",
    isLive: false,
    viewerCount: 0,
    streamStartedAt: null,
    followedAt: null,
    tags: [],
    lastWatched: null,
    totalWatchMinutes: 0,
    messageCount: 0,
    ...overrides,
  };
}
