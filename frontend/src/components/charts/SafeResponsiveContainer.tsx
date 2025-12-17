"use client";

import React, {
  useState,
  useEffect,
  useRef,
  ReactElement,
  cloneElement,
} from "react";

interface SafeChartContainerProps {
  children: ReactElement;
  width?: string | number;
  height?: string | number;
  className?: string;
}

/**
 * A container that measures its own dimensions and passes them
 * explicitly to the chart, avoiding ResponsiveContainer's
 * "width(-1) and height(-1)" warning.
 *
 * Uses requestAnimationFrame to batch DOM reads and avoid forced reflow.
 */
export function SafeResponsiveContainer({
  children,
  width = "100%",
  height = "100%",
  className,
}: SafeChartContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    let mounted = true;

    const measureDimensions = () => {
      if (!mounted || !containerRef.current) return;

      // Use requestAnimationFrame to batch DOM reads
      // This happens during the browser's paint phase, avoiding forced reflow
      rafRef.current = requestAnimationFrame(() => {
        if (!mounted || !containerRef.current) return;

        const { clientWidth, clientHeight } = containerRef.current;
        if (clientWidth > 0 && clientHeight > 0) {
          setDimensions((prev) => {
            // Only update if dimensions changed to avoid unnecessary re-renders
            if (prev?.width === clientWidth && prev?.height === clientHeight) {
              return prev;
            }
            return { width: clientWidth, height: clientHeight };
          });
        }
      });
    };

    // Use ResizeObserver which is already optimized and batched
    const resizeObserver = new ResizeObserver((entries) => {
      if (!mounted) return;

      // ResizeObserver provides dimensions directly, no need to read DOM
      const entry = entries[0];
      if (entry) {
        const { width: w, height: h } = entry.contentRect;
        if (w > 0 && h > 0) {
          setDimensions((prev) => {
            const newWidth = Math.floor(w);
            const newHeight = Math.floor(h);
            if (prev?.width === newWidth && prev?.height === newHeight) {
              return prev;
            }
            return { width: newWidth, height: newHeight };
          });
        }
      }
    });

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    // Initial measurement using RAF
    measureDimensions();

    return () => {
      mounted = false;
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
      resizeObserver.disconnect();
    };
  }, []);

  // Clone the chart element and inject explicit dimensions
  const renderChart = () => {
    if (!dimensions) {
      return (
        <div className="flex items-center justify-center h-full text-slate-500 text-sm animate-pulse">
          載入圖表中...
        </div>
      );
    }

    // Clone the chart with explicit width and height props
    return cloneElement(children, {
      width: dimensions.width,
      height: dimensions.height,
    });
  };

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        width,
        height,
        minHeight: typeof height === "number" ? height : undefined,
      }}
    >
      {renderChart()}
    </div>
  );
}
