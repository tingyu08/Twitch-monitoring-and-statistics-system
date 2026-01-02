import React from "react";
import { useTranslations } from "next-intl";
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
>(({ count, chatCount, ...props }, ref) => {
  const t = useTranslations("footprint");

  return (
    <DashboardCardWrapper ref={ref} title={t("totalMessages")} {...props}>
      <div className="flex flex-col justify-start">
        <div className="flex items-baseline gap-1">
          <span className="text-3xl lg:text-4xl font-bold text-emerald-400 tracking-tight">
            {count.toLocaleString()}
          </span>
        </div>
        <div className="text-xs text-slate-500 mt-1">
          {t("chatRatio", {
            percent: count > 0 ? Math.round((chatCount / count) * 100) : 0,
          })}
        </div>
      </div>
    </DashboardCardWrapper>
  );
});
TotalMessagesCard.displayName = "TotalMessagesCard";
