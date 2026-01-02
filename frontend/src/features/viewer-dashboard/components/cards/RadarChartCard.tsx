import React, { useMemo } from "react";
import { useTranslations } from "next-intl";
import { DashboardCardWrapper } from "../DashboardCardWrapper";
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Tooltip,
} from "recharts";
import { SafeResponsiveContainer } from "@/components/charts/SafeResponsiveContainer";

interface Props {
  scores: {
    watchTime: number;
    interaction: number;
    loyalty: number;
    activity: number;
    contribution: number;
    community: number;
  };
  className?: string;
  style?: React.CSSProperties;
}

export const RadarChartCard = React.forwardRef<
  HTMLDivElement,
  Props & React.HTMLAttributes<HTMLDivElement>
>(({ scores, ...props }, ref) => {
  const t = useTranslations("footprint");

  // Transform scores object to array format for Recharts
  const data = useMemo(
    () => [
      { subject: t("radar.watchTime"), A: scores.watchTime, fullMark: 100 },
      { subject: t("radar.interaction"), A: scores.interaction, fullMark: 100 },
      { subject: t("radar.loyalty"), A: scores.loyalty, fullMark: 100 },
      { subject: t("radar.activity"), A: scores.activity, fullMark: 100 },
      {
        subject: t("radar.contribution"),
        A: scores.contribution,
        fullMark: 100,
      },
      { subject: t("radar.community"), A: scores.community, fullMark: 100 },
    ],
    [scores, t]
  );

  return (
    <DashboardCardWrapper ref={ref} title={t("engagementAnalysis")} {...props}>
      <SafeResponsiveContainer className="w-full h-full min-h-[200px]">
        <RadarChart cx="50%" cy="50%" outerRadius="70%" data={data}>
          <PolarGrid stroke="#334155" />
          <PolarAngleAxis
            dataKey="subject"
            tick={{ fill: "#94a3b8", fontSize: 10 }}
          />
          <PolarRadiusAxis
            angle={30}
            domain={[0, 100]}
            tick={false}
            axisLine={false}
          />
          <Radar
            name={t("radar.myScore")}
            dataKey="A"
            stroke="#8b5cf6"
            strokeWidth={2}
            fill="#8b5cf6"
            fillOpacity={0.6}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#0f172a",
              borderColor: "#334155",
              color: "#f8fafc",
              borderRadius: "8px",
              fontSize: "12px",
            }}
            itemStyle={{ color: "#c084fc" }}
          />
        </RadarChart>
      </SafeResponsiveContainer>
    </DashboardCardWrapper>
  );
});
RadarChartCard.displayName = "RadarChartCard";
