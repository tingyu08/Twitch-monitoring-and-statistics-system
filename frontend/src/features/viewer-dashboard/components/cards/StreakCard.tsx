import React from "react";
import { useTranslations } from "next-intl";
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
>(({ current, longest, ...props }, ref) => {
  const t = useTranslations("footprint");

  return (
    <DashboardCardWrapper ref={ref} title={t("streak")} {...props}>
      <div className="flex flex-col justify-start gap-2">
        <div>
          <div className="text-xs text-slate-400">{t("currentStreak")}</div>
          <div className="text-2xl lg:text-3xl font-bold text-orange-400 flex items-center gap-2">
            {current}{" "}
            <span className="text-sm text-slate-400 font-normal">
              {t("daysUnit")}
            </span>
            {current > 0 && <span className="animate-pulse">🔥</span>}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-400">{t("longestStreak")}</div>
          <div className="text-lg font-semibold text-slate-300">
            {longest}{" "}
            <span className="text-xs text-slate-500 font-normal">
              {t("daysUnit")}
            </span>
          </div>
        </div>
      </div>
    </DashboardCardWrapper>
  );
});
StreakCard.displayName = "StreakCard";
