import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FootprintDashboard } from "../FootprintDashboard";
import { LifetimeStatsResponse } from "@/lib/api/lifetime-stats";
import { resetDashboardLayout } from "@/lib/api/dashboard-layout";

// Mock dependencies
jest.mock("@/lib/api/dashboard-layout", () => ({
  saveDashboardLayout: jest.fn(),
  resetDashboardLayout: jest.fn(),
}));

// Mock react-grid-layout
jest.mock("react-grid-layout", () => {
  return {
    __esModule: true,
    default: ({ children, className, layout }: any) => (
      <div data-testid="grid-layout" className={className}>
        {children}
        <div data-testid="layout-data">{JSON.stringify(layout)}</div>
      </div>
    ),
    WidthProvider: (component: any) => component,
    Responsive: ({ children }: any) => <div>{children}</div>,
  };
});

// Mock child components to simplify testing
jest.mock("../cards/TotalWatchTimeCard", () => ({
  TotalWatchTimeCard: () => <div>WatchTimeCard</div>,
}));
jest.mock("../cards/TotalMessagesCard", () => ({
  TotalMessagesCard: () => <div>MessagesCard</div>,
}));
jest.mock("../cards/TrackingDaysCard", () => ({
  TrackingDaysCard: () => <div>TrackingDaysCard</div>,
}));
jest.mock("../cards/StreakCard", () => ({
  StreakCard: () => <div>StreakCard</div>,
}));
jest.mock("../cards/RadarChartCard", () => ({
  RadarChartCard: () => <div>RadarChartCard</div>,
}));
jest.mock("../cards/BadgesCard", () => ({
  BadgesCard: () => <div>BadgesCard</div>,
}));
jest.mock("../cards/MostActiveMonthCard", () => ({
  MostActiveMonthCard: () => <div>MostActiveMonthCard</div>,
}));
jest.mock("../cards/RankingCard", () => ({
  RankingCard: () => <div>RankingCard</div>,
}));
jest.mock("../cards/AvgSessionCard", () => ({
  AvgSessionCard: () => <div>AvgSessionCard</div>,
}));

const mockStats: LifetimeStatsResponse = {
  channelId: "c1",
  channelName: "Test Channel",
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
      chatMessages: 50,
      subscriptions: 0,
      cheers: 0,
      totalBits: 0,
    },
    loyalty: { trackingDays: 10, longestStreakDays: 2, currentStreakDays: 1 },
    activity: {
      activeDaysLast30: 5,
      activeDaysLast90: 5,
      mostActiveMonth: "2025-01",
      mostActiveMonthCount: 10,
    },
    rankings: { watchTimePercentile: 90, messagePercentile: 80 },
  },
  badges: [],
  radarScores: {
    watchTime: 0,
    interaction: 0,
    loyalty: 0,
    activity: 0,
    community: 0,
    contribution: 0,
  },
};

describe("FootprintDashboard", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Mock confirm
    window.confirm = jest.fn(() => true);
  });

  it("renders all cards", () => {
    render(<FootprintDashboard stats={mockStats} channelId="c1" />);

    expect(screen.getByText("WatchTimeCard")).toBeInTheDocument();
    expect(screen.getByText("MessagesCard")).toBeInTheDocument();
    expect(screen.getByText("TrackingDaysCard")).toBeInTheDocument();
    // ... check others
  });

  it("handles reset layout", async () => {
    render(<FootprintDashboard stats={mockStats} channelId="c1" />);

    const resetButton = screen.getByText("重置佈局");
    fireEvent.click(resetButton);

    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => {
      expect(resetDashboardLayout).toHaveBeenCalledWith("c1");
    });
  });

  it("uses initial layout if provided", () => {
    const initialLayout = [{ i: "total-watch-time", x: 10, y: 10, w: 1, h: 1 }];
    render(
      <FootprintDashboard
        stats={mockStats}
        channelId="c1"
        initialLayout={initialLayout}
      />
    );

    expect(screen.getByTestId("layout-data").textContent).toContain('"x":10');
  });
});
