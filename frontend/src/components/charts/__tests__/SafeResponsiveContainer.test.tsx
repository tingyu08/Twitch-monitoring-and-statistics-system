import React from "react";
import { act, render, screen } from "@testing-library/react";
import { SafeResponsiveContainer } from "../SafeResponsiveContainer";

type ResizeObserverCallback = ConstructorParameters<typeof ResizeObserver>[0];

const mockDisconnect = jest.fn();
const chartRender = jest.fn(
  ({ width, height }: { width?: number; height?: number }) => (
    <div data-testid="chart-dimensions">{`${width ?? "unset"}x${height ?? "unset"}`}</div>
  )
);

let resizeObserverCallback: ResizeObserverCallback | null = null;

beforeEach(() => {
  jest.clearAllMocks();
  resizeObserverCallback = null;
  mockDisconnect.mockReset();
  global.requestAnimationFrame = jest.fn((callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });

  global.ResizeObserver = class ResizeObserver {
    constructor(callback: ResizeObserverCallback) {
      resizeObserverCallback = callback;
    }

    observe() {}

    unobserve() {}

    disconnect() {
      mockDisconnect();
    }
  };
});

describe("SafeResponsiveContainer", () => {
  it("shows a loading state until dimensions are measured", () => {
    render(
      <SafeResponsiveContainer height={240} className="chart-shell">
        <ChartStub />
      </SafeResponsiveContainer>
    );

    expect(screen.getByText("載入圖表中...")).toBeInTheDocument();
  });

  it("clones the child with floored dimensions and skips duplicate updates", () => {
    render(
      <SafeResponsiveContainer width="100%" height={240}>
        <ChartStub />
      </SafeResponsiveContainer>
    );

    act(() => {
      resizeObserverCallback?.([
        { contentRect: { width: 320.9, height: 180.2 } },
      ] as ResizeObserverEntry[], {} as ResizeObserver);
    });

    expect(screen.getByTestId("chart-dimensions")).toHaveTextContent("320x180");
    expect(chartRender).toHaveBeenCalledTimes(1);

    act(() => {
      resizeObserverCallback?.([
        { contentRect: { width: 320.9, height: 180.2 } },
      ] as ResizeObserverEntry[], {} as ResizeObserver);
    });

    expect(chartRender).toHaveBeenCalledTimes(1);
  });

  it("warns and renders nothing for invalid children", () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    render(<SafeResponsiveContainer>{null as never}</SafeResponsiveContainer>);

    expect(warnSpy).toHaveBeenCalledWith(
      "SafeResponsiveContainer: Invalid children provided",
      null
    );
    expect(screen.queryByText("載入圖表中...")).not.toBeInTheDocument();

    warnSpy.mockRestore();
  });

  it("ignores empty observer entries and zero-sized measurements", () => {
    render(
      <SafeResponsiveContainer>
        <ChartStub />
      </SafeResponsiveContainer>
    );

    act(() => {
      resizeObserverCallback?.([] as ResizeObserverEntry[], {} as ResizeObserver);
      resizeObserverCallback?.(
        [{ contentRect: { width: 0, height: 0 } }] as ResizeObserverEntry[],
        {} as ResizeObserver
      );
    });

    expect(screen.getByText("載入圖表中...")).toBeInTheDocument();
    expect(chartRender).not.toHaveBeenCalled();
  });

  it("disconnects the observer on unmount", () => {
    const { unmount } = render(
      <SafeResponsiveContainer>
        <ChartStub />
      </SafeResponsiveContainer>
    );

    unmount();

    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });

  it("ignores observer callbacks after unmount", () => {
    const { unmount } = render(
      <SafeResponsiveContainer>
        <ChartStub />
      </SafeResponsiveContainer>
    );

    unmount();

    act(() => {
      resizeObserverCallback?.(
        [{ contentRect: { width: 240, height: 120 } }] as ResizeObserverEntry[],
        {} as ResizeObserver
      );
    });

    expect(chartRender).not.toHaveBeenCalled();
  });
});

function ChartStub({ width, height }: { width?: number; height?: number }) {
  return chartRender({ width, height });
}
