import React from "react";
import { useTranslations } from "next-intl";
import { DashboardCardWrapper } from "../DashboardCardWrapper";

interface Props {
  minutes: number;
  className?: string;
  style?: React.CSSProperties;
}

export const TotalWatchTimeCard = React.forwardRef<
  HTMLDivElement,
  Props & React.HTMLAttributes<HTMLDivElement>
>(({ minutes, ...props }, ref) => {
  const t = useTranslations("footprint");

  return (
    <DashboardCardWrapper ref={ref} title={t("totalWatchHours")} {...props}>
      <div className="flex flex-col justify-start">
        <div className="flex items-baseline gap-1">
          <span className="text-3xl lg:text-4xl font-bold text-blue-400 tracking-tight">
            {(minutes / 60).toFixed(1)}
          </span>
          <span className="text-sm text-slate-400">{t("hours")}</span>
        </div>
        <div className="text-xs text-slate-500 mt-1">
          {t("accumulatedMinutes", { minutes: minutes.toLocaleString() })}
        </div>
      </div>
    </DashboardCardWrapper>
  );
});
TotalWatchTimeCard.displayName = "TotalWatchTimeCard";
