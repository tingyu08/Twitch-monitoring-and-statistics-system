import React from "react";
import { useTranslations } from "next-intl";
import { DashboardCardWrapper } from "../DashboardCardWrapper";

interface Props {
  days: number;
  startDate: string | null;
  className?: string;
  style?: React.CSSProperties;
}

export const TrackingDaysCard = React.forwardRef<
  HTMLDivElement,
  Props & React.HTMLAttributes<HTMLDivElement>
>(({ days, startDate, ...props }, ref) => {
  const t = useTranslations("footprint");

  let startedText = "-";
  if (startDate) {
    try {
      startedText = new Date(startDate).toLocaleDateString();
    } catch (e) {}
  }

  return (
    <DashboardCardWrapper ref={ref} title={t("trackingDays")} {...props}>
      <div className="flex flex-col justify-start">
        <div className="flex items-baseline gap-1">
          <span className="text-3xl lg:text-4xl font-bold text-indigo-400 tracking-tight">
            {days}
          </span>
          <span className="text-sm text-slate-400">{t("days")}</span>
        </div>
        <div className="text-xs text-slate-500 mt-1">
          {t("since", { date: startedText })}
        </div>
      </div>
    </DashboardCardWrapper>
  );
});
TrackingDaysCard.displayName = "TrackingDaysCard";
