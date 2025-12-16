"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
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
const DEFAULT_LAYOUT: Layout[] = [
  { i: "total-watch-time", x: 0, y: 0, w: 3, h: 2, minW: 2, minH: 2 },
  { i: "total-messages", x: 3, y: 0, w: 3, h: 2, minW: 2, minH: 2 },
  { i: "tracking-days", x: 6, y: 0, w: 3, h: 2, minW: 2, minH: 2 },
  { i: "streak", x: 9, y: 0, w: 3, h: 2, minW: 2, minH: 2 },
  { i: "radar-chart", x: 0, y: 2, w: 6, h: 4, minW: 4, minH: 4 }, // 6x4
  { i: "badges", x: 6, y: 2, w: 6, h: 4, minW: 4, minH: 3 }, // 6x4
  { i: "most-active-month", x: 0, y: 6, w: 4, h: 2, minW: 2, minH: 2 },
  { i: "ranking", x: 4, y: 6, w: 4, h: 2, minW: 3, minH: 2 },
  { i: "avg-session", x: 8, y: 6, w: 4, h: 2, minW: 2, minH: 2 },
];

interface Props {
  stats: LifetimeStatsResponse;
  channelId: string;
  initialLayout?: DashboardLayout | null;
}

export const FootprintDashboard = ({
  stats,
  channelId,
  initialLayout,
}: Props) => {
  const [layout, setLayout] = useState<Layout[]>(
    (initialLayout as Layout[])?.length > 0
      ? (initialLayout as Layout[])
      : DEFAULT_LAYOUT
  );
  const [width, setWidth] = useState(1200);
  const [isDraggable, setIsDraggable] = useState(true);

  // Resize handler
  useEffect(() => {
    const handleResize = () => {
      const container = document.getElementById("dashboard-container");
      if (container) {
        setWidth(container.offsetWidth);
        // Mobile check: disable drag < 768px
        setIsDraggable(window.innerWidth >= 768);
      }
    };

    // Initial call
    handleResize();

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0) {
          setWidth(entry.contentRect.width);
          setIsDraggable(window.innerWidth >= 768);
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
  }, []);

  // Debounced save
  const saveLayout = useCallback(
    debounce(async (newLayout: Layout[]) => {
      try {
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

  const handleLayoutChange = (newLayout: Layout[]) => {
    setLayout(newLayout);
    saveLayout(newLayout);
  };

  const handleReset = async () => {
    if (confirm("確定要重置儀表板佈局嗎？")) {
      try {
        await resetDashboardLayout(channelId);
        setLayout(DEFAULT_LAYOUT);
      } catch (err) {
        console.error("Failed to reset layout", err);
      }
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center px-1">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <span className="bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
            你的 {stats.channelDisplayName || stats.channelName} 足跡
          </span>
        </h2>

        <button
          onClick={handleReset}
          className="text-xs text-slate-500 hover:text-white transition-colors px-3 py-1 rounded-full border border-slate-700 hover:bg-slate-800"
        >
          重置佈局
        </button>
      </div>

      <div id="dashboard-container" className="w-full relative min-h-[500px]">
        <GridLayout
          className="layout"
          layout={layout}
          cols={12}
          rowHeight={80}
          width={width}
          isDraggable={isDraggable}
          isResizable={isDraggable}
          onLayoutChange={handleLayoutChange}
          draggableHandle=".drag-handle"
          margin={[16, 16]}
          compactType="vertical"
        >
          <TotalWatchTimeCard
            key="total-watch-time"
            minutes={stats.lifetimeStats.watchTime.totalMinutes}
          />
          <TotalMessagesCard
            key="total-messages"
            count={stats.lifetimeStats.messages.totalMessages}
            chatCount={stats.lifetimeStats.messages.chatMessages}
          />
          <TrackingDaysCard
            key="tracking-days"
            days={stats.lifetimeStats.loyalty.trackingDays}
            startDate={stats.lifetimeStats.watchTime.firstWatchedAt}
          />
          <StreakCard
            key="streak"
            current={stats.lifetimeStats.loyalty.currentStreakDays}
            longest={stats.lifetimeStats.loyalty.longestStreakDays}
          />

          <RadarChartCard key="radar-chart" scores={stats.radarScores} />
          <BadgesCard key="badges" badges={stats.badges} />

          <MostActiveMonthCard
            key="most-active-month"
            month={stats.lifetimeStats.activity.mostActiveMonth}
            count={stats.lifetimeStats.activity.mostActiveMonthCount}
          />
          <RankingCard
            key="ranking"
            watchPercentile={stats.lifetimeStats.rankings.watchTimePercentile}
            msgPercentile={stats.lifetimeStats.rankings.messagePercentile}
          />
          <AvgSessionCard
            key="avg-session"
            minutes={stats.lifetimeStats.watchTime.avgSessionMinutes}
          />
        </GridLayout>
      </div>
    </div>
  );
};
