import React from "react";
import { DashboardCardWrapper } from "../DashboardCardWrapper";

interface Props {
  watchPercentile: number;
  msgPercentile: number;
  className?: string;
  style?: React.CSSProperties;
}

export const RankingCard = React.forwardRef<
  HTMLDivElement,
  Props & React.HTMLAttributes<HTMLDivElement>
>(({ watchPercentile, msgPercentile, ...props }, ref) => (
  <DashboardCardWrapper ref={ref} title="投入排名" {...props}>
    <div className="flex flex-col gap-2 h-full justify-center">
      <div>
        <div className="flex justify-between text-xs text-slate-400 mb-1">
          <span>觀看時長</span>
          <span className="text-white">
            前 {(100 - watchPercentile).toFixed(1)}%
          </span>
        </div>
        <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 rounded-full"
            style={{ width: `${watchPercentile}%` }}
          />
        </div>
      </div>

      <div>
        <div className="flex justify-between text-xs text-slate-400 mb-1">
          <span>互動頻率</span>
          <span className="text-white">
            前 {(100 - msgPercentile).toFixed(1)}%
          </span>
        </div>
        <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-emerald-500 rounded-full"
            style={{ width: `${msgPercentile}%` }}
          />
        </div>
      </div>
    </div>
  </DashboardCardWrapper>
));
RankingCard.displayName = "RankingCard";
