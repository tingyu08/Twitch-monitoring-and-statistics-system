import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FootprintDashboard } from "../FootprintDashboard";
import { resetDashboardLayout, saveDashboardLayout } from "@/lib/api/dashboard-layout";
import type { LifetimeStatsResponse } from "@/lib/api/lifetime-stats";

const gridLayoutPropsRef: { current: any } = { current: null };
const mockSaveDashboardLayout = saveDashboardLayout as jest.MockedFunction<typeof saveDashboardLayout>;
const mockResetDashboardLayout = resetDashboardLayout as jest.MockedFunction<typeof resetDashboardLayout>;
const mockDebounceCancel = jest.fn();

jest.mock("lodash.debounce", () => {
  return (fn: (...args: any[]) => any) => {
    const debounced = (...args: any[]) => fn(...args);
    debounced.cancel = mockDebounceCancel;
    return debounced;
  };
});

jest.mock("@/lib/api/dashboard-layout", () => ({
  saveDashboardLayout: jest.fn(),
  resetDashboardLayout: jest.fn(),
}));

jest.mock("react-grid-layout", () => ({
  __esModule: true,
  default: (props: any) => {
    gridLayoutPropsRef.current = props;
    return (
      <div data-testid="grid-layout">
        <button onClick={() => props.onLayoutChange("invalid")}>invalid-layout</button>
        <button
          onClick={() =>
            props.onLayoutChange([
              { i: "total-watch-time", x: 1, y: 1, w: 3, h: 1 },
              { i: "bad", x: "oops" },
            ])
          }
        >
          change-layout
        </button>
        {props.children}
      </div>
    );
  },
}));

jest.mock("../cards/TotalWatchTimeCard", () => ({ TotalWatchTimeCard: () => <div>WatchTimeCard</div> }));
jest.mock("../cards/TotalMessagesCard", () => ({ TotalMessagesCard: () => <div>MessagesCard</div> }));
jest.mock("../cards/TrackingDaysCard", () => ({ TrackingDaysCard: () => <div>TrackingDaysCard</div> }));
jest.mock("../cards/StreakCard", () => ({ StreakCard: () => <div>StreakCard</div> }));
jest.mock("../cards/RadarChartCard", () => ({ RadarChartCard: () => <div>RadarChartCard</div> }));
jest.mock("../cards/BadgesCard", () => ({ BadgesCard: () => <div>BadgesCard</div> }));
jest.mock("../cards/MostActiveMonthCard", () => ({ MostActiveMonthCard: () => <div>MostActiveMonthCard</div> }));
jest.mock("../cards/RankingCard", () => ({ RankingCard: () => <div>RankingCard</div> }));
jest.mock("../cards/AvgSessionCard", () => ({ AvgSessionCard: () => <div>AvgSessionCard</div> }));

const mockStats: LifetimeStatsResponse = {
  channelId: "c1",
  channelName: "test-channel",
  channelDisplayName: "Test Channel",
  lifetimeStats: {
    watchTime: {
      totalMinutes: 100,
      totalHours: 1,
      avgSessionMinutes: 30,
      firstWatchedAt: null,
      lastWatchedAt: null,
    },
    messages: {
      totalMessages: 50,
      chatMessages: 40,
      subscriptions: 0,
      cheers: 0,
      totalBits: 0,
    },
    loyalty: { trackingDays: 10, longestStreakDays: 2, currentStreakDays: 1 },
    activity: {
      activeDaysLast30: 5,
      activeDaysLast90: 8,
      mostActiveMonth: "2025-01",
      mostActiveMonthCount: 10,
    },
    rankings: { watchTimePercentile: 90, messagePercentile: 80 },
  },
  badges: [],
  radarScores: {
    watchTime: 1,
    interaction: 2,
    loyalty: 3,
    activity: 4,
    community: 5,
    contribution: 6,
  },
};

describe("FootprintDashboard", () => {
  let resizeObserverCallback: ((entries: { contentRect: { width: number } }[]) => void) | null = null;

  beforeEach(() => {
    jest.clearAllMocks();
    gridLayoutPropsRef.current = null;
    mockSaveDashboardLayout.mockResolvedValue(undefined);
    mockResetDashboardLayout.mockResolvedValue(undefined);
    Object.defineProperty(window, "innerWidth", { value: 1024, configurable: true });
    window.confirm = jest.fn(() => true);

    global.ResizeObserver = class ResizeObserver {
      constructor(callback: any) {
        resizeObserverCallback = callback as any;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    };

    const originalGetElementById = document.getElementById.bind(document);
    jest.spyOn(document, "getElementById").mockImplementation((id: string) => {
      if (id === "dashboard-container") {
        return { offsetWidth: 640 } as HTMLElement;
      }
      return originalGetElementById(id);
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("renders cards and uses initial layout when provided", () => {
    render(
      <FootprintDashboard
        stats={mockStats}
        channelId="c1"
        initialLayout={[{ i: "total-watch-time", x: 9, y: 9, w: 2, h: 2 }]}
      />
    );

    expect(screen.getByText("WatchTimeCard")).toBeInTheDocument();
    expect(screen.getByText("MessagesCard")).toBeInTheDocument();
    expect(screen.getByText("footprint.yourFootprint")).toBeInTheDocument();
    expect(gridLayoutPropsRef.current.layout).toEqual([{ i: "total-watch-time", x: 9, y: 9, w: 2, h: 2 }]);
    expect(gridLayoutPropsRef.current.width).toBe(640);
    expect(gridLayoutPropsRef.current.isDraggable).toBe(true);
  });

  it("falls back to default layout and channel name when optional values are missing", () => {
    render(
      <FootprintDashboard
        stats={{ ...mockStats, channelDisplayName: "", channelName: "fallback-name" }}
        channelId="c1"
        initialLayout={[]}
      />
    );

    expect(screen.getByText("footprint.yourFootprint")).toBeInTheDocument();
    expect(gridLayoutPropsRef.current.layout).toEqual(
      expect.arrayContaining([{ i: "total-watch-time", x: 0, y: 0, w: 3, h: 1, minW: 2, minH: 1 }])
    );
  });

  it("updates viewport on resize observer and toggles drag behavior", () => {
    Object.defineProperty(window, "innerWidth", { value: 700, configurable: true });
    render(<FootprintDashboard stats={mockStats} channelId="c1" />);

    act(() => {
      resizeObserverCallback?.([{ contentRect: { width: 500 } }]);
    });

    expect(gridLayoutPropsRef.current.width).toBe(500);
    expect(gridLayoutPropsRef.current.isDraggable).toBe(false);
    expect(gridLayoutPropsRef.current.isResizable).toBe(false);

    act(() => {
      resizeObserverCallback?.([{ contentRect: { width: 500 } }]);
    });

    expect(gridLayoutPropsRef.current.width).toBe(500);
    expect(gridLayoutPropsRef.current.isDraggable).toBe(false);
  });

  it("ignores zero-width resize entries and missing container resize handling", () => {
    jest.spyOn(document, "getElementById").mockReturnValue(null);
    render(<FootprintDashboard stats={mockStats} channelId="c1" />);

    act(() => {
      resizeObserverCallback?.([{ contentRect: { width: 0 } }]);
      window.dispatchEvent(new Event("resize"));
    });

    expect(gridLayoutPropsRef.current.width).toBe(1200);
  });

  it("ignores invalid layouts and saves cleaned valid layouts", async () => {
    const user = userEvent.setup();
    render(<FootprintDashboard stats={mockStats} channelId="c1" />);

    await user.click(screen.getByRole("button", { name: "invalid-layout" }));
    expect(mockSaveDashboardLayout).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "change-layout" }));

    await waitFor(() => {
      expect(mockSaveDashboardLayout).toHaveBeenCalledWith("c1", [
        { i: "total-watch-time", x: 1, y: 1, w: 3, h: 1, minW: undefined, maxW: undefined, minH: undefined, maxH: undefined },
      ]);
    });
  });

  it("skips saving empty or unchanged layouts", async () => {
    const user = userEvent.setup();
    render(
      <FootprintDashboard
        stats={mockStats}
        channelId="c1"
        initialLayout={[{ i: "total-watch-time", x: 0, y: 0, w: 3, h: 1 }]}
      />
    );

    act(() => {
      gridLayoutPropsRef.current.onLayoutChange([{ i: "total-watch-time", x: 0, y: 0, w: 3, h: 1 }]);
    });
    expect(mockSaveDashboardLayout).not.toHaveBeenCalled();

    act(() => {
      gridLayoutPropsRef.current.onLayoutChange([null, "bad"]);
    });
    expect(mockSaveDashboardLayout).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "change-layout" }));
    expect(mockSaveDashboardLayout).toHaveBeenCalledTimes(1);
  });

  it("logs save failures", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    mockSaveDashboardLayout.mockRejectedValueOnce(new Error("save failed"));

    render(<FootprintDashboard stats={mockStats} channelId="c1" />);

    act(() => {
      gridLayoutPropsRef.current.onLayoutChange([{ i: "total-watch-time", x: 2, y: 2, w: 3, h: 1 }]);
    });

    await waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith("Failed to save layout", expect.any(Error));
    });
  });

  it("resets layout when confirmed and logs reset failures", async () => {
    const user = userEvent.setup();
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    render(<FootprintDashboard stats={mockStats} channelId="c1" />);

    await user.click(screen.getByRole("button", { name: "footprint.resetLayout" }));
    await waitFor(() => {
      expect(mockResetDashboardLayout).toHaveBeenCalledWith("c1");
    });

    (window.confirm as jest.Mock).mockReturnValueOnce(false);
    await user.click(screen.getByRole("button", { name: "footprint.resetLayout" }));
    expect(mockResetDashboardLayout).toHaveBeenCalledTimes(1);

    mockResetDashboardLayout.mockRejectedValueOnce(new Error("reset failed"));
    (window.confirm as jest.Mock).mockReturnValueOnce(true);
    await user.click(screen.getByRole("button", { name: "footprint.resetLayout" }));
    await waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith("Failed to reset layout", expect.any(Error));
    });
  });

  it("cancels pending debounced saves on unmount", () => {
    const { unmount } = render(<FootprintDashboard stats={mockStats} channelId="c1" />);

    unmount();

    expect(mockDebounceCancel).toHaveBeenCalled();
  });
});
