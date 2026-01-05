import React, { useState, useRef, useEffect } from "react";
import { useTranslations } from "next-intl";
import { BADGE_CONFIG } from "../config/badges.config";
import { Badge } from "@/lib/api/lifetime-stats";
import { cn } from "@/lib/utils/cn";

interface BadgeDisplayProps {
  badge: Badge;
  size?: "sm" | "md" | "lg";
  showName?: boolean;
}

export const BadgeDisplay = ({
  badge,
  size = "md",
  showName = true,
}: BadgeDisplayProps) => {
  const t = useTranslations("footprint");
  const config = BADGE_CONFIG[badge.id];
  const [isHovered, setIsHovered] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState<"top" | "bottom">(
    "top"
  );
  const badgeRef = useRef<HTMLDivElement>(null);

  if (!config) return null;

  const isLocked = !badge.unlockedAt || badge.progress < 100;

  // Use translations for name and description
  const badgeName = t(`badgeItems.${badge.id}.name` as any);
  const badgeDesc = t(`badgeItems.${badge.id}.desc` as any);

  // Determine tooltip position based on available space
  const handleMouseEnter = () => {
    setIsHovered(true);
    if (badgeRef.current) {
      const rect = badgeRef.current.getBoundingClientRect();
      const spaceAbove = rect.top;
      const tooltipHeight = 120; // Approximate tooltip height

      // If not enough space above, show below
      if (spaceAbove < tooltipHeight) {
        setTooltipPosition("bottom");
      } else {
        setTooltipPosition("top");
      }
    }
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
  };

  return (
    <div
      ref={badgeRef}
      className={cn(
        "flex flex-col items-center relative cursor-help transition-all duration-200",
        isHovered && "z-[100]" // Elevate z-index when hovered
      )}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div
        className={cn(
          "rounded-full flex items-center justify-center bg-slate-800 border transition-all duration-300",
          isLocked
            ? "border-slate-700 text-slate-500 opacity-50 grayscale"
            : `${config.color} border-current/30`,
          size === "sm" && "w-8 h-8 text-sm",
          size === "md" && "w-10 h-10 lg:w-12 lg:h-12 text-xl lg:text-2xl",
          size === "lg" && "w-16 h-16 text-3xl",
          !isLocked &&
            isHovered &&
            "scale-105 shadow-[0_0_15px_rgba(255,255,255,0.1)]"
        )}
      >
        {config.icon}
      </div>

      {showName && (
        <span
          className={cn(
            "text-[10px] text-slate-400 mt-1 max-w-[60px] text-center truncate transition-colors",
            isLocked && "opacity-50",
            isHovered && "text-white opacity-100"
          )}
        >
          {badgeName}
        </span>
      )}

      {/* Tooltip */}
      {isHovered && (
        <div
          className={cn(
            "absolute left-1/2 transform -translate-x-1/2 w-48 p-3 bg-slate-950/95 backdrop-blur-md border border-slate-700/50 rounded-xl shadow-2xl text-xs",
            tooltipPosition === "top" ? "bottom-full mb-2" : "top-full mt-2"
          )}
          style={{ zIndex: 9999 }}
        >
          <div className="font-bold text-white mb-1.5 flex items-center justify-between gap-2">
            <span className="truncate">{badgeName}</span>
            {isLocked ? (
              <span className="text-[10px] bg-slate-800 px-1.5 py-0.5 rounded text-slate-400 whitespace-nowrap border border-slate-700">
                {t("badgeStatus.locked")}
              </span>
            ) : (
              <span className="text-[10px] bg-emerald-950/50 px-1.5 py-0.5 rounded text-emerald-400 whitespace-nowrap border border-emerald-900/50">
                {t("badgeStatus.unlocked")}
              </span>
            )}
          </div>
          <div className="text-slate-300 mb-3 leading-relaxed border-b border-slate-800 pb-2">
            {badgeDesc}
          </div>

          <div className="space-y-1.5">
            <div className="flex justify-between text-[10px]">
              <span className="text-slate-400">
                {t("badgeStatus.progress")}
              </span>
              <span
                className={cn(
                  "font-medium",
                  isLocked ? "text-blue-400" : "text-emerald-400"
                )}
              >
                {Math.floor(badge.progress)}%
              </span>
            </div>
            <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
              <div
                className={cn(
                  "h-full transition-all duration-500",
                  !isLocked ? "bg-emerald-500" : "bg-blue-500"
                )}
                style={{ width: `${Math.min(100, badge.progress)}%` }}
              />
            </div>
          </div>

          {/* Arrow */}
          <div
            className={cn(
              "absolute left-1/2 -translate-x-1/2 w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent",
              tooltipPosition === "top"
                ? "top-full border-t-[6px] border-t-slate-700/50"
                : "bottom-full border-b-[6px] border-b-slate-700/50"
            )}
          />
        </div>
      )}
    </div>
  );
};
