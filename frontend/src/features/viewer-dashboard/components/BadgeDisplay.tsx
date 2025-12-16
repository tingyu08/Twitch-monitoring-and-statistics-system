import React from "react";
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
  const config = BADGE_CONFIG[badge.id];
  if (!config) return null;

  const isLocked = !badge.unlockedAt || badge.progress < 100; // unlockedAt is string from API

  return (
    <div
      className={cn(
        "flex flex-col items-center group relative cursor-help",
        isLocked && "opacity-50 grayscale"
      )}
    >
      <div
        className={cn(
          "rounded-full flex items-center justify-center bg-slate-800 border transition-all duration-300",
          isLocked
            ? "border-slate-700 text-slate-500"
            : `${config.color} border-current/30`,
          size === "sm" && "w-8 h-8 text-sm",
          size === "md" && "w-10 h-10 lg:w-12 lg:h-12 text-xl lg:text-2xl",
          size === "lg" && "w-16 h-16 text-3xl",
          !isLocked &&
            "group-hover:scale-110 group-hover:shadow-[0_0_15px_rgba(255,255,255,0.1)]"
        )}
      >
        {config.icon}
      </div>

      {showName && (
        <span className="text-[10px] text-slate-400 mt-1 max-w-[60px] text-center truncate group-hover:text-white transition-colors">
          {config.name}
        </span>
      )}

      {/* Tooltip */}
      <div className="absolute bottom-full mb-2 left-1/2 transform -translate-x-1/2 hidden group-hover:block z-50 w-48 p-2 bg-slate-900 border border-slate-700 rounded-lg shadow-xl text-xs pointer-events-none">
        <div className="font-bold text-slate-200 mb-1 flex items-center gap-1">
          {config.name}
          {isLocked && (
            <span className="text-[10px] bg-slate-800 px-1 rounded text-slate-500">
              鎖定
            </span>
          )}
        </div>
        <div className="text-slate-400 mb-2 leading-relaxed">
          {config.description}
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
        <div className="flex justify-between mt-1 text-[10px] text-slate-500">
          <span>{isLocked ? "進行中" : "已解鎖"}</span>
          <span>{Math.floor(badge.progress)}%</span>
        </div>
      </div>
    </div>
  );
};
