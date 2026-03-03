import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

const mockPush = jest.fn();
const mockPrefetch = jest.fn();
const mockRouter = { push: mockPush, prefetch: mockPrefetch };

const mockLogout = jest.fn();
const mockMutate = jest.fn();
const mockAuthUser = {
  displayName: "Test Streamer",
  avatarUrl: "",
  twitchUserId: "123",
  streamerId: "abc",
  channelUrl: "https://twitch.tv/test",
  role: "streamer" as const,
};

const mockUseTimeSeriesData = jest.fn();
const mockUseHeatmapData = jest.fn();
const mockUseSubscriptionTrendData = jest.fn();
const mockGameStatsChart = jest.fn(({ range }: { range: "7d" | "30d" | "90d" }) => (
  <div data-testid="game-stats-chart">{range}</div>
));

jest.mock("next/navigation", () => ({
  useRouter: () => mockRouter,
  usePathname: () => "/en/dashboard/streamer",
  useParams: () => ({ locale: "en" }),
}));

/* eslint-disable @next/next/no-img-element */
jest.mock("next/image", () => ({
  __esModule: true,
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => (
    <img {...props} alt={props.alt || ""} />
  ),
}));
/* eslint-enable @next/next/no-img-element */

jest.mock("@/lib/api/auth", () => ({
  isStreamer: (user: { role?: string }) => user?.role === "streamer",
}));

jest.mock("@/features/auth/AuthContext", () => ({
  useAuthSession: () => ({
    logout: mockLogout,
    loading: false,
    user: mockAuthUser,
  }),
}));

jest.mock("swr", () => ({
  useSWRConfig: () => ({ mutate: mockMutate }),
}));

jest.mock("@/features/streamer-dashboard/components/StreamSummaryCards", () => ({
  StreamSummaryCards: ({
    selectedRange,
    onRangeChange,
  }: {
    selectedRange?: string;
    onRangeChange?: (r: "7d" | "30d" | "90d") => void;
  }) => (
    <div data-testid="summary-cards-mock">
      <span data-testid="summary-selected-range">{selectedRange}</span>
      <button onClick={() => onRangeChange?.("7d")} type="button">
        set-7d
      </button>
      <button onClick={() => onRangeChange?.("30d")} type="button">
        set-30d
      </button>
      <button onClick={() => onRangeChange?.("90d")} type="button">
        set-90d
      </button>
    </div>
  ),
}));

jest.mock("@/features/streamer-dashboard/hooks/useChartData", () => ({
  useTimeSeriesData: (...args: unknown[]) => mockUseTimeSeriesData(...args),
  useHeatmapData: (...args: unknown[]) => mockUseHeatmapData(...args),
  useSubscriptionTrendData: (...args: unknown[]) => mockUseSubscriptionTrendData(...args),
}));

jest.mock("@/features/streamer-dashboard/charts", () => ({
  ChartLoading: () => <div>loading</div>,
  ChartError: () => <div>error</div>,
  ChartEmpty: () => <div>empty</div>,
  ChartDataLimitedBanner: () => <div>limited</div>,
}));

jest.mock("@/features/streamer-dashboard/charts/TimeSeriesChart", () => ({
  TimeSeriesChart: () => <div data-testid="timeseries-chart-component" />,
}));

jest.mock("@/features/streamer-dashboard/charts/HeatmapChart", () => ({
  HeatmapChart: () => <div data-testid="heatmap-chart-component" />,
}));

jest.mock("@/features/streamer-dashboard/charts/SubscriptionTrendChart", () => ({
  SubscriptionTrendChart: () => <div data-testid="subscription-chart-component" />,
}));

jest.mock("@/features/streamer-dashboard/charts/GameStatsChart", () => ({
  GameStatsChart: (props: { range: "7d" | "30d" | "90d" }) => mockGameStatsChart(props),
}));

jest.mock("@/features/streamer-dashboard/hooks/useUiPreferences", () => ({
  PREFERENCE_ITEMS: [
    { key: "showSummaryCards", icon: "📊" },
    { key: "showTimeSeriesChart", icon: "📈" },
    { key: "showHeatmapChart", icon: "🔥" },
    { key: "showSubscriptionChart", icon: "⭐" },
  ],
  useUiPreferences: () => ({
    preferences: {
      showSummaryCards: true,
      showTimeSeriesChart: true,
      showHeatmapChart: true,
      showSubscriptionChart: true,
    },
    togglePreference: jest.fn(),
    isLoaded: true,
    showAll: jest.fn(),
    resetToDefault: jest.fn(),
    visibleCount: 4,
  }),
}));

jest.mock("@/lib/logger", () => ({
  authLogger: { error: jest.fn(), warn: jest.fn() },
}));

import StreamerDashboard from "../page";

describe("StreamerDashboard - range controls", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockUseTimeSeriesData.mockReturnValue({
      data: [{ date: "2026-03-01", streamCount: 1, totalHours: 2, avgHours: 2 }],
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });
    mockUseHeatmapData.mockReturnValue({
      data: [{ dayOfWeek: 1, hour: 12, streamCount: 1 }],
      isLoading: false,
      error: null,
      refresh: jest.fn(),
      maxValue: 1,
    });
    mockUseSubscriptionTrendData.mockReturnValue({
      data: [{ date: "2026-03-01", totalSubs: 1, newSubs: 1, giftedSubs: 0, cancelledSubs: 0 }],
      isLoading: false,
      error: null,
      refresh: jest.fn(),
      currentDataDays: 30,
      minDataDays: 7,
      isEstimated: false,
    });

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 500,
    });
  });

  it("uses overview range for all charts and keeps granularity selector only", async () => {
    const { container } = render(<StreamerDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId("summary-cards-mock")).toBeInTheDocument();
    });

    expect(screen.getByTestId("chart-granularity-select")).toBeInTheDocument();
    expect(screen.queryByTestId("chart-range-select")).not.toBeInTheDocument();
    expect(container.querySelector("#subs-chart-range")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "set-7d" }));

    await waitFor(() => {
      expect(mockUseTimeSeriesData).toHaveBeenLastCalledWith("7d", "day", true);
      expect(mockUseHeatmapData).toHaveBeenLastCalledWith("7d", true);
      expect(mockUseSubscriptionTrendData).toHaveBeenLastCalledWith("7d", true);
      expect(mockGameStatsChart).toHaveBeenLastCalledWith({ range: "7d" });
    });
  });
});
