import React from "react";
import { DashboardCardWrapper } from "../DashboardCardWrapper";

interface Props {
  month: string | null;
  count: number;
  className?: string;
  style?: React.CSSProperties;
}

export const MostActiveMonthCard = React.forwardRef<
  HTMLDivElement,
  Props & React.HTMLAttributes<HTMLDivElement>
>(({ month, count, ...props }, ref) => (
  <DashboardCardWrapper ref={ref} title="最活躍月份" {...props}>
    <div className="flex flex-col justify-start">
      <div className="text-2xl lg:text-3xl font-bold text-purple-400 tracking-tight mb-1">
        {month || "-"}
      </div>
      <div className="text-xs text-slate-500">活躍 {count} 天</div>
    </div>
  </DashboardCardWrapper>
));
MostActiveMonthCard.displayName = "MostActiveMonthCard";
