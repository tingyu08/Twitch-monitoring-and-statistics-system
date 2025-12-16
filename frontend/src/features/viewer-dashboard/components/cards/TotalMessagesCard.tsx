import React from "react";
import { DashboardCardWrapper } from "../DashboardCardWrapper";

interface Props {
  count: number;
  chatCount: number;
  className?: string;
  style?: React.CSSProperties;
}

export const TotalMessagesCard = React.forwardRef<
  HTMLDivElement,
  Props & React.HTMLAttributes<HTMLDivElement>
>(({ count, chatCount, ...props }, ref) => (
  <DashboardCardWrapper ref={ref} title="總留言數" {...props}>
    <div className="flex flex-col justify-end h-full">
      <div className="flex items-baseline gap-1">
        <span className="text-3xl lg:text-4xl font-bold text-emerald-400 tracking-tight">
          {count.toLocaleString()}
        </span>
        <span className="text-sm text-slate-400">則</span>
      </div>
      <div className="text-xs text-slate-500 mt-1">
        其中 {chatCount.toLocaleString()} 則聊天訊息
      </div>
    </div>
  </DashboardCardWrapper>
));
TotalMessagesCard.displayName = "TotalMessagesCard";
