import { render, waitFor } from "@testing-library/react";
import { TimeSeriesChart } from "../charts/TimeSeriesChart";
import type { TimeSeriesDataPoint } from "@/lib/api/streamer";

// Mock ResizeObserver for Recharts ResponsiveContainer
class ResizeObserverMock {
  callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }
  observe(target: Element) {
    // Trigger callback with mock dimensions
    this.callback(
      [
        {
          target,
          contentRect: { width: 800, height: 300 } as DOMRectReadOnly,
          borderBoxSize: [],
          contentBoxSize: [],
          devicePixelContentBoxSize: [],
        },
      ],
      this
    );
  }
  unobserve() {}
  disconnect() {}
}

global.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;

// Mock getBoundingClientRect for ResponsiveContainer
Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
  value: () => ({
    width: 800,
    height: 300,
    top: 0,
    left: 0,
    bottom: 300,
    right: 800,
    x: 0,
    y: 0,
    toJSON: () => {},
  }),
});

describe("TimeSeriesChart", () => {
  const mockData: TimeSeriesDataPoint[] = [
    { date: "2025-12-01", totalHours: 3.5, sessionCount: 1 },
    { date: "2025-12-02", totalHours: 5.0, sessionCount: 2 },
    { date: "2025-12-03", totalHours: 0, sessionCount: 0 },
    { date: "2025-12-04", totalHours: 4.2, sessionCount: 1 },
  ];

  it("should render without crashing", () => {
    const { container } = render(
      <TimeSeriesChart data={mockData} granularity="day" />
    );

    // Should render a wrapper div
    expect(container.querySelector(".w-full")).toBeInTheDocument();
  });

  it("should render with empty data", () => {
    const { container } = render(
      <TimeSeriesChart data={[]} granularity="day" />
    );

    // Should still render the container
    expect(container.querySelector(".w-full")).toBeInTheDocument();
  });

  it("should render with week granularity", () => {
    const { container } = render(
      <TimeSeriesChart data={mockData} granularity="week" />
    );

    expect(container.querySelector(".w-full")).toBeInTheDocument();
  });

  it("should render chart content", async () => {
    const { container } = render(
      <TimeSeriesChart data={mockData} granularity="day" />
    );

    await waitFor(() => {
      const chartWrapper = container.querySelector(".recharts-wrapper");
      expect(chartWrapper).toBeInTheDocument();
    });
  });

  it("should accept day granularity prop", () => {
    // Test that component renders with day granularity
    expect(() => {
      render(<TimeSeriesChart data={mockData} granularity="day" />);
    }).not.toThrow();
  });

  it("should accept week granularity prop", () => {
    // Test that component renders with week granularity
    expect(() => {
      render(<TimeSeriesChart data={mockData} granularity="week" />);
    }).not.toThrow();
  });

  it("should handle single data point", () => {
    const singlePoint: TimeSeriesDataPoint[] = [
      { date: "2025-12-01", totalHours: 3.5, sessionCount: 1 },
    ];

    expect(() => {
      render(<TimeSeriesChart data={singlePoint} granularity="day" />);
    }).not.toThrow();
  });

  it("should handle data with zero values", () => {
    const zeroData: TimeSeriesDataPoint[] = [
      { date: "2025-12-01", totalHours: 0, sessionCount: 0 },
      { date: "2025-12-02", totalHours: 0, sessionCount: 0 },
    ];

    expect(() => {
      render(<TimeSeriesChart data={zeroData} granularity="day" />);
    }).not.toThrow();
  });

  it("should render chart container and wrapper", async () => {
    const { container } = render(
      <TimeSeriesChart data={mockData} granularity="day" />
    );

    // Check that chart wrapper and chart content are rendered
    expect(container.querySelector(".w-full")).toBeInTheDocument();

    await waitFor(() => {
      const chartWrapper = container.querySelector(".recharts-wrapper");
      expect(chartWrapper).toBeInTheDocument();
    });
  });

  it("should handle tooltip and legend formatters", () => {
    const { container } = render(
      <TimeSeriesChart data={mockData} granularity="day" />
    );

    // Component should render without errors with formatters
    expect(container.querySelector(".w-full")).toBeInTheDocument();
  });
});
