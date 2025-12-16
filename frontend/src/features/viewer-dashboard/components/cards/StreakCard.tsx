import React from "react";
import { DashboardCardWrapper } from "../DashboardCardWrapper";

interface Props {
  current: number;
  longest: number;
  className?: string;
  style?: React.CSSProperties;
}

export const StreakCard = React.forwardRef<
  HTMLDivElement,
  Props & React.HTMLAttributes<HTMLDivElement>
>(({ current, longest, ...props }, ref) => (
  <DashboardCardWrapper ref={ref} title="連續觀看" {...props}>
    <div className="flex flex-col justify-between h-full py-1">
      <div>
        <div className="text-xs text-slate-400">當前連續</div>
        <div className="text-2xl lg:text-3xl font-bold text-orange-400 flex items-center gap-2">
          {current}{" "}
          <span className="text-sm text-slate-400 font-normal">天</span>
          {current > 0 && <span className="animate-pulse">🔥</span>}
        </div>
      </div>
      <div>
        <div className="text-xs text-slate-400">最高紀錄</div>
        <div className="text-lg font-semibold text-slate-300">
          {longest}{" "}
          <span className="text-xs text-slate-500 font-normal">天</span>
        </div>
      </div>
    </div>
  </DashboardCardWrapper>
));
StreakCard.displayName = "StreakCard";
