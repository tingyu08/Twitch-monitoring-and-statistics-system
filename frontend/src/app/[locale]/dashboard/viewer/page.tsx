"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { useAuthSession } from "@/features/auth/AuthContext";
import { viewerApi, type FollowedChannel } from "@/lib/api/viewer";
import { isViewer } from "@/lib/api/auth";
import { useSocket } from "@/lib/socket";
import { DashboardHeader } from "@/components";
import { useChannels } from "@/hooks/useViewer";
import { useQueryClient } from "@tanstack/react-query";

// 每頁顯示的頻道數量
const CHANNELS_PER_PAGE = 24;


// 計算並格式化開台時長
function formatStreamDuration(startedAt: string): string {
  const start = new Date(startedAt);
  const now = new Date();
  const diffMs = now.getTime() - start.getTime();

  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

const ChannelCard = React.memo(function ChannelCard({
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
            src={
              channel.avatarUrl ||
              `https://ui-avatars.com/api/?name=${encodeURIComponent(channel.displayName)}&background=6366f1&color=fff`
            }
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
            <p className="text-sm text-purple-800/60 dark:text-purple-300/50 font-mono">
              @{channel.channelName}
            </p>
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
                  {t("viewer.viewers", {
                    count: channel.viewerCount.toLocaleString(),
                  })}
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
            {(channel.totalWatchMinutes / 60).toFixed(1)}{" "}
            <span className="text-xs text-blue-700/60 dark:text-blue-400/60">h</span>
          </p>
        </div>
        <div className="bg-green-600/5 dark:bg-green-500/10 rounded-xl p-3 border border-green-200 dark:border-green-500/20">
          <p className="text-green-800 dark:text-green-300/70 text-xs mb-1">{t("stats.messageCount")}</p>
          <p className="font-semibold text-green-900 dark:text-green-400 text-lg">
            {channel.messageCount}
          </p>
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
            <span className="text-purple-900 dark:text-purple-300 font-medium">
              {channel.followedAt.split("T")[0]}
            </span>
          </div>
        )}
      </div>
    </div>
  );
});

export default function ViewerDashboardPage() {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const { user, loading: authLoading, logout } = useAuthSession();
  const queryClient = useQueryClient();

  // P1 優化：使用 React Query 管理頻道資料，自動處理快取和去重
  const {
    data: channels = [],
    isLoading: loading,
    error: queryError,
    refetch: refetchChannels,
  } = useChannels();

  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const lastNotifiedChannelsRef = useRef<string>("");
  const joinedChannelIdsRef = useRef<Set<string>>(new Set());
  const cacheWriteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingCachePayloadRef = useRef<FollowedChannel[] | null>(null);

  const { socket, connected: socketConnected, joinChannel, leaveChannel } = useSocket();

  const error = queryError ? queryError.message : null;

  const syncSessionCache = (channelsData: FollowedChannel[]) => {
    if (typeof window === "undefined") return;

    pendingCachePayloadRef.current = channelsData;
    if (cacheWriteTimerRef.current) return;

    cacheWriteTimerRef.current = setTimeout(() => {
      cacheWriteTimerRef.current = null;
      const latest = pendingCachePayloadRef.current;
      if (!latest) return;

      try {
        sessionStorage.setItem(
          "viewer_followed_channels",
          JSON.stringify({ data: latest, timestamp: Date.now() })
        );
      } catch {
        // ignore cache write errors
      }
    }, 600);
  };

  useEffect(() => {
    return () => {
      if (cacheWriteTimerRef.current) {
        clearTimeout(cacheWriteTimerRef.current);
      }
    };
  }, []);

  // 重定向未登入使用者
  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/");
    }
  }, [authLoading, user, router]);

  // WebSocket 事件監聽（只處理開台/關台事件，觀眾數由 React Query 輪詢）
  useEffect(() => {
    if (!socket || !socketConnected) return;

    const updateSingleChannel = (
      matcher: (channel: FollowedChannel) => boolean,
      updater: (channel: FollowedChannel) => FollowedChannel
    ) => {
      queryClient.setQueryData<FollowedChannel[]>(["viewer", "channels"], (prev) => {
        if (!prev) return prev;

        const targetIndex = prev.findIndex(matcher);
        if (targetIndex === -1) return prev;

        const current = prev[targetIndex];
        const updated = updater(current);
        if (updated === current) return prev;

        const next = prev.slice();
        next[targetIndex] = updated;
        syncSessionCache(next);
        return next;
      });
    };

    // 處理開台事件（即時通知）
    const handleStreamOnline = (data: {
      channelId: string;
      channelName: string;
      title?: string;
      gameName?: string;
      viewerCount?: number;
      startedAt?: string;
    }) => {
      console.log("[WebSocket] Stream online:", data);
      updateSingleChannel(
        (ch) => ch.id === data.channelId || ch.channelName === data.channelName,
        (ch) => {
          const nextViewerCount = data.viewerCount ?? ch.viewerCount;
          const nextCurrentViewerCount = data.viewerCount ?? ch.currentViewerCount ?? 0;
          const nextTitle = data.title || ch.currentTitle;
          const nextGame = data.gameName || ch.currentGameName;
          const nextStartedAt =
            data.startedAt || ch.currentStreamStartedAt || ch.streamStartedAt || new Date().toISOString();

          if (
            ch.isLive &&
            ch.viewerCount === nextViewerCount &&
            ch.currentViewerCount === nextCurrentViewerCount &&
            ch.currentTitle === nextTitle &&
            ch.currentGameName === nextGame &&
            ch.currentStreamStartedAt === nextStartedAt &&
            ch.streamStartedAt === nextStartedAt
          ) {
            return ch;
          }

          return {
            ...ch,
            isLive: true,
            viewerCount: nextViewerCount,
            streamStartedAt: nextStartedAt,
            currentTitle: nextTitle,
            currentGameName: nextGame,
            currentViewerCount: nextCurrentViewerCount,
            currentStreamStartedAt: nextStartedAt,
          };
        }
      );
    };

    // 處理關台事件（即時通知）
    const handleStreamOffline = (data: { channelId: string; channelName: string }) => {
      console.log("[WebSocket] Stream offline:", data);
      updateSingleChannel(
        (ch) => ch.id === data.channelId || ch.channelName === data.channelName,
        (ch) => {
          if (
            !ch.isLive &&
            ch.viewerCount === 0 &&
            (ch.currentViewerCount ?? 0) === 0 &&
            !ch.currentStreamStartedAt
          ) {
            return ch;
          }

          return {
            ...ch,
            isLive: false,
            viewerCount: 0,
            streamStartedAt: null,
            currentViewerCount: 0,
            currentStreamStartedAt: undefined,
          };
        }
      );
    };

    const handleChannelUpdate = (data: {
      channelId?: string;
      channelName?: string;
      twitchChannelId?: string;
      title?: string;
      gameName?: string;
      viewerCount?: number;
      startedAt?: string;
    }) => {
      updateSingleChannel(
        (ch) =>
          ch.id === data.channelId ||
          ch.channelName === data.channelName ||
          ch.channelName === data.twitchChannelId,
        (ch) => {
          const nextViewerCount = data.viewerCount ?? ch.viewerCount;
          const nextCurrentViewerCount = data.viewerCount ?? ch.currentViewerCount;
          const nextTitle = data.title || ch.currentTitle;
          const nextGame = data.gameName || ch.currentGameName;
          const nextStartedAt = data.startedAt || ch.currentStreamStartedAt;

          if (
            ch.viewerCount === nextViewerCount &&
            ch.currentViewerCount === nextCurrentViewerCount &&
            ch.currentTitle === nextTitle &&
            ch.currentGameName === nextGame &&
            ch.currentStreamStartedAt === nextStartedAt
          ) {
            return ch;
          }

          return {
            ...ch,
            viewerCount: nextViewerCount,
            currentViewerCount: nextCurrentViewerCount,
            currentTitle: nextTitle,
            currentGameName: nextGame,
            currentStreamStartedAt: nextStartedAt,
          };
        }
      );
    };

    const handleStatsUpdate = (data: { channelId: string; messageCountDelta: number }) => {
      if (data.messageCountDelta === 0) return;

      updateSingleChannel(
        (ch) => ch.id === data.channelId,
        (ch) => ({
          ...ch,
          messageCount: ch.messageCount + data.messageCountDelta,
        })
      );
    };

    socket.on("stream.online", handleStreamOnline);
    socket.on("stream.offline", handleStreamOffline);
    socket.on("channel.update", handleChannelUpdate);
    socket.on("stats-update", handleStatsUpdate);

    return () => {
      socket.off("stream.online", handleStreamOnline);
      socket.off("stream.offline", handleStreamOffline);
      socket.off("channel.update", handleChannelUpdate);
      socket.off("stats-update", handleStatsUpdate);
    };
  }, [socket, socketConnected, queryClient]);

  // P1 優化：React Query 自動處理輪詢，不需要手動設置 interval
  // 只需要在頁面可見時定期重新驗證資料
  useEffect(() => {
    if (!user) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        // React Query 會自動檢查 staleTime，避免過度請求
        refetchChannels();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [user, refetchChannels]);

  const filteredChannels = useMemo(() => {
    const lowerQuery = searchQuery.trim().toLowerCase();
    const filtered =
      lowerQuery.length > 0
        ? channels.filter(
            (ch) =>
              ch.channelName.toLowerCase().includes(lowerQuery) ||
              ch.displayName.toLowerCase().includes(lowerQuery)
          )
        : [...channels];

    filtered.sort((a, b) => {
      if (a.isLive && !b.isLive) return -1;
      if (!a.isLive && b.isLive) return 1;

      const watchDiff = b.totalWatchMinutes - a.totalWatchMinutes;
      if (watchDiff !== 0) return watchDiff;

      return a.displayName.localeCompare(b.displayName, "zh-Hant");
    });

    return filtered;
  }, [channels, searchQuery]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  // 計算分頁
  const totalPages = Math.ceil(filteredChannels.length / CHANNELS_PER_PAGE);
  const startIndex = (currentPage - 1) * CHANNELS_PER_PAGE;
  const endIndex = startIndex + CHANNELS_PER_PAGE;
  const currentPageChannels = filteredChannels.slice(startIndex, endIndex);

  // 通知後端監聽當前頁面的開台頻道
  const notifyListenChannels = useCallback(async (channelsToListen: FollowedChannel[]) => {
    const liveChannels = channelsToListen
      .filter((ch) => ch.isLive)
      .map((ch) => ({ channelName: ch.channelName, isLive: true }));

    // 建立唯一識別碼避免重複通知
    const channelKey = liveChannels
      .map((ch) => ch.channelName)
      .sort()
      .join(",");
    if (channelKey === lastNotifiedChannelsRef.current) {
      return; // 相同的頻道列表，不重複通知
    }
    lastNotifiedChannelsRef.current = channelKey;

    if (liveChannels.length > 0) {
      await viewerApi.setListenChannels(liveChannels);
    }
  }, []);

  // 當頁面變更時通知後端（只在頁碼變化時執行）
  useEffect(() => {
    if (currentPageChannels.length > 0) {
      notifyListenChannels(currentPageChannels);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage]);

  // Subscribe/unsubscribe by diff to avoid full reconnect storms on every channels update.
  useEffect(() => {
    const nextChannelIds = new Set((channels || []).map((ch) => ch.id));
    const prevChannelIds = joinedChannelIdsRef.current;

    nextChannelIds.forEach((channelId) => {
      if (!prevChannelIds.has(channelId)) {
        joinChannel(channelId);
      }
    });

    prevChannelIds.forEach((channelId) => {
      if (!nextChannelIds.has(channelId)) {
        leaveChannel(channelId);
      }
    });

    joinedChannelIdsRef.current = nextChannelIds;
  }, [channels, joinChannel, leaveChannel]);

  useEffect(() => {
    return () => {
      joinedChannelIdsRef.current.forEach((channelId) => {
        leaveChannel(channelId);
      });
      joinedChannelIdsRef.current.clear();
    };
  }, [leaveChannel]);

  const handleChannelClick = useCallback((channelId: string) => {
    router.push(`/dashboard/viewer/${channelId}`);
  }, [router]);

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    // 滾動到頂部
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  if (authLoading || loading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-purple-400"></div>
      </main>
    );
  }

  if (!user) {
    return null;
  }

  const viewerUser = isViewer(user) ? user : null;

  return (
    <main className="min-h-screen">
      {/* 使用新的響應式 Header */}
      <DashboardHeader variant="viewer" />

      <div className="max-w-7xl mx-auto px-4 py-4 sm:py-6 md:py-8">
        {/* User Header - 響應式設計 */}
        <section className="mb-6 sm:mb-8 md:mb-10 theme-header-card p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 sm:gap-6">
            <div className="flex items-center gap-3 sm:gap-5">
              {viewerUser?.avatarUrl && (
                <Image
                  src={viewerUser.avatarUrl}
                  alt={viewerUser.displayName}
                  width={80}
                  height={80}
                  className="w-14 h-14 sm:w-16 sm:h-16 md:w-20 md:h-20 rounded-full border-2 sm:border-4 border-purple-500/50 object-cover ring-2 sm:ring-4 ring-purple-500/20"
                />
              )}
              <div>
                <h1 className="text-xl sm:text-2xl md:text-3xl theme-text-gradient">
                  {t("viewer.welcome", {
                    name:
                      viewerUser?.displayName ||
                      t("viewer.welcomeGuest").replace("Welcome back, ", ""),
                  })}
                </h1>
                <p className="text-sm sm:text-base theme-text-secondary mt-0.5 sm:mt-1">
                  {t("viewer.subtitle")}
                </p>
              </div>
            </div>
            {/* 桌面版按鈕 - 在移動端隱藏，使用 Header 選單 */}
            <div className="hidden md:flex items-center gap-3">
              <button
                type="button"
                onClick={() => router.push("/dashboard/viewer/settings")}
                className="px-4 py-2 rounded-lg bg-white/50 hover:bg-white/80 dark:bg-white/10 dark:hover:bg-white/20 text-sm theme-text-secondary transition-colors border border-purple-200 dark:border-white/10 flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
                {t("nav.settings")}
              </button>
              <button
                type="button"
                onClick={logout}
                className="px-4 py-2 rounded-lg bg-red-100 dark:bg-red-500/20 hover:bg-red-200 dark:hover:bg-red-500/30 text-sm text-red-700 dark:text-red-300 transition-colors border border-red-200 dark:border-red-500/20"
              >
                {t("common.logout")}
              </button>
            </div>
          </div>
        </section>

        {/* 搜尋與標題 */}
        <div className="mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-semibold theme-text-gradient">
              {t("viewer.followedChannels")}
            </h2>
            <span className="text-sm text-purple-600/60 dark:text-purple-500">
              ({t("viewer.channelCount", { count: filteredChannels.length })}
              {totalPages > 1
                ? ` · ${t("viewer.pageInfo", {
                    current: currentPage,
                    total: totalPages,
                  })}`
                : ""}
              )
            </span>
          </div>
          <div className="relative">
            <input
              id="channel-search-input"
              name="searchQuery"
              type="text"
              placeholder={t("viewer.searchPlaceholder")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full sm:w-64 px-4 py-2 bg-white/50 dark:bg-white/10 border border-purple-200 dark:border-white/10 rounded-xl theme-text-primary placeholder-purple-400 dark:placeholder-purple-300/50 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all backdrop-blur-sm"
            />
            <svg
              className="absolute right-3 top-2.5 h-5 w-5 text-purple-400 dark:text-purple-300/50"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-500/20 border border-red-500/30 text-red-300 rounded-xl backdrop-blur-sm">
            {error}
          </div>
        )}

        {/* 頻道列表 */}
        {filteredChannels.length === 0 ? (
          <div className="text-center py-20 bg-white/40 dark:bg-white/5 backdrop-blur-sm rounded-2xl border border-purple-300 dark:border-white/10 border-dashed">
            <p className="text-purple-800/80 dark:text-purple-300/70 mb-4 text-lg">
              {searchQuery ? t("viewer.noChannels") : t("viewer.noFollowedChannels")}
            </p>
            {!searchQuery && (
              <button
                type="button"
                className="px-6 py-2.5 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-xl hover:from-purple-500 hover:to-pink-500 transition-all font-medium shadow-lg shadow-purple-900/30"
              >
                {t("viewer.exploreStreamers")}
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {currentPageChannels.map((channel) => (
                <ChannelCard key={channel.id} channel={channel} t={t} onOpen={handleChannelClick} />
              ))}
            </div>

            {/* 分頁導航 */}
            {totalPages > 1 && (
              <div className="mt-8 flex justify-center items-center gap-2">
                <button
                  type="button"
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage === 1}
                  className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm text-purple-300 transition-colors border border-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  ← {t("viewer.prevPage")}
                </button>

                <div className="flex gap-1">
                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter((page) => {
                      // 顯示前3頁、後3頁、當前頁附近3頁
                      if (page <= 3) return true;
                      if (page >= totalPages - 2) return true;
                      if (Math.abs(page - currentPage) <= 1) return true;
                      return false;
                    })
                    .map((page, index, arr) => (
                      <React.Fragment key={page}>
                        {index > 0 && arr[index - 1] !== page - 1 && (
                          <span className="px-2 text-purple-300/50">...</span>
                        )}
                        <button
                          type="button"
                          onClick={() => handlePageChange(page)}
                          className={`w-10 h-10 rounded-lg text-sm font-medium transition-all ${
                            currentPage === page
                              ? "bg-purple-600 text-white shadow-lg shadow-purple-900/30"
                              : "bg-white/10 text-purple-300 hover:bg-white/20 border border-white/10"
                          }`}
                        >
                          {page}
                        </button>
                      </React.Fragment>
                    ))}
                </div>

                <button
                  type="button"
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage === totalPages}
                  className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm text-purple-300 transition-colors border border-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {t("viewer.nextPage")} →
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
