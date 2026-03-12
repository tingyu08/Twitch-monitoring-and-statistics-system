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
import { ViewerChannelCard } from "./ViewerChannelCard";
import {
  applyChannelUpdate,
  applyStatsDelta,
  applyStreamOfflineUpdate,
  applyStreamOnlineUpdate,
  buildListenChannelsPayload,
  filterAndSortChannels,
  getCurrentPageChannels,
} from "./viewerDashboard.helpers";

// 每頁顯示的頻道數量
const CHANNELS_PER_PAGE = 24;



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

    type ChannelMutation = {
      matcher: (channel: FollowedChannel) => boolean;
      updater: (channel: FollowedChannel) => FollowedChannel;
    };

    const pendingMutations: ChannelMutation[] = [];
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    const flushMutations = () => {
      const mutations = pendingMutations.splice(0, pendingMutations.length);
      queryClient.setQueryData<FollowedChannel[]>(["viewer", "channels"], (prev) => {
        if (!prev) return prev;

        let next = prev;
        for (const mutation of mutations) {
          const targetIndex = next.findIndex(mutation.matcher);
          if (targetIndex === -1) continue;

          const current = next[targetIndex];
          const updated = mutation.updater(current);
          if (updated === current) continue;

          if (next === prev) {
            next = prev.slice();
          }
          next[targetIndex] = updated;
        }

        if (next !== prev) {
          syncSessionCache(next);
        }
        return next;
      });

      flushTimer = null;
    };

    const updateSingleChannel = (
      matcher: (channel: FollowedChannel) => boolean,
      updater: (channel: FollowedChannel) => FollowedChannel
    ) => {
      pendingMutations.push({ matcher, updater });
      if (flushTimer) return;
      flushTimer = setTimeout(flushMutations, 180);
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
          return applyStreamOnlineUpdate(ch, data);
        }
      );
    };

    // 處理關台事件（即時通知）
    const handleStreamOffline = (data: { channelId: string; channelName: string }) => {
      console.log("[WebSocket] Stream offline:", data);
      updateSingleChannel(
        (ch) => ch.id === data.channelId || ch.channelName === data.channelName,
        (ch) => {
          return applyStreamOfflineUpdate(ch);
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
          return applyChannelUpdate(ch, data);
        }
      );
    };

    const handleStatsUpdate = (data: { channelId: string; messageCountDelta: number }) => {
      if (data.messageCountDelta <= 0) return;

      updateSingleChannel(
        (ch) => ch.id === data.channelId,
        (ch) => applyStatsDelta(ch, data.messageCountDelta)
      );
    };

    const handleStatsBatchUpdate = (payload: {
      updates?: Array<{ channelId: string; messageCountDelta: number }>;
    }) => {
      const updates = payload?.updates || [];
      for (const update of updates) {
        if (update.messageCountDelta <= 0) continue;

        updateSingleChannel(
          (ch) => ch.id === update.channelId,
          (ch) => applyStatsDelta(ch, update.messageCountDelta)
        );
      }
    };

    socket.on("stream.online", handleStreamOnline);
    socket.on("stream.offline", handleStreamOffline);
    socket.on("channel.update", handleChannelUpdate);
    socket.on("stats-update", handleStatsUpdate);
    socket.on("stats-update-batch", handleStatsBatchUpdate);

    return () => {
      if (flushTimer) {
        clearTimeout(flushTimer);
      }
      socket.off("stream.online", handleStreamOnline);
      socket.off("stream.offline", handleStreamOffline);
      socket.off("channel.update", handleChannelUpdate);
      socket.off("stats-update", handleStatsUpdate);
      socket.off("stats-update-batch", handleStatsBatchUpdate);
    };
  }, [socket, socketConnected, queryClient]);

  useEffect(() => {
    if (socketConnected) {
      void refetchChannels();
    }
  }, [socketConnected, refetchChannels]);

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
    return filterAndSortChannels(channels, searchQuery);
  }, [channels, searchQuery]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  // 計算分頁
  const totalPages = Math.ceil(filteredChannels.length / CHANNELS_PER_PAGE);
  const currentPageChannels = getCurrentPageChannels(filteredChannels, currentPage, CHANNELS_PER_PAGE);

  // 通知後端監聽追蹤清單中的所有開台頻道（避免翻頁後停止計數）
  const notifyListenChannels = useCallback(async (channelsToListen: FollowedChannel[]) => {
    const liveChannels = buildListenChannelsPayload(channelsToListen);

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

  // 當追蹤清單變更時通知後端（含初次載入與直播狀態切換）
  useEffect(() => {
    if (channels.length > 0) {
      notifyListenChannels(channels);
    }
  }, [channels, notifyListenChannels]);

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
                <ViewerChannelCard key={channel.id} channel={channel} t={t} onOpen={handleChannelClick} />
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
