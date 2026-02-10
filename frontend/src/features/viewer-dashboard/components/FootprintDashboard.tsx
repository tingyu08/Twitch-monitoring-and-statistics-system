"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useTranslations } from "next-intl";
import GridLayout, { Layout } from "react-grid-layout";
import debounce from "lodash.debounce";
import { LifetimeStatsResponse } from "@/lib/api/lifetime-stats";
import {
  DashboardLayout,
  saveDashboardLayout,
  resetDashboardLayout,
} from "@/lib/api/dashboard-layout";

import { TotalWatchTimeCard } from "./cards/TotalWatchTimeCard";
import { TotalMessagesCard } from "./cards/TotalMessagesCard";
import { TrackingDaysCard } from "./cards/TrackingDaysCard";
import { StreakCard } from "./cards/StreakCard";
import { RadarChartCard } from "./cards/RadarChartCard";
import { BadgesCard } from "./cards/BadgesCard";
import { MostActiveMonthCard } from "./cards/MostActiveMonthCard";
import { RankingCard } from "./cards/RankingCard";
import { AvgSessionCard } from "./cards/AvgSessionCard";

import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

// Default Layout
// Define a local interface that matches what we need and what react-grid-layout expects
interface DashboardGridItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  maxW?: number;
  minH?: number;
  maxH?: number;
  static?: boolean;
  isDraggable?: boolean;
  isResizable?: boolean;
}

const DEFAULT_LAYOUT: DashboardGridItem[] = [
  { i: "total-watch-time", x: 0, y: 0, w: 3, h: 1, minW: 2, minH: 1 },
  { i: "total-messages", x: 3, y: 0, w: 3, h: 1, minW: 2, minH: 1 },
  { i: "tracking-days", x: 6, y: 0, w: 3, h: 1, minW: 2, minH: 1 },
  { i: "streak", x: 9, y: 0, w: 3, h: 1, minW: 2, minH: 1 },
  { i: "radar-chart", x: 0, y: 1, w: 6, h: 3, minW: 4, minH: 2 },
  { i: "badges", x: 6, y: 1, w: 6, h: 3, minW: 4, minH: 2 },
  { i: "most-active-month", x: 0, y: 4, w: 4, h: 1, minW: 2, minH: 1 },
  { i: "ranking", x: 4, y: 4, w: 4, h: 1, minW: 3, minH: 1 },
  { i: "avg-session", x: 8, y: 4, w: 4, h: 1, minW: 2, minH: 1 },
];

interface Props {
  stats: LifetimeStatsResponse;
  channelId: string;
  initialLayout?: DashboardLayout | null;
}

interface ViewportState {
  width: number;
  isDraggable: boolean;
}

function isSameLayout(
  prevLayout: DashboardGridItem[],
  nextLayout: DashboardGridItem[]
): boolean {
  if (prevLayout.length !== nextLayout.length) return false;

  for (let i = 0; i < prevLayout.length; i += 1) {
    const prev = prevLayout[i];
    const next = nextLayout[i];

    if (
      prev.i !== next.i ||
      prev.x !== next.x ||
      prev.y !== next.y ||
      prev.w !== next.w ||
      prev.h !== next.h ||
      prev.minW !== next.minW ||
      prev.maxW !== next.maxW ||
      prev.minH !== next.minH ||
      prev.maxH !== next.maxH
    ) {
      return false;
    }
  }

  return true;
}

function normalizeLayoutItems(items: unknown[]): DashboardGridItem[] {
  const normalized: DashboardGridItem[] = [];

  for (const item of items) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const candidate = item as Partial<DashboardGridItem>;
    if (
      typeof candidate.i !== "string" ||
      typeof candidate.x !== "number" ||
      typeof candidate.y !== "number" ||
      typeof candidate.w !== "number" ||
      typeof candidate.h !== "number"
    ) {
      continue;
    }

    normalized.push({
      i: candidate.i,
      x: candidate.x,
      y: candidate.y,
      w: candidate.w,
      h: candidate.h,
      minW: candidate.minW,
      maxW: candidate.maxW,
      minH: candidate.minH,
      maxH: candidate.maxH,
    });
  }

  return normalized;
}

export const FootprintDashboard = ({
  stats,
  channelId,
  initialLayout,
}: Props) => {
  const t = useTranslations();
  // Ensure initialLayout is compatible or fallback to default
  const [layout, setLayout] = useState<DashboardGridItem[]>(() => {
    if (
      initialLayout &&
      Array.isArray(initialLayout) &&
      initialLayout.length > 0
    ) {
      // Cast the initial layout to Layout[] after validation if needed,
      // or ensure DashboardLayout type is effectively Layout[]
      return initialLayout as unknown as DashboardGridItem[];
    }
    return DEFAULT_LAYOUT;
  });
  const [viewport, setViewport] = useState<ViewportState>({
    width: 1200,
    isDraggable: true,
  });

  const updateViewport = useCallback((nextWidth: number) => {
    const nextIsDraggable = window.innerWidth >= 768;
    setViewport((prev) => {
      if (prev.width === nextWidth && prev.isDraggable === nextIsDraggable) {
        return prev;
      }
      return {
        width: nextWidth,
        isDraggable: nextIsDraggable,
      };
    });
  }, []);

  // Resize handler
  useEffect(() => {
    const handleResize = () => {
      const container = document.getElementById("dashboard-container");
      if (container) {
        updateViewport(container.offsetWidth);
      }
    };

    // Initial call
    handleResize();

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0) {
          updateViewport(entry.contentRect.width);
        }
      }
    });

    const container = document.getElementById("dashboard-container");
    if (container) resizeObserver.observe(container);

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      resizeObserver.disconnect();
    };
  }, [updateViewport]);

  // Debounced save
  const saveLayout = useMemo(
    () =>
      debounce(async (newLayout: DashboardGridItem[]) => {
        try {
          // Clean layout data before saving to avoid circular references or extra junk
          const cleanLayout = newLayout.map(
            ({ i, x, y, w, h, minW, maxW, minH, maxH }) => ({
              i,
              x,
              y,
              w,
              h,
              minW,
              maxW,
              minH,
              maxH,
            })
          );
          await saveDashboardLayout(channelId, cleanLayout);
        } catch (err) {
          console.error("Failed to save layout", err);
        }
      }, 2000),
    [channelId]
  );

  // Cancel debounce on unmount
  useEffect(() => {
    return () => {
      saveLayout.cancel();
    };
  }, [saveLayout]);

  const handleLayoutChange = useCallback(
    (newLayout: unknown) => {
      if (!Array.isArray(newLayout)) {
        return;
      }

      const nextLayout = normalizeLayoutItems(newLayout);
      if (nextLayout.length === 0) {
        return;
      }

      setLayout((prev) => {
        if (isSameLayout(prev, nextLayout)) {
          return prev;
        }
        saveLayout(nextLayout);
        return nextLayout;
      });
    },
    [saveLayout]
  );

  const handleReset = async () => {
    if (confirm(t("footprint.confirmReset"))) {
      try {
        await resetDashboardLayout(channelId);
        setLayout(DEFAULT_LAYOUT);
      } catch (err) {
        console.error("Failed to reset layout", err);
      }
    }
  };

  // Cast GridLayout to any to bypass incorrect type definitions in this environment
  const GridLayoutAny = GridLayout as any;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3 px-1">
        <h2 className="text-lg sm:text-xl font-bold text-white flex items-center gap-2">
          <span className="bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
            {t("footprint.yourFootprint", {
              channel: stats.channelDisplayName || stats.channelName,
            })}
          </span>
        </h2>

        <button
          onClick={handleReset}
          className="text-xs text-slate-500 hover:text-white transition-colors px-3 py-1.5 rounded-full border border-slate-700 hover:bg-slate-800 self-start sm:self-auto"
        >
          {t("footprint.resetLayout")}
        </button>
      </div>

      <div id="dashboard-container" className="w-full relative min-h-[500px]">
        <GridLayoutAny
          className="layout"
          layout={layout}
          cols={12}
          rowHeight={100}
          width={viewport.width}
          isDraggable={viewport.isDraggable}
          isResizable={viewport.isDraggable}
          onLayoutChange={handleLayoutChange}
          draggableHandle=".drag-handle"
          margin={[16, 16]}
          compactType="vertical"
        >
          <div key="total-watch-time" className="h-full">
            <TotalWatchTimeCard
              minutes={stats.lifetimeStats.watchTime.totalMinutes}
            />
          </div>
          <div key="total-messages" className="h-full">
            <TotalMessagesCard
              count={stats.lifetimeStats.messages.totalMessages}
              chatCount={stats.lifetimeStats.messages.chatMessages}
            />
          </div>
          <div key="tracking-days" className="h-full">
            <TrackingDaysCard
              days={stats.lifetimeStats.loyalty.trackingDays}
              startDate={stats.lifetimeStats.watchTime.firstWatchedAt}
            />
          </div>
          <div key="streak" className="h-full">
            <StreakCard
              current={stats.lifetimeStats.loyalty.currentStreakDays}
              longest={stats.lifetimeStats.loyalty.longestStreakDays}
            />
          </div>

          <div key="radar-chart" className="h-full">
            <RadarChartCard scores={stats.radarScores} />
          </div>
          <div key="badges" className="h-full">
            <BadgesCard badges={stats.badges} />
          </div>

          <div key="most-active-month" className="h-full">
            <MostActiveMonthCard
              month={stats.lifetimeStats.activity.mostActiveMonth}
              count={stats.lifetimeStats.activity.mostActiveMonthCount}
            />
          </div>
          <div key="ranking" className="h-full">
            <RankingCard
              watchPercentile={stats.lifetimeStats.rankings.watchTimePercentile}
              msgPercentile={stats.lifetimeStats.rankings.messagePercentile}
            />
          </div>
          <div key="avg-session" className="h-full">
            <AvgSessionCard
              minutes={stats.lifetimeStats.watchTime.avgSessionMinutes}
            />
          </div>
        </GridLayoutAny>
      </div>
    </div>
  );
};
