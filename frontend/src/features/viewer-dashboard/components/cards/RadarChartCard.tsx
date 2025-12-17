import React, { useMemo } from "react";
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
  // Transform scores object to array format for Recharts
  const data = useMemo(
    () => [
      { subject: "觀看時長", A: scores.watchTime, fullMark: 100 },
      { subject: "互動頻率", A: scores.interaction, fullMark: 100 },
      { subject: "忠誠度", A: scores.loyalty, fullMark: 100 },
      { subject: "活躍度", A: scores.activity, fullMark: 100 },
      { subject: "貢獻值", A: scores.contribution, fullMark: 100 },
      { subject: "社群參與", A: scores.community, fullMark: 100 },
    ],
    [scores]
  );

  return (
    <DashboardCardWrapper ref={ref} title="投入分析" {...props}>
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
            name="我的分數"
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
