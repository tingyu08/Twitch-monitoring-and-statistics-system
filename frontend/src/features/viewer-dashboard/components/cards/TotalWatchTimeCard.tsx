import React from "react";
import { DashboardCardWrapper } from "../DashboardCardWrapper";

interface Props {
  minutes: number;
  className?: string;
  style?: React.CSSProperties;
}

export const TotalWatchTimeCard = React.forwardRef<
  HTMLDivElement,
  Props & React.HTMLAttributes<HTMLDivElement>
>(({ minutes, ...props }, ref) => (
  <DashboardCardWrapper ref={ref} title="總觀看時數" {...props}>
    <div className="flex flex-col justify-end h-full">
      <div className="flex items-baseline gap-1">
        <span className="text-3xl lg:text-4xl font-bold text-blue-400 tracking-tight">
          {(minutes / 60).toFixed(1)}
        </span>
        <span className="text-sm text-slate-400">小時</span>
      </div>
      <div className="text-xs text-slate-500 mt-1">
        累積觀看 {minutes.toLocaleString()} 分鐘
      </div>
    </div>
  </DashboardCardWrapper>
));
TotalWatchTimeCard.displayName = "TotalWatchTimeCard";
