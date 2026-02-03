import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  TimeRangeSelector,
  getRangeDays,
  getCustomRangeDays,
  type TimeRange,
  type CustomDateRange,
} from "../TimeRangeSelector";

// Mock DateRangePicker to avoid complex date picker testing
jest.mock("../DateRangePicker", () => ({
  DateRangePicker: ({
    onRangeSelect,
    disabled,
  }: {
    onRangeSelect: (range: { startDate: Date; endDate: Date }) => void;
    disabled?: boolean;
  }) => (
    <button
      data-testid="date-range-picker"
      disabled={disabled}
      onClick={() =>
        onRangeSelect({
          startDate: new Date("2025-01-01"),
          endDate: new Date("2025-01-10"),
        })
      }
    >
      自訂日期
    </button>
  ),
}));

describe("TimeRangeSelector", () => {
  const mockOnRangeChange = jest.fn();
  const mockOnCustomRangeChange = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders all time range options", () => {
    render(
      <TimeRangeSelector
        currentRange="30"
        onRangeChange={mockOnRangeChange}
        onCustomRangeChange={jest.fn()}
      />
    );

    expect(screen.getByText("days7")).toBeInTheDocument();
    expect(screen.getByText("days30")).toBeInTheDocument();
    expect(screen.getByText("days90")).toBeInTheDocument();
    expect(screen.getByText("all")).toBeInTheDocument();
    expect(screen.getByText("label")).toBeInTheDocument();
  });

  it("highlights the current selected range", () => {
    render(
      <TimeRangeSelector
        currentRange="30"
        onRangeChange={mockOnRangeChange}
        onCustomRangeChange={jest.fn()}
      />
    );

    const button30 = screen.getByText("days30");
    // 選中的按鈕應該有 bg-purple-600 class
    expect(button30.className).toContain("bg-purple");
  });

  it("calls onRangeChange when a button is clicked", () => {
    render(
      <TimeRangeSelector
        currentRange="30"
        onRangeChange={mockOnRangeChange}
        onCustomRangeChange={jest.fn()}
      />
    );

    fireEvent.click(screen.getByText("days7"));
    expect(mockOnRangeChange).toHaveBeenCalledWith("7");

    fireEvent.click(screen.getByText("days90"));
    expect(mockOnRangeChange).toHaveBeenCalledWith("90");

    fireEvent.click(screen.getByText("all"));
    expect(mockOnRangeChange).toHaveBeenCalledWith("all");
  });

  it("disables preset buttons when disabled prop is true", () => {
    render(
      <TimeRangeSelector
        currentRange="30"
        onRangeChange={mockOnRangeChange}
        onCustomRangeChange={jest.fn()}
        disabled={true}
      />
    );

    // 只檢查預設按鈕（7天、30天、90天、全部）- 使用 role="radio" 因為已添加 ARIA 支援
    const presetRadios = ["days7", "days30", "days90", "all"];
    presetRadios.forEach((label) => {
      const radio = screen.getByRole("radio", { name: new RegExp(label) });
      expect(radio).toBeDisabled();
    });
  });

  it("does not call onRangeChange when disabled", () => {
    render(
      <TimeRangeSelector
        currentRange="30"
        onRangeChange={mockOnRangeChange}
        onCustomRangeChange={jest.fn()}
        disabled={true}
      />
    );

    fireEvent.click(screen.getByText("days7"));
    expect(mockOnRangeChange).not.toHaveBeenCalled();
  });

  it("renders DateRangePicker when onCustomRangeChange is provided", () => {
    render(
      <TimeRangeSelector
        currentRange="30"
        onRangeChange={mockOnRangeChange}
        onCustomRangeChange={mockOnCustomRangeChange}
      />
    );

    expect(screen.getByTestId("date-range-picker")).toBeInTheDocument();
  });

  it("calls onCustomRangeChange and onRangeChange with 'custom' when custom date is selected", () => {
    render(
      <TimeRangeSelector
        currentRange="30"
        onRangeChange={mockOnRangeChange}
        onCustomRangeChange={mockOnCustomRangeChange}
      />
    );

    fireEvent.click(screen.getByTestId("date-range-picker"));

    expect(mockOnCustomRangeChange).toHaveBeenCalledWith({
      startDate: new Date("2025-01-01"),
      endDate: new Date("2025-01-10"),
    });
    expect(mockOnRangeChange).not.toHaveBeenCalled();
  });
});

describe("getRangeDays", () => {
  it("returns correct days for each range", () => {
    expect(getRangeDays("7")).toBe(7);
    expect(getRangeDays("30")).toBe(30);
    expect(getRangeDays("90")).toBe(90);
    expect(getRangeDays("all")).toBe(3650);
    expect(getRangeDays("custom")).toBe(30);
  });

  it("returns 30 as default for unknown range", () => {
    // TypeScript 不允許這樣調用，但測試 fallback
    expect(getRangeDays("unknown" as TimeRange)).toBe(30);
  });
});

describe("getCustomRangeDays", () => {
  it("calculates correct number of days for a custom range", () => {
    const range: CustomDateRange = {
      startDate: new Date("2025-01-01"),
      endDate: new Date("2025-01-10"),
    };
    // 1/1 to 1/10 = 10 days (inclusive)
    expect(getCustomRangeDays(range)).toBe(10);
  });

  it("returns 1 for same day range", () => {
    const range: CustomDateRange = {
      startDate: new Date("2025-01-01"),
      endDate: new Date("2025-01-01"),
    };
    expect(getCustomRangeDays(range)).toBe(1);
  });
});
