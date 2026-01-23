"use client";

import React, { useState, useEffect, useRef, ReactElement, cloneElement } from "react";

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
  useEffect(() => {
    let mounted = true;

    // Use ResizeObserver which is already optimized and batched
    // We rely solely on this to avoid "Forced Reflow" violations caused by manual DOM reads
    const resizeObserver = new ResizeObserver((entries) => {
      if (!mounted) return;

      const entry = entries[0];
      if (entry) {
        // Use contentRect for precise fractional values, or invoke Math.floor if needed
        const { width: w, height: h } = entry.contentRect;

        // Ensure dimensions are valid before updating
        if (w > 0 && h > 0) {
          // Wrap in RAF to avoid synchronous layout thrashing/reflow during observer callback
          requestAnimationFrame(() => {
            if (!mounted) return;
            setDimensions((prev) => {
              const newWidth = Math.floor(w);
              const newHeight = Math.floor(h);
              // Dedupe updates
              if (prev?.width === newWidth && prev?.height === newHeight) {
                return prev;
              }
              return { width: newWidth, height: newHeight };
            });
          });
        }
      }
    });

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      mounted = false;
      resizeObserver.disconnect();
    };
  }, []);

  // Clone the chart element and inject explicit dimensions
  const renderChart = () => {
    if (!children || !children.type) {
      console.warn("SafeResponsiveContainer: Invalid children provided", children);
      return null;
    }

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
