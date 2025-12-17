import React from "react";
import { DashboardCardWrapper } from "../DashboardCardWrapper";

interface Props {
  minutes: number;
  className?: string;
  style?: React.CSSProperties;
}

export const AvgSessionCard = React.forwardRef<
  HTMLDivElement,
  Props & React.HTMLAttributes<HTMLDivElement>
>(({ minutes, ...props }, ref) => (
  <DashboardCardWrapper ref={ref} title="平均每次觀看" {...props}>
    <div className="flex flex-col justify-start">
      <div className="flex items-baseline gap-1">
        <span className="text-3xl lg:text-4xl font-bold text-teal-400 tracking-tight">
          {minutes}
        </span>
        <span className="text-sm text-slate-400">分鐘</span>
      </div>
    </div>
  </DashboardCardWrapper>
));
AvgSessionCard.displayName = "AvgSessionCard";
