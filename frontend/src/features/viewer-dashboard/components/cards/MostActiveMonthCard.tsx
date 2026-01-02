import React from "react";
import { useTranslations } from "next-intl";
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
>(({ month, count, ...props }, ref) => {
  const t = useTranslations("footprint");

  return (
    <DashboardCardWrapper ref={ref} title={t("mostActiveMonth")} {...props}>
      <div className="flex flex-col justify-start">
        <div className="text-2xl lg:text-3xl font-bold text-purple-400 tracking-tight mb-1">
          {month || "-"}
        </div>
        <div className="text-xs text-slate-500">
          {t("activeDays", { count })}
        </div>
      </div>
    </DashboardCardWrapper>
  );
});
MostActiveMonthCard.displayName = "MostActiveMonthCard";
