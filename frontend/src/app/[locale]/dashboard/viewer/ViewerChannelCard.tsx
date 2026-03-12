import React from "react";
import Image from "next/image";
import type { FollowedChannel } from "@/lib/api/viewer";

import { buildAvatarUrl, formatStreamDuration } from "./viewerDashboard.helpers";

export const ViewerChannelCard = React.memo(function ViewerChannelCard({
  channel,
  t,
  onOpen,
}: {
  channel: FollowedChannel;
  t: (key: string, values?: Record<string, string | number | Date>) => string;
  onOpen: (channelId: string) => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(channel.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          onOpen(channel.id);
        }
      }}
      className="group cursor-pointer bg-white/40 dark:bg-white/10 backdrop-blur-sm rounded-2xl border border-purple-300 dark:border-white/10 hover:border-purple-500/50 p-5 text-left transition-all duration-300 hover:shadow-lg hover:shadow-purple-900/10 hover:-translate-y-1 hover:bg-white/50 dark:hover:bg-white/15"
    >
      <div className="flex items-center gap-4 mb-4">
        <div className="relative">
          <Image
            src={buildAvatarUrl(channel)}
            alt={channel.displayName}
            width={60}
            height={60}
            className="w-14 h-14 rounded-full object-cover border-2 border-white/20 group-hover:border-purple-500 transition-colors"
          />
          {channel.isLive && (
            <span className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-red-500 rounded-full border-2 border-slate-800 animate-pulse" />
          )}
        </div>
        <div>
          <h3 className="font-bold text-lg text-purple-900 dark:text-white group-hover:text-purple-700 dark:group-hover:text-purple-300 transition-colors">
            {channel.displayName}
          </h3>
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm text-purple-800/60 dark:text-purple-300/50 font-mono">@{channel.channelName}</p>
            {channel.isLive && (
              <a
                href={`https://twitch.tv/${channel.channelName}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-xs text-purple-500 hover:text-purple-700 dark:text-purple-400 dark:hover:text-white hover:underline flex items-center gap-0.5 transition-colors z-10 relative"
              >
                {t("viewer.watchNow")}
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                  />
                </svg>
              </a>
            )}
          </div>
          {channel.isLive && channel.category && (
            <p className="text-xs text-purple-400/70 mt-0.5 truncate max-w-[180px]">🎮 {channel.category}</p>
          )}
          {channel.isLive && (
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[10px] uppercase tracking-wider text-red-400 font-bold bg-red-500/20 px-1.5 py-0.5 rounded">
                LIVE
              </span>
              {channel.viewerCount !== null && (
                <span className="text-[10px] text-purple-800/70 dark:text-purple-300/70">
                  {t("viewer.viewers", { count: channel.viewerCount.toLocaleString() })}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {channel.isLive && channel.streamStartedAt && (
        <div className="mb-3 px-3 py-2 bg-red-500/10 rounded-lg border border-red-500/20">
          <div className="flex justify-between items-center text-xs">
            <span className="text-red-300/70">{t("viewer.streamDuration")}</span>
            <span className="text-red-400 font-mono">{formatStreamDuration(channel.streamStartedAt)}</span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="bg-blue-600/5 dark:bg-blue-500/10 rounded-xl p-3 border border-blue-200 dark:border-blue-500/20">
          <p className="text-blue-800 dark:text-blue-300/70 text-xs mb-1">{t("stats.watchHours")}</p>
          <p className="font-semibold text-blue-900 dark:text-blue-400 text-lg">
            {(channel.totalWatchMinutes / 60).toFixed(1)} <span className="text-xs text-blue-700/60 dark:text-blue-400/60">h</span>
          </p>
        </div>
        <div className="bg-green-600/5 dark:bg-green-500/10 rounded-xl p-3 border border-green-200 dark:border-green-500/20">
          <p className="text-green-800 dark:text-green-300/70 text-xs mb-1">{t("stats.messageCount")}</p>
          <p className="font-semibold text-green-900 dark:text-green-400 text-lg">{channel.messageCount}</p>
        </div>
      </div>

      <div className="mt-4 pt-3 border-t border-purple-200 dark:border-white/10 text-xs text-purple-800/60 dark:text-purple-300/50 space-y-1">
        <div className="flex justify-between items-center">
          <span>{t("viewer.lastWatched")}</span>
          <span className="text-purple-900 dark:text-purple-300 font-medium">
            {channel.lastWatched ? channel.lastWatched.split("T")[0] : "N/A"}
          </span>
        </div>
        {channel.followedAt && (
          <div className="flex justify-between items-center">
            <span>{t("viewer.followedAt")}</span>
            <span className="text-purple-900 dark:text-purple-300 font-medium">{channel.followedAt.split("T")[0]}</span>
          </div>
        )}
      </div>
    </div>
  );
});
