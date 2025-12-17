import React from "react";
import { DashboardCardWrapper } from "../DashboardCardWrapper";
import { Badge } from "@/lib/api/lifetime-stats";
import { BadgeDisplay } from "../BadgeDisplay";

interface Props {
  badges: Badge[];
  className?: string;
  style?: React.CSSProperties;
}

export const BadgesCard = React.forwardRef<
  HTMLDivElement,
  Props & React.HTMLAttributes<HTMLDivElement>
>(({ badges, ...props }, ref) => (
  <DashboardCardWrapper
    ref={ref}
    title="成就徽章"
    className="overflow-visible"
    {...props}
  >
    <div className="grid grid-cols-4 gap-2 lg:gap-3 p-1 content-start overflow-visible">
      {badges.map((badge) => (
        <BadgeDisplay key={badge.id} badge={badge} size="md" />
      ))}
    </div>
  </DashboardCardWrapper>
));
BadgesCard.displayName = "BadgesCard";
