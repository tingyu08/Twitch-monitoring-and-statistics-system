import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import StreamerDashboard from "../page";

const mockPush = jest.fn();
const mockPrefetch = jest.fn();
const mockLogout = jest.fn();
const mockMutate = jest.fn();
const mockWarn = jest.fn();
const mockTogglePreference = jest.fn();

let mockAuthLoading = false;
let mockAuthUser: any = null;
let mockUiPreferences: any;
let mockTimeSeries: any;
let mockHeatmap: any;
let mockSubscriptionTrend: any;
let quickActionsOnManageSettings: (() => void) | null = null;
let streamSettingsEditorProps: { isOpen: boolean; onClose: () => void } | null = null;

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, prefetch: mockPrefetch }),
}));

jest.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));

jest.mock("next/image", () => ({
  __esModule: true,
  // eslint-disable-next-line @next/next/no-img-element
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => <img {...props} alt={props.alt || ""} />,
}));

jest.mock("@/lib/api/auth", () => ({
  isStreamer: (user: { role?: string }) => user?.role === "streamer",
}));

jest.mock("@/features/auth/AuthContext", () => ({
  useAuthSession: () => ({ logout: mockLogout, loading: mockAuthLoading, user: mockAuthUser }),
}));

jest.mock("swr", () => ({
  useSWRConfig: () => ({ mutate: mockMutate }),
}));

jest.mock("@/features/streamer-dashboard/hooks/useUiPreferences", () => ({
  useUiPreferences: () => mockUiPreferences,
}));

jest.mock("@/features/streamer-dashboard/hooks/useChartData", () => ({
  useTimeSeriesData: () => mockTimeSeries,
  useHeatmapData: () => mockHeatmap,
  useSubscriptionTrendData: () => mockSubscriptionTrend,
}));

jest.mock("@/lib/logger", () => ({
  authLogger: { warn: (...args: unknown[]) => mockWarn(...args) },
}));

jest.mock("@/components", () => ({
  DashboardHeader: () => <div data-testid="streamer-header-stub" />,
}));

jest.mock("@/features/streamer-dashboard/components/StreamSummaryCards", () => ({
  StreamSummaryCards: ({ selectedRange, onRangeChange, initialSummary }: any) => (
    <div data-testid="summary-cards">
      <span>{selectedRange}</span>
      <span>{initialSummary?.streamCount ?? "no-summary"}</span>
      <button type="button" onClick={() => onRangeChange("7d")}>range-7d</button>
    </div>
  ),
}));

jest.mock("@/features/streamer-dashboard/components/DisplayPreferences", () => ({
  DisplayPreferences: (props: any) => (
    <button type="button" onClick={() => props.onToggle("showSummaryCards")}>toggle-pref</button>
  ),
}));

jest.mock("@/features/streamer-dashboard/components/QuickActionsPanel", () => ({
  QuickActionsPanel: ({ onManageSettings }: any) => {
    quickActionsOnManageSettings = onManageSettings;
    return <button type="button" onClick={onManageSettings}>manage-settings</button>;
  },
}));

jest.mock("@/features/streamer-dashboard/components/StreamSettingsEditor", () => ({
  StreamSettingsEditor: (props: any) => {
    streamSettingsEditorProps = props;
    return props.isOpen ? <button type="button" onClick={props.onClose}>close-settings</button> : <div data-testid="settings-closed" />;
  },
}));

jest.mock("@/features/streamer-dashboard/charts", () => ({
  ChartLoading: ({ message }: any) => <div>{message}</div>,
  ChartError: ({ error, onRetry }: any) => <button type="button" onClick={onRetry}>{error}</button>,
  ChartEmpty: ({ title }: any) => <div>{title}</div>,
  ChartDataLimitedBanner: ({ currentDays, minDays }: any) => <div>{`limited:${currentDays}/${minDays}`}</div>,
}));

jest.mock("@/features/streamer-dashboard/charts/TimeSeriesChart", () => ({
  TimeSeriesChart: ({ granularity }: any) => <div>{`timeseries:${granularity}`}</div>,
}));
jest.mock("@/features/streamer-dashboard/charts/HeatmapChart", () => ({
  HeatmapChart: ({ range }: any) => <div>{`heatmap:${range}`}</div>,
}));
jest.mock("@/features/streamer-dashboard/charts/SubscriptionTrendChart", () => ({
  SubscriptionTrendChart: ({ range }: any) => <div>{`subs:${range}`}</div>,
}));
jest.mock("@/features/streamer-dashboard/charts/GameStatsChart", () => ({
  GameStatsChart: ({ range }: any) => <div>{`games:${range}`}</div>,
}));

describe("StreamerDashboardPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockAuthLoading = false;
    mockAuthUser = {
      role: "streamer",
      displayName: "Test Streamer",
      avatarUrl: "https://example.com/streamer.png",
      twitchUserId: "123",
      streamerId: "abc",
      channelUrl: "https://twitch.tv/test",
    };
    mockUiPreferences = {
      preferences: {
        showSummaryCards: true,
        showTimeSeriesChart: true,
        showHeatmapChart: true,
        showSubscriptionChart: true,
      },
      togglePreference: mockTogglePreference,
      showAll: jest.fn(),
      resetToDefault: jest.fn(),
      isLoaded: true,
      visibleCount: 4,
    };
    mockTimeSeries = { data: [{ x: 1 }], isLoading: false, error: null, refresh: jest.fn() };
    mockHeatmap = { data: [{ x: 1 }], isLoading: false, error: null, refresh: jest.fn(), maxValue: 1 };
    mockSubscriptionTrend = {
      data: [{ x: 1 }],
      isLoading: false,
      error: null,
      refresh: jest.fn(),
      currentDataDays: 30,
      minDataDays: 7,
      isEstimated: false,
    };
    quickActionsOnManageSettings = null;
    streamSettingsEditorProps = null;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        summary: { streamCount: 5 },
        timeSeries: { data: [{ x: 1 }] },
        heatmap: [{ dayOfWeek: 1, hour: 1, streamCount: 1 }],
        subscriptionTrend: [{ date: "2026-03-01", totalSubs: 1 }],
      }),
    }) as jest.Mock;
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it("renders auth loading spinner", () => {
    mockAuthLoading = true;
    render(<StreamerDashboard />);
    expect(document.querySelector(".animate-spin")).toBeTruthy();
  });

  it("redirects missing users and role-mismatch users", () => {
    const { rerender } = render(<StreamerDashboard />);

    mockAuthUser = null;
    rerender(<StreamerDashboard />);
    act(() => {
      jest.runAllTimers();
    });
    expect(screen.getByText("無法載入資料")).toBeInTheDocument();
    expect(mockPush).toHaveBeenCalledWith("/");

    mockAuthUser = { role: "viewer", viewerId: "viewer-1", displayName: "Viewer" };
    rerender(<StreamerDashboard />);
    act(() => {
      jest.runAllTimers();
    });
    expect(screen.getByText("目前登入的角色不是實況主")).toBeInTheDocument();
    expect(mockWarn).toHaveBeenCalled();
  });

  it("shows spinner when UI preferences are not loaded", async () => {
    mockUiPreferences.isLoaded = false;
    render(<StreamerDashboard />);
    await waitFor(() => {
      expect(document.querySelector(".animate-spin")).toBeTruthy();
    });
  });

  it("renders the happy path, handles bootstrap success, granularity changes, logout, and settings dialog", async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<StreamerDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId("streamer-header-stub")).toBeInTheDocument();
    });

    expect(mockMutate).toHaveBeenCalledWith("/api/streamer/time-series/30d/day", [{ x: 1 }], false);
    expect(screen.getByTestId("summary-cards")).toBeInTheDocument();
    expect(screen.getByText("timeseries:day")).toBeInTheDocument();
    expect(screen.getByText("heatmap:30d")).toBeInTheDocument();
    expect(screen.getByText("subs:30d")).toBeInTheDocument();
    expect(screen.getByText("games:30d")).toBeInTheDocument();
    expect(screen.getByText("accountInfo")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "https://twitch.tv/test" })).toHaveAttribute(
      "href",
      "https://twitch.tv/test"
    );

    fireEvent.change(screen.getByTestId("chart-granularity-select"), { target: { value: "week" } });
    await user.click(screen.getByRole("button", { name: "range-7d" }));
    expect(screen.getByText("games:7d")).toBeInTheDocument();

    await user.click(screen.getByTestId("logout-button"));
    expect(mockLogout).toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "manage-settings" }));
    expect(streamSettingsEditorProps?.isOpen).toBe(true);
    await user.click(screen.getByRole("button", { name: "close-settings" }));
    expect(streamSettingsEditorProps?.isOpen).toBe(false);
  });

  it("covers bootstrap failure and chart state branches", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 500 });
    mockTimeSeries = { data: [], isLoading: true, error: null, refresh: jest.fn() };
    mockHeatmap = { data: [], isLoading: false, error: "heatmap-error", refresh: jest.fn(), maxValue: 0 };
    mockSubscriptionTrend = {
      data: [],
      isLoading: false,
      error: null,
      refresh: jest.fn(),
      currentDataDays: 3,
      minDataDays: 7,
      isEstimated: true,
    };

    const { rerender } = render(<StreamerDashboard />);

    await waitFor(() => {
      expect(mockWarn).toHaveBeenCalled();
      expect(mockMutate).toHaveBeenCalledWith("/api/streamer/time-series/30d/day");
    });
    expect(screen.getAllByText("loadingCharts").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "heatmap-error" })).toBeInTheDocument();
    expect(screen.getByText("limited:3/7")).toBeInTheDocument();
    expect(screen.getByText("noSubData")).toBeInTheDocument();

    mockTimeSeries = { data: [], isLoading: false, error: "time-error", refresh: jest.fn() };
    mockHeatmap = { data: [], isLoading: false, error: null, refresh: jest.fn(), maxValue: 0 };
    mockSubscriptionTrend = {
      data: [{ x: 1 }],
      isLoading: false,
      error: "sub-error",
      refresh: jest.fn(),
      currentDataDays: 10,
      minDataDays: 7,
      isEstimated: false,
    };
    rerender(<StreamerDashboard />);

    expect(screen.getByRole("button", { name: "time-error" })).toBeInTheDocument();
    expect(screen.getByText("noTimeData")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "sub-error" })).toBeInTheDocument();
  });

  it("shows allHidden when no sections are visible and no avatar fallback name is used", async () => {
    mockAuthUser = {
      role: "streamer",
      displayName: "",
      avatarUrl: "",
      twitchUserId: "123",
      streamerId: "abc",
      channelUrl: "https://twitch.tv/test",
    };
    mockUiPreferences.preferences = {
      showSummaryCards: false,
      showTimeSeriesChart: false,
      showHeatmapChart: false,
      showSubscriptionChart: false,
    };
    mockUiPreferences.visibleCount = 0;

    render(<StreamerDashboard />);
    await waitFor(() => {
      expect(screen.getByText("allHidden")).toBeInTheDocument();
    });
    expect(screen.getByText("welcome:{\"name\":\"Streamer\"}")).toBeInTheDocument();
  });

  it("covers preference fallback, bootstrap null summary, and remaining chart states", async () => {
    mockUiPreferences.preferences = undefined;
    mockUiPreferences.visibleCount = undefined;
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        summary: null,
        timeSeries: { data: [] },
        heatmap: [{ dayOfWeek: 1, hour: 1, streamCount: 1 }],
        subscriptionTrend: [{ date: "2026-03-01", totalSubs: 1 }],
      }),
    });
    mockTimeSeries = { data: [], isLoading: false, error: null, refresh: jest.fn() };
    mockHeatmap = { data: [], isLoading: true, error: null, refresh: jest.fn(), maxValue: 0 };
    mockSubscriptionTrend = {
      data: [],
      isLoading: true,
      error: null,
      refresh: jest.fn(),
      currentDataDays: 0,
      minDataDays: 7,
      isEstimated: false,
    };

    render(<StreamerDashboard />);

    await waitFor(() => {
      expect(screen.getByText("no-summary")).toBeInTheDocument();
    });

    expect(screen.getByText("noStreamData")).toBeInTheDocument();
    expect(screen.getAllByText("loadingCharts").length).toBeGreaterThan(1);
  });

  it("counts visible sections from preference values when visibleCount is unavailable", async () => {
    mockUiPreferences.preferences = {
      showSummaryCards: true,
      showTimeSeriesChart: true,
      showHeatmapChart: false,
      showSubscriptionChart: false,
    };
    mockUiPreferences.visibleCount = undefined;

    render(<StreamerDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId("summary-section")).toBeInTheDocument();
      expect(screen.getByTestId("timeseries-section")).toBeInTheDocument();
    });

    expect(screen.queryByText("allHidden")).not.toBeInTheDocument();
  });

  it("stops bootstrap state updates after unmount", async () => {
    let resolveBootstrap: ((value: unknown) => void) | undefined;
    (global.fetch as jest.Mock).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveBootstrap = resolve;
        })
    );

    const { unmount } = render(<StreamerDashboard />);
    unmount();

    await act(async () => {
      resolveBootstrap?.({
        ok: true,
        json: async () => ({
          summary: { streamCount: 1 },
          timeSeries: { data: [{ x: 1 }] },
          heatmap: [{ dayOfWeek: 1, hour: 1, streamCount: 1 }],
          subscriptionTrend: [{ date: "2026-03-01", totalSubs: 1 }],
        }),
      });
      await Promise.resolve();
    });

    expect(mockMutate).not.toHaveBeenCalledWith(
      "/api/streamer/time-series/30d/day",
      expect.anything(),
      false
    );
  });

  it("skips bootstrap failure recovery when the component is already unmounted", async () => {
    let rejectBootstrap: ((reason?: unknown) => void) | undefined;
    (global.fetch as jest.Mock).mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectBootstrap = reject;
        })
    );

    const { unmount } = render(<StreamerDashboard />);
    unmount();

    await act(async () => {
      rejectBootstrap?.(new Error("bootstrap failed after unmount"));
      await Promise.resolve();
    });

    expect(mockWarn).toHaveBeenCalled();
    expect(mockMutate).not.toHaveBeenCalledWith("/api/streamer/time-series/30d/day");
  });

  it("logs null userId when role mismatch user lacks viewerId", async () => {
    mockAuthUser = { role: "viewer", displayName: "Viewer Without Id" };

    render(<StreamerDashboard />);

    act(() => {
      jest.runAllTimers();
    });

    await waitFor(() => {
      expect(mockWarn).toHaveBeenCalledWith("Dashboard role mismatch", { userId: null });
    });
  });
});
